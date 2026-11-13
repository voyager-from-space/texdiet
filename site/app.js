import { analyze, normalizePaths, fmtBytes } from './rules.js';

const $ = (id) => document.getElementById(id);
const status = (msg) => { $('status').textContent = msg; };
const SKIP = /(^|\/)(__MACOSX\/|\.DS_Store$)/;

async function readZip(buf) {
  const zip = await window.JSZip.loadAsync(buf);
  const files = [];
  for (const e of Object.values(zip.files)) {
    if (e.dir || SKIP.test(e.name)) continue;
    const bytes = await e.async('uint8array');
    files.push({ path: e.name, size: bytes.length, bytes });
  }
  return { files: normalizePaths(files) };
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function render(name, report) {
  const { stats, findings, main } = report;
  $('res-title').textContent = findings.length
    ? `${findings.length} things to fix in ${name}`
    : `Nothing slow found in ${name}`;
  const dl = $('stats');
  dl.replaceChildren();
  for (const [k, v] of [['files', stats.files], ['total size', fmtBytes(stats.bytes)], ['figures', fmtBytes(stats.imageBytes)], ['main file', main || 'not found']]) {
    const d = el('div'); d.append(el('dt', null, k), el('dd', null, String(v))); dl.append(d);
  }
  const ol = $('findings');
  ol.replaceChildren();
  findings.forEach((f, i) => {
    const li = el('li', `finding ${f.severity}`);
    li.dataset.rule = f.rule;
    const head = el('div', 'f-head');
    head.append(el('span', 'rank', String(i + 1).padStart(2, '0')), el('span', `sev ${f.severity}`, f.severity), el('span', 'score', `est. impact ${f.score}`));
    li.append(head, el('h3', null, f.title), el('p', 'measured', f.measured), el('p', 'fix', f.fix));
    if (f.where.length) {
      const w = el('p', 'where');
      const shown = f.where.slice(0, 6).map((x) => `${x.file}:${x.line}`);
      w.textContent = shown.join('  ·  ') + (f.where.length > 6 ? `  ·  +${f.where.length - 6} more` : '');
      li.append(w);
    }
    ol.append(li);
  });
  $('results').hidden = false;
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handle(name, buf) {
  status(`Reading ${name} (${fmtBytes(buf.byteLength)})…`);
  const t0 = performance.now();
  try {
    const project = await readZip(buf);
    const report = analyze(project);
    render(name, report);
    status(`Read ${project.files.length} files in ${Math.round(performance.now() - t0)} ms, locally.`);
  } catch (err) {
    $('results').hidden = true;
    status(`Could not read that file as a zip (${err.message}).`);
  }
}

$('file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) f.arrayBuffer().then((b) => handle(f.name, b));
});
const drop = $('drop');
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) f.arrayBuffer().then((b) => handle(f.name, b));
});
$('sample').addEventListener('click', async () => {
  status('Loading the sample thesis…');
  const r = await fetch('sample/sample-thesis.zip');
  handle('sample-thesis.zip', await r.arrayBuffer());
});
