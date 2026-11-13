// texdiet fixer. Builds a fixed copy of the project in the browser.
// Change: { file, kind: 'image'|'pdf'|'tex'|'added', before, after, note }  (before/after in bytes; for tex, bytes of the file)
// Nothing is deleted: images are replaced by smaller versions of themselves, tex edits only add lines or comment lines out.

import { imageSize } from './rules.js';

const MAX_SIDE = 2000;         // about 6.7 in wide at 300 dpi
const JPEG_QUALITY = 0.85;
const SMALL_PNG = 300 * 1024;  // a PNG under this after downscaling stays PNG (diagrams, screenshots)
const MARK = '% texdiet:';
const enc = new TextEncoder(), dec = new TextDecoder();
const latin1 = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s; };
const bytesOf = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

function pngHasAlphaChannel(b) {
  const type = b[25];
  return type === 4 || type === 6 || latin1(b.subarray(0, Math.min(b.length, 4096))).includes('tRNS');
}

async function canvasBlob(canvas, type, q) {
  return canvas.convertToBlob ? canvas.convertToBlob({ type, quality: q }) : new Promise((r) => canvas.toBlob(r, type, q));
}

// returns { bytes, ext } or null when no smaller version exists
export async function shrinkImage(file) {
  const dim = imageSize(file.bytes);
  if (!dim) return null;
  const scale = Math.min(1, MAX_SIDE / Math.max(dim.w, dim.h));
  const w = Math.max(1, Math.round(dim.w * scale)), h = Math.max(1, Math.round(dim.h * scale));
  const bmp = await createImageBitmap(new Blob([file.bytes]), { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  const candidates = [];
  if (dim.kind === 'png') {
    let alpha = false;
    if (pngHasAlphaChannel(file.bytes)) {
      const px = ctx.getImageData(0, 0, w, h).data;
      for (let i = 3; i < px.length; i += 4) if (px[i] < 255) { alpha = true; break; }
    }
    const png = new Uint8Array(await (await canvasBlob(canvas, 'image/png')).arrayBuffer());
    candidates.push({ bytes: png, ext: 'png', w, h });
    if (!alpha && png.length > SMALL_PNG) {
      const jpg = new Uint8Array(await (await canvasBlob(canvas, 'image/jpeg', JPEG_QUALITY)).arrayBuffer());
      candidates.push({ bytes: jpg, ext: 'jpg', w, h });
    }
  } else {
    if (scale === 1 && file.size < 1024 * 1024) return null;
    const jpg = new Uint8Array(await (await canvasBlob(canvas, 'image/jpeg', JPEG_QUALITY)).arrayBuffer());
    candidates.push({ bytes: jpg, ext: file.path.split('.').pop(), w, h });
  }
  const best = candidates.sort((a, b) => a.bytes.length - b.bytes.length)[0];
  return best.bytes.length < file.size ? { ...best, from: dim } : null;
}

async function deflate(bytes) {
  const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(cs).arrayBuffer());
}

// Adds FlateDecode to unfiltered streams of a simple PDF (one classic xref table, no object streams,
// no encryption, direct /Length). Returns null for anything else rather than guessing.
export async function recompressPdf(bytes) {
  const s = latin1(bytes);
  if (!s.startsWith('%PDF-') || /\/ObjStm|\/Encrypt|\/XRefStm/.test(s)) return null;
  if ((s.replace(/startxref/g, '').match(/\bxref\s/g) || []).length !== 1) return null;
  const trailer = s.match(/trailer\s*(<<[\s\S]*?>>)\s*startxref/);
  if (!trailer) return null;
  const objRe = /(\d+)\s+(\d+)\s+obj\b/g;
  const objs = [];
  let m;
  while ((m = objRe.exec(s))) {
    const start = m.index + m[0].length;
    const dictEnd = s.indexOf('stream', start);
    const end = s.indexOf('endobj', start);
    if (end < 0) return null;
    let body = s.slice(start, end);
    if (dictEnd > 0 && dictEnd < end && !/\/Filter/.test(s.slice(start, dictEnd))) {
      const dict = s.slice(start, dictEnd);
      const len = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
      if (!len) return null;
      const dataStart = dictEnd + 6 + (s[dictEnd + 6] === '\r' ? 2 : 1);
      const raw = bytes.subarray(dataStart, dataStart + Number(len[1]));
      const z = await deflate(raw);
      const newDict = dict.replace(/\/Length\s+\d+/, `/Length ${z.length} /Filter /FlateDecode`);
      body = { head: newDict + 'stream\n', data: z, tail: '\nendstream\n' };
      objRe.lastIndex = end;
    } else objRe.lastIndex = end;
    objs.push({ num: Number(m[1]), gen: Number(m[2]), body });
  }
  if (!objs.length) return null;
  const parts = [bytesOf(s.slice(0, s.indexOf('\n') + 1) + '%\xe2\xe3\xcf\xd3\n')];
  let off = parts[0].length;
  const offsets = new Map();
  for (const o of objs) {
    offsets.set(o.num, [off, o.gen]);
    const chunk = typeof o.body === 'string'
      ? [bytesOf(`${o.num} ${o.gen} obj${o.body}endobj\n`)]
      : [bytesOf(`${o.num} ${o.gen} obj${o.body.head}`), o.body.data, bytesOf(`${o.body.tail}endobj\n`)];
    for (const c of chunk) { parts.push(c); off += c.length; }
  }
  const size = Math.max(...offsets.keys()) + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let i = 1; i < size; i++) {
    const e = offsets.get(i);
    xref += e ? `${String(e[0]).padStart(10, '0')} ${String(e[1]).padStart(5, '0')} n \n` : '0000000000 65535 f \n';
  }
  const tdict = trailer[1].replace(/\/Size\s+\d+/, `/Size ${size}`).replace(/\/Prev\s+\d+/, '');
  parts.push(bytesOf(`${xref}trailer\n${tdict}\nstartxref\n${off}\n%%EOF\n`));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let k = 0;
  for (const p of parts) { out.set(p, k); k += p.length; }
  return out.length < bytes.length ? out : null;
}

const EXTERNALIZE = [
  `${MARK} cache each TikZ picture as a PDF so it is drawn once, not on every compile.`,
  `${MARK} only runs with shell-escape on; otherwise pictures are drawn as before.`,
  String.raw`\usetikzlibrary{external}`,
  String.raw`\ifdefined\pdfshellescape\let\texdietSE\pdfshellescape\else\ifdefined\shellescape\let\texdietSE\shellescape\fi\fi`,
  String.raw`\ifdefined\texdietSE\ifnum\texdietSE=1 \tikzexternalize[prefix=tikz-cache/]\fi\fi`,
];

// line edits per rule; each returns notes for the change list
function editTex(text, file, findings) {
  const lines = text.split(/\r?\n/);
  const notes = [];
  const byRule = (r) => findings.filter((f) => f.rule === r);
  const stripped = (l) => l.replace(/(^|[^\\])%.*$/, '$1');
  const insertAfter = [];   // [index, linesToInsert]
  const prefixWith = new Map(); // index -> comment line placed above

  if (byRule('tikz-not-externalized').length) {
    let at = -1;
    lines.forEach((l, i) => { if (/\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*\b(tikz|pgfplots)\b/.test(stripped(l))) at = i; });
    if (at >= 0) { insertAfter.push([at, EXTERNALIZE, 'added \\tikzexternalize (runs only with shell-escape) and a tikz-cache/ folder']); }
  }
  lines.forEach((l, i) => {
    const t = stripped(l);
    if (/\\(tracingall|loggingall)\b|\\tracingonline\s*=?\s*1/.test(t)) {
      lines[i] = `${MARK} debug tracing switched off: ${l}`;
      notes.push({ line: i + 1, note: 'commented out debug tracing' });
    }
    if (/\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*\bminted\b/.test(t)) prefixWith.set(i, [`${MARK} minted runs Pygments through shell-escape on every compile. Once code is final, try \\usepackage[frozencache]{minted} or listings.`, 'flagged minted']);
    if (/\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*\bsvg\b/.test(t)) prefixWith.set(i, [`${MARK} the svg package calls Inkscape on every compile. Export SVGs to PDF once and use \\includegraphics.`, 'flagged svg package']);
    const eps = t.match(/\\includegraphics[^{]*\{([^}]+\.eps)\}/i);
    if (eps) prefixWith.set(i, [`${MARK} ${eps[1]} is converted to PDF on every compile. Convert it once and upload the PDF.`, `flagged EPS figure ${eps[1]}`]);
    if (/\\addplot/.test(t) && byRule('pgfplots-data').some((f) => f.where.some((w) => w.file === file && w.line === i + 1))) {
      prefixWith.set(i, [`${MARK} large data plot. Thin it with [each nth point=10] or plot it once to PDF.`, 'flagged large pgfplots data']);
    }
  });
  // apply from the bottom so indexes stay valid
  const ops = [...insertAfter.map(([i, add, note]) => ({ i: i + 1, src: i + 1, add, note })), ...[...prefixWith].map(([i, [c, note]]) => ({ i, src: i + 1, add: [c], note }))];
  ops.sort((a, b) => b.i - a.i);
  for (const op of ops) { lines.splice(op.i, 0, ...op.add); }
  ops.forEach((op) => notes.push({ line: op.src, note: op.note }));
  return { text: lines.join('\n'), notes: notes.sort((a, b) => a.line - b.line), externalized: insertAfter.length > 0 };
}

function retargetGraphics(text, renames) {
  let n = 0;
  const re = /(\\includegraphics\*?\s*(\[[^\]]*\])?\s*\{)([^}]+)(\})/g;
  const lines = text.split('\n').flatMap((line) => {
    const out = line.replace(re, (all, a, _o, name, z) => (renames.has(name.trim()) ? a + renames.get(name.trim()) + z : all));
    if (out === line) return [line];
    n++;
    return [`${MARK} figure replaced by a smaller copy. Original line: ${line.trim()}`, out];
  });
  return { text: lines.join('\n'), n };
}

// project: { files }, report: analyze(project). onProgress(msg)
export async function buildFix(project, report, onProgress = () => {}) {
  const files = new Map(project.files.map((f) => [f.path, { ...f }]));
  const changes = [];
  const renames = new Map(); // includegraphics name (as written) -> new name

  const rasterFindings = report.findings.filter((f) => f.rule === 'oversized-raster');
  for (const [i, f] of rasterFindings.entries()) {
    const file = files.get(f.path);
    if (!file) continue;
    onProgress(`Shrinking image ${i + 1} of ${rasterFindings.length}: ${f.path}`);
    const res = await shrinkImage(file);
    if (!res) continue;
    let newPath = f.path;
    if (res.ext === 'jpg' && /\.png$/i.test(f.path)) {
      const suffix = files.has(f.path.replace(/\.png$/i, '.jpg')) ? '-texdiet.jpg' : '.jpg';
      newPath = f.path.replace(/\.png$/i, suffix);
      files.delete(f.path);
      for (const r of report.refs) {
        if (r.path !== f.path) continue;
        // keep the reference style: with extension -> new extension; without -> graphicx finds the .jpg
        renames.set(r.name, /\.png$/i.test(r.name) ? r.name.replace(/\.png$/i, suffix) : suffix === '.jpg' ? r.name : r.name + '-texdiet');
      }
    }
    files.set(newPath, { path: newPath, size: res.bytes.length, bytes: res.bytes });
    changes.push({ file: newPath === f.path ? f.path : `${f.path} → ${newPath}`, kind: 'image', before: file.size, after: res.bytes.length,
      note: `${res.from.w}×${res.from.h} → ${res.w}×${res.h} px, ${res.ext === 'jpg' ? `JPEG q${Math.round(JPEG_QUALITY * 100)}` : 'PNG'}` });
  }

  for (const f of report.findings.filter((x) => x.rule === 'uncompressed-pdf')) {
    const path = f.path;
    const file = files.get(path);
    if (!file) continue;
    onProgress(`Compressing ${path}`);
    const out = await recompressPdf(file.bytes);
    if (!out) continue;
    files.set(path, { path, size: out.length, bytes: out });
    changes.push({ file: path, kind: 'pdf', before: file.size, after: out.length, note: 'added Flate compression to unfiltered streams' });
  }

  onProgress('Editing .tex files');
  let externalized = false;
  for (const [path, file] of files) {
    if (!/\.(tex|ltx)$/i.test(path)) continue;
    const orig = dec.decode(file.bytes);
    let { text, notes, externalized: ext } = editTex(orig, path, report.findings);
    externalized ||= ext;
    const r = retargetGraphics(text, renames);
    text = r.text;
    if (r.n) notes.push({ line: null, note: `pointed ${r.n} \\includegraphics to the new .jpg files` });
    if (text !== orig) {
      const b = enc.encode(text);
      files.set(path, { path, size: b.length, bytes: b });
      changes.push({ file: path, kind: 'tex', before: file.size, after: b.length, note: notes.map((n) => (n.line ? `original line ${n.line}: ` : '') + n.note).join('; ') });
    }
  }
  if (externalized && ![...files.keys()].some((p) => p.startsWith('tikz-cache/'))) {
    const b = enc.encode('texdiet: TikZ pictures are cached here as PDFs when shell-escape is on. Safe to delete; they are rebuilt.\n');
    files.set('tikz-cache/README.txt', { path: 'tikz-cache/README.txt', size: b.length, bytes: b });
    changes.push({ file: 'tikz-cache/README.txt', kind: 'added', before: 0, after: b.length, note: 'cache folder for \\tikzexternalize' });
  }
  return { files: [...files.values()], changes };
}

export function changeLog(name, changes, before, after) {
  const rows = changes.map((c) => `- ${c.file} [${c.kind}] ${c.before} -> ${c.after} bytes. ${c.note}`);
  return `texdiet changes for ${name}\nproject bytes (uncompressed): ${before} -> ${after}\nedits are marked with "${MARK}" comments; nothing was deleted.\n\n${rows.join('\n')}\n`;
}
