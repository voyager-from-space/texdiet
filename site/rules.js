// texdiet rules engine. Pure: takes a Project, returns ranked Findings.
// Project: { files: [{ path, size, bytes: Uint8Array }] }  (paths relative to project root)
// Finding: { rule, score 0-100, title, measured, fix, where: [{ file, line }] }

const MB = 1024 * 1024;
const RASTER = /\.(png|jpe?g)$/i;
const TEXLIKE = /\.(tex|sty|cls|ltx)$/i;
const GRAPHIC_EXTS = ['', '.pdf', '.png', '.jpg', '.jpeg', '.eps', '.PDF', '.PNG', '.JPG', '.JPEG'];

export function fmtBytes(n) {
  if (n >= MB) return (n / MB).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const clamp = (x) => Math.max(1, Math.min(100, Math.round(x)));

export function imageSize(b) {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { w: v.getUint32(16), h: v.getUint32(20), kind: 'png' };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], kind: 'jpeg' };
      }
      i += 2 + len;
    }
  }
  return null;
}

function latin1(b, max = Infinity) {
  const n = Math.min(b.length, max);
  let s = '';
  for (let i = 0; i < n; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, Math.min(n, i + 0x8000)));
  return s;
}

export function pdfStreams(b) {
  const s = latin1(b, 64 * MB);
  const streams = (s.match(/\bstream\r?\n/g) || []).length;
  const filtered = (s.match(/\/Filter\s*\/?\[?\s*\/\w+/g) || []).length;
  return { streams, filtered };
}

const stripComment = (line) => line.replace(/(^|[^\\])%.*$/, '$1');

function texLines(project) {
  const out = [];
  const dec = new TextDecoder('utf-8');
  for (const f of project.files) {
    if (!TEXLIKE.test(f.path)) continue;
    dec.decode(f.bytes).split(/\r?\n/).forEach((raw, i) => out.push({ file: f.path, line: i + 1, text: stripComment(raw) }));
  }
  return out;
}

const grep = (lines, re) => lines.filter((l) => re.test(l.text));
const countIn = (lines, re) => lines.reduce((n, l) => n + (l.text.match(re) || []).length, 0);
const usesPackage = (lines, name) => grep(lines, new RegExp(String.raw`\\(usepackage|RequirePackage)\s*(\[[^\]]*\])?\s*\{[^}]*\b${name}\b[^}]*\}`));

function findMain(project, lines) {
  const roots = [...new Set(grep(lines, /\\documentclass/).map((l) => l.file))];
  return roots.find((p) => /(^|\/)main\.tex$/i.test(p)) || roots[0] || null;
}

function resolveGraphic(name, byPath, dirs) {
  for (const d of dirs) for (const ext of GRAPHIC_EXTS) {
    const p = (d + name + ext).replace(/^\.\//, '').replace(/\/\.\//g, '/');
    if (byPath.has(p)) return byPath.get(p);
  }
  return null;
}

function graphicsRefs(project, lines, main) {
  const byPath = new Map(project.files.map((f) => [f.path, f]));
  const base = main && main.includes('/') ? main.slice(0, main.lastIndexOf('/') + 1) : '';
  const gp = [];
  for (const l of grep(lines, /\\graphicspath/)) for (const m of l.text.matchAll(/\{([^{}]*)\}/g)) gp.push(m[1]);
  const dirs = ['', ...gp].map((d) => base + d);
  const refs = [];
  for (const l of lines) for (const m of l.text.matchAll(/\\includegraphics\*?\s*(\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
    const name = m[2].trim();
    refs.push({ name, file: l.file, line: l.line, target: resolveGraphic(name, byPath, dirs) });
  }
  return refs;
}

// Each rule: (ctx) => Finding[]. Order here does not matter; findings are sorted by score.
const RULES = [
  function oversizedRaster({ refsByTarget }) {
    const out = [];
    for (const [f, refs] of refsByTarget) {
      if (!RASTER.test(f.path)) continue;
      const dim = imageSize(f.bytes);
      const mp = dim ? (dim.w * dim.h) / 1e6 : 0;
      const isPng = dim?.kind === 'png';
      if (f.size < 1 * MB && mp < 4.2) continue;
      const score = clamp(25 + (f.size / MB) * (isPng ? 5 : 3) + mp * 1.5);
      out.push({
        rule: 'oversized-raster', score,
        title: `Huge ${isPng ? 'PNG' : 'JPEG'} figure: ${f.path}`,
        measured: `${fmtBytes(f.size)}${dim ? `, ${dim.w}×${dim.h} px (${mp.toFixed(1)} MP)` : ''}`,
        fix: `Downscale to about 2000 px on the long edge${isPng ? ' and save photos as JPEG; PNGs are decompressed and re-encoded on every compile' : ''}.`,
        where: refs.map(({ file, line }) => ({ file, line })),
      });
    }
    return out;
  },
  function uncompressedPdf({ refsByTarget }) {
    const out = [];
    for (const [f, refs] of refsByTarget) {
      if (!/\.pdf$/i.test(f.path)) continue;
      const { streams, filtered } = pdfStreams(f.bytes);
      const raw = streams - filtered;
      if (raw > 0 && f.size > 200 * 1024) {
        out.push({ rule: 'uncompressed-pdf', score: clamp(40 + (f.size / MB) * 6),
          title: `Uncompressed PDF figure: ${f.path}`,
          measured: `${fmtBytes(f.size)}, ${raw} of ${streams} streams have no compression filter`,
          fix: 'Re-export the figure with compression, or rasterize very dense plots to a 300 dpi PNG/JPEG.',
          where: refs.map(({ file, line }) => ({ file, line })) });
      } else if (f.size > 3 * MB) {
        out.push({ rule: 'heavy-pdf', score: clamp(20 + (f.size / MB) * 3),
          title: `Heavy PDF figure: ${f.path}`, measured: fmtBytes(f.size),
          fix: 'Check for embedded full-resolution images inside the PDF and re-export at lower resolution.',
          where: refs.map(({ file, line }) => ({ file, line })) });
      }
    }
    return out;
  },
  function epsFigures({ refsByTarget }) {
    const eps = [...refsByTarget].filter(([f]) => /\.eps$/i.test(f.path));
    if (!eps.length) return [];
    const bytes = eps.reduce((n, [f]) => n + f.size, 0);
    return [{ rule: 'eps-conversion', score: clamp(50 + (bytes / MB) * 4),
      title: `${plural(eps.length, 'EPS figure')} converted to PDF at compile time`,
      measured: `${eps.map(([f]) => `${f.path} (${fmtBytes(f.size)})`).join(', ')}`,
      fix: 'Convert each .eps to .pdf once and upload the PDF, so the editor does not run epstopdf on every compile.',
      where: eps.flatMap(([, refs]) => refs.map(({ file, line }) => ({ file, line }))) }];
  },
  function svgPackage({ lines }) {
    const hits = [...usesPackage(lines, 'svg'), ...grep(lines, /\\includesvg/)];
    if (!hits.length) return [];
    return [{ rule: 'svg-inkscape', score: 70, title: 'SVG figures call Inkscape during the compile',
      measured: `${plural(grep(lines, /\\includesvg/).length, '\\includesvg call')}`,
      fix: 'Export each SVG to PDF once and use \\includegraphics instead.', where: hits.map(({ file, line }) => ({ file, line })) }];
  },
  function tikzNotExternalized({ lines }) {
    const pics = grep(lines, /\\begin\{tikzpicture\}/);
    const externalized = grep(lines, /\\tikzexternalize/).length > 0;
    if (!pics.length || externalized) return [];
    const axes = countIn(lines, /\\begin\{(axis|semilogxaxis|semilogyaxis|loglogaxis|polaraxis)\}/g);
    return [{ rule: 'tikz-not-externalized',
      score: clamp(30 + pics.length * 5 + axes * 8),
      title: `${plural(pics.length, 'TikZ picture')} redrawn on every compile`,
      measured: `${plural(pics.length, 'tikzpicture')}${axes ? `, ${(axes === 1 ? '1 pgfplots axis' : `${axes} pgfplots axes`)}` : ''}, no active \\tikzexternalize`,
      fix: 'Compile the pictures once to PDF (standalone class or tikz external library) and include the PDFs.',
      where: pics.map(({ file, line }) => ({ file, line })) }];
  },
  function pgfplotsData({ lines, project }) {
    const where = []; let points = 0;
    for (const l of grep(lines, /\\addplot/)) {
      const n = (l.text.match(/\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)/g) || []).length;
      const t = l.text.match(/\\addplot\+?\s*(\[[^\]]*\])?\s*table\s*(\[[^\]]*\])?\s*\{([^}]+)\}/);
      let rows = 0;
      if (t) {
        const f = project.files.find((x) => x.path === t[3].trim() || x.path.endsWith('/' + t[3].trim()));
        if (f) rows = new TextDecoder().decode(f.bytes).split(/\n/).filter((s) => s.trim()).length - 1;
      }
      if (n + rows > 0) { points += n + rows; where.push({ file: l.file, line: l.line }); }
    }
    if (points < 1000) return [];
    return [{ rule: 'pgfplots-data', score: clamp(30 + Math.log10(points) * 12),
      title: `pgfplots draws ${points.toLocaleString('en-US')} data points`, measured: `${points.toLocaleString('en-US')} points across ${plural(where.length, 'plot')}`,
      fix: 'Downsample the data (every nth row via each nth point) or plot it once to PDF.', where }];
  },
  function minted({ lines }) {
    const pkg = usesPackage(lines, 'minted');
    if (!pkg.length) return [];
    const blocks = countIn(lines, /\\begin\{minted\}|\\mint\b|\\inputminted/g);
    return [{ rule: 'minted-shell-escape', score: clamp(30 + blocks * 2),
      title: 'minted runs Pygments through shell-escape', measured: `${plural(blocks, 'code block')}`,
      fix: 'Use listings for drafts, or minted\'s frozencache option once the code is final.', where: pkg.map(({ file, line }) => ({ file, line })) }];
  },
  function fonts({ lines }) {
    const decl = grep(lines, /\\(setmainfont|setsansfont|setmonofont|newfontfamily|setmathfont|fontspec)\b/);
    if (!usesPackage(lines, 'fontspec').length && !decl.length) return [];
    return [{ rule: 'fontspec-fonts', score: clamp(15 + decl.length * 5),
      title: `fontspec loads ${(decl.length === 1 ? '1 font family' : `${decl.length} font families`)} (XeLaTeX/LuaLaTeX)`, measured: `${plural(decl.length, 'font declaration')}`,
      fix: 'Load only the families you use; XeLaTeX and LuaLaTeX are slower than pdfLaTeX, so use pdfLaTeX if you do not need system fonts.',
      where: decl.map(({ file, line }) => ({ file, line })) }];
  },
  function slowPackages({ lines }) {
    const known = { tabularray: 'tables are typeset several times', acro: 'v3 is slow on big acronym lists', mhchem: 'every \\ce is parsed in TeX', forest: 'tree layout is expensive' };
    const out = [];
    for (const [name, why] of Object.entries(known)) {
      const hits = usesPackage(lines, name);
      if (hits.length) out.push({ rule: 'slow-package', score: 22, title: `Slow package: ${name}`,
        measured: why, fix: `Keep ${name} only if you need it; it is on the common list of compile-timeout causes.`,
        where: hits.map(({ file, line }) => ({ file, line })) });
    }
    return out;
  },
  function hFloats({ lines }) {
    const hits = grep(lines, /\\begin\{(figure|table)\*?\}\s*\[H\]/);
    if (hits.length < 5) return [];
    return [{ rule: 'h-floats', score: clamp(10 + hits.length), title: `${plural(hits.length, '[H] float')}`,
      measured: `${hits.length} figures/tables forced in place`, fix: 'Use [htbp] and let LaTeX place floats; many [H] floats with large images slow page building.',
      where: hits.map(({ file, line }) => ({ file, line })) }];
  },
  function tracing({ lines }) {
    const hits = grep(lines, /\\(tracingall|tracingonline\s*=?\s*1|loggingall)/);
    if (!hits.length) return [];
    return [{ rule: 'tracing', score: 90, title: 'Debug tracing is switched on', measured: plural(hits.length, 'tracing command'),
      fix: 'Remove \\tracingall / \\tracingonline; they write huge logs on every compile.', where: hits.map(({ file, line }) => ({ file, line })) }];
  },
  function bibliography({ project, lines }) {
    const bibs = project.files.filter((f) => /\.bib$/i.test(f.path));
    if (!bibs.length) return [];
    const dec = new TextDecoder();
    let entries = 0, bytes = 0;
    for (const f of bibs) { bytes += f.size; entries += (dec.decode(f.bytes).match(/^\s*@(?!comment|string|preamble)\w+\s*[{(]/gim) || []).length; }
    if (entries < 300) return [];
    const where = grep(lines, /\\(addbibresource|bibliography)\s*\{/).map(({ file, line }) => ({ file, line }));
    return [{ rule: 'bibliography', score: clamp(10 + entries / 50),
      title: `Bibliography has ${entries.toLocaleString('en-US')} entries`, measured: `${plural(bibs.length, '.bib file')}, ${fmtBytes(bytes)}, ${entries.toLocaleString('en-US')} entries`,
      fix: 'Keep a trimmed .bib with only the entries you cite.', where }];
  },
  function missing({ refs }) {
    const miss = refs.filter((r) => !r.target);
    if (!miss.length) return [];
    return [{ rule: 'missing-figure', score: 35, title: `${plural(miss.length, 'figure')} not found in the zip`,
      measured: miss.map((r) => r.name).join(', '), fix: 'Upload the file or fix the path; a missing file stops the compile with an error.',
      where: miss.map(({ file, line }) => ({ file, line })) }];
  },
  function unused({ project, refsByTarget }) {
    const unused = project.files.filter((f) => /\.(png|jpe?g|pdf|eps)$/i.test(f.path) && !refsByTarget.has(f) && f.size > 100 * 1024);
    if (!unused.length) return [];
    const bytes = unused.reduce((n, f) => n + f.size, 0);
    return [{ rule: 'unused-assets', score: clamp(5 + bytes / MB), title: `${plural(unused.length, 'image')} never included`,
      measured: `${fmtBytes(bytes)}: ${unused.map((f) => f.path).join(', ')}`,
      fix: 'Delete them from the project. They do not slow the compile, but they make the upload and sync heavier.', where: [] }];
  },
  function draftMode({ lines, refsByTarget }) {
    const imgBytes = [...refsByTarget.keys()].reduce((n, f) => n + f.size, 0);
    const draft = grep(lines, /\\documentclass\s*\[[^\]]*\bdraft\b|\\includeonly/).length > 0;
    if (draft || imgBytes < 5 * MB) return [];
    return [{ rule: 'draft-mode', score: 15, title: 'Not using draft mode while writing',
      measured: `${fmtBytes(imgBytes)} of included figures loaded on every compile`,
      fix: 'While drafting, add draft to \\documentclass options (images become boxes) or use \\includeonly{chapter} for the chapter you are editing.',
      where: grep(lines, /\\documentclass/).map(({ file, line }) => ({ file, line })) }];
  },
];

export function analyze(project) {
  const lines = texLines(project);
  const main = findMain(project, lines);
  const refs = graphicsRefs(project, lines, main);
  const refsByTarget = new Map();
  for (const r of refs) if (r.target) (refsByTarget.get(r.target) || refsByTarget.set(r.target, []).get(r.target)).push(r);
  const ctx = { project, lines, main, refs, refsByTarget };
  const findings = RULES.flatMap((rule) => rule(ctx))
    .map((f) => ({ ...f, severity: f.score >= 60 ? 'high' : f.score >= 30 ? 'medium' : 'low' }))
    .sort((a, b) => b.score - a.score);
  const sum = (re) => project.files.filter((f) => re.test(f.path)).reduce((n, f) => n + f.size, 0);
  return {
    main,
    stats: { files: project.files.length, bytes: sum(/./), imageBytes: sum(/\.(png|jpe?g|pdf|eps|svg)$/i), texFiles: project.files.filter((f) => TEXLIKE.test(f.path)).length },
    findings,
  };
}

// Strip one shared top-level folder (zips made by "compress folder" wrap everything in one).
export function normalizePaths(files) {
  const firsts = new Set(files.map((f) => (f.path.includes('/') ? f.path.split('/')[0] : '')));
  if (firsts.size === 1 && !firsts.has('')) {
    const cut = [...firsts][0].length + 1;
    return files.map((f) => ({ ...f, path: f.path.slice(cut) }));
  }
  return files;
}
