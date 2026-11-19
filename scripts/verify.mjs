// end-to-end check of texdiet in headless chromium, desktop + mobile.
// local: serves site/ on 127.0.0.1:4174.  live: BASE_URL=https://voyager-from-space.github.io/texdiet/ SHOTS=screenshots/live npm run verify
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const PORT = 4174, LIVE = process.env.BASE_URL, BASE = LIVE || `http://127.0.0.1:${PORT}/`;
const SHOTS = root + (process.env.SHOTS || "screenshots/local");
const SMALL = root + "test/fixtures/small-thesis.zip", HEAVY = root + "test/heavy/heavy-thesis.zip";
mkdirSync(SHOTS, { recursive: true });
const JSZip = createRequire(import.meta.url)("jszip");
const { analyze, normalizePaths, imageSize } = await import(root + "site/rules.js");
const DL = root + "test/out";
mkdirSync(DL, { recursive: true });
const server = LIVE ? { kill() {} } : spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", root + "site"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

const denyFile = root + ".identity-denylist";
const deny = existsSync(denyFile) ? readFileSync(denyFile, "utf8").split("\n").map((l) => l.trim().toLowerCase()).filter(Boolean) : [];
let fails = 0, passes = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); cond ? passes++ : fails++; };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: process.env.CHROME_PATH ? ["--no-sandbox"] : [] });

// Let lazily loaded fonts finish before a reload, so the reload does not abort them (net::ERR_ABORTED).
async function settle(p) { await p.evaluate(() => document.fonts.ready); await p.reload({ waitUntil: "networkidle" }); }

async function open(viewport, tag) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1 });
  const p = await ctx.newPage();
  const errors = [], external = [];
  p.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(`${m.type()}: ${m.text()}`); });
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("requestfailed", (r) => errors.push("requestfailed: " + r.url() + " (" + (r.failure()?.errorText || "?") + ")"));
  p.on("request", (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith("data:")) external.push(r.url()); });
  await p.goto(`${BASE}?cb=${Date.now()}`, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  return { p, ctx, errors, external, tag };
}

const findings = (p) => p.$$eval("#findings .finding", (els) => els.map((e) => ({
  rule: e.dataset.rule, sev: e.querySelector(".sev").textContent, title: e.querySelector("h3").textContent,
  measured: e.querySelector(".measured").textContent, where: e.querySelector(".where")?.textContent || "",
  score: Number(e.querySelector(".score").textContent.replace(/\D/g, "")),
})));
async function upload(p, file) {
  await p.setInputFiles("#file", file);
  await p.waitForSelector("#results:not([hidden]) .finding");
}

async function readZipNode(path) {
  const z = await JSZip.loadAsync(readFileSync(path));
  const files = [];
  for (const e of Object.values(z.files)) if (!e.dir) { const b = await e.async("uint8array"); files.push({ path: e.name, size: b.length, bytes: b }); }
  return normalizePaths(files);
}

async function checkProof(vp, tag) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: vp.width < 500 ? 2 : 1 });
  const p = await ctx.newPage();
  const errors = [], external = [];
  p.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(`${m.type()}: ${m.text()}`); });
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("requestfailed", (r) => errors.push("requestfailed: " + r.url() + " (" + (r.failure()?.errorText || "?") + ")"));
  p.on("request", (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith("data:")) external.push(r.url()); });
  await p.goto(`${BASE}proof.html?cb=${Date.now()}`, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  const timing = JSON.parse(readFileSync(root + "site/timing.json", "utf8"));
  const MB = 1024 * 1024;
  const fmt = (n) => (n / MB).toFixed(1) + " MB";
  const body = await p.textContent("main");
  ok((await p.title()).includes("timing notes"), `${tag} proof: title names timing notes`);
  ok(await p.$eval('link[rel="canonical"]', (l) => l.href) === "https://texdiet.vercel.app/proof.html", `${tag} proof: canonical points at texdiet.vercel.app/proof.html`);
  ok(body.includes(fmt(timing.original_no_shell_escape.pdf_bytes)) && body.includes(fmt(timing.fixed_no_shell_escape.pdf_bytes)), `${tag} proof: shows PDF sizes ${fmt(timing.original_no_shell_escape.pdf_bytes)} and ${fmt(timing.fixed_no_shell_escape.pdf_bytes)}`);
  ok(body.includes(String(timing.original_no_shell_escape.warm_median_ms)) && body.includes(String(timing.fixed_no_shell_escape.warm_median_ms)), `${tag} proof: shows warm medians ${timing.original_no_shell_escape.warm_median_ms} and ${timing.fixed_no_shell_escape.warm_median_ms}`);
  ok(body.includes(String(timing.fixed_shell_escape_warm.warm_median_ms)) && body.includes(String(timing.fixed_shell_escape_first.ms)), `${tag} proof: shows cached median ${timing.fixed_shell_escape_warm.warm_median_ms} and first cache pass ${timing.fixed_shell_escape_first.ms}`);
  ok(body.includes("not a measurement of a hosted editor's 10-second limit"), `${tag} proof: does not claim a hosted editor timeout`);
  ok(!/overleaf/i.test(await p.content()), `${tag} proof: brand name of the online editor never appears`);
  const caps = await p.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.textContent.trim() && getComputedStyle(e).textTransform === "uppercase").length);
  ok(caps === 0, `${tag} proof: no all-caps text-transform labels (${caps} found)`);
  ok(!(await p.textContent("body")).includes("\u00b7"), `${tag} proof: no middle-dot separators`);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag} proof: no horizontal overflow`);
  const html = (await p.content()).toLowerCase();
  ok(deny.length > 0 && deny.every((d) => !html.includes(d)), `${tag} proof: 0 denylist hits in rendered html`);
  await p.screenshot({ path: `${SHOTS}/${tag}-proof.png`, fullPage: true });
  ok(errors.length === 0, `${tag} proof: no console errors or failed requests${errors.length ? " -> " + errors.join(" | ") : ""}`);
  ok(external.length === 0, `${tag} proof: no requests leave the site${external.length ? " -> " + external.join(" ") : ""}`);
  await ctx.close();
}

async function checkFixed(p, tag, input, label) {
  const t = `${tag} ${label}`;
  await p.click("#fix");
  await p.waitForSelector("#fixed:not([hidden]) .change", { timeout: 120000 });
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#download")]);
  const inName = input.split("/").pop();
  ok(dl.suggestedFilename() === inName.replace(/\.zip$/, "-texdiet.zip"), `${t}: download is named ${dl.suggestedFilename()}`);
  const out = `${DL}/${tag}-${dl.suggestedFilename()}`;
  await dl.saveAs(out);
  const inSize = readFileSync(input).length, outSize = readFileSync(out).length;
  ok(outSize < inSize, `${t}: fixed zip is smaller (${inSize} -> ${outSize} bytes, -${Math.round((1 - outSize / inSize) * 100)}%)`);
  const before = await readZipNode(input), after = await readZipNode(out);
  const byPath = new Map(after.map((f) => [f.path, f]));
  const src = before.filter((f) => /\.(tex|bib|cls|sty)$/i.test(f.path));
  ok(src.every((f) => byPath.has(f.path)), `${t}: all ${src.length} .tex/.bib/.cls/.sty files still present`);
  const dec = new TextDecoder();
  const kept = src.every((f) => {
    const now = dec.decode(byPath.get(f.path).bytes);
    return dec.decode(f.bytes).split("\n").filter((l) => l.trim()).every((l) => now.includes(l) || now.includes(`% texdiet: figure replaced by a smaller copy. Original line: ${l.trim()}`));
  });
  ok(kept, `${t}: every original non-empty source line is still in the fixed files (only additions, comments, or a figure path kept in a texdiet comment)`);
  ok(byPath.has("TEXDIET-CHANGES.txt"), `${t}: zip carries TEXDIET-CHANGES.txt`);
  const main = dec.decode(byPath.get("main.tex").bytes);
  ok(main.includes("% texdiet:") && main.includes("\\tikzexternalize[prefix=tikz-cache/]") && byPath.has("tikz-cache/README.txt"), `${t}: main.tex gets marked \\tikzexternalize and tikz-cache/ exists`);
  const imgs = after.filter((f) => /\.(png|jpe?g)$/i.test(f.path));
  const decoded = [];
  for (const f of imgs) decoded.push(await p.evaluate(async (b64) => {
    try { const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))])); return [bmp.width, bmp.height]; } catch { return null; }
  }, Buffer.from(f.bytes).toString("base64")));
  ok(decoded.every(Boolean), `${t}: all ${imgs.length} images in the fixed zip decode in the browser`);
  const r0 = analyze({ files: before }), r1 = analyze({ files: after });
  const big0 = r0.findings.filter((f) => f.rule === "oversized-raster");
  const reduced = big0.every((f) => {
    const ref = r1.refs.find((r) => r.file === f.where[0].file && r.line > 0 && r.path && r.path.replace(/\.(png|jpe?g)$/i, "") === f.path.replace(/\.(png|jpe?g)$/i, ""));
    if (!ref) return false;
    const d0 = imageSize(before.find((x) => x.path === f.path).bytes), d1 = imageSize(byPath.get(ref.path).bytes);
    return Math.max(d1.w, d1.h) <= 2000 && d1.w < d0.w && d1.h < d0.h;
  });
  ok(big0.length > 0 && reduced, `${t}: all ${big0.length} oversized images now <= 2000 px on the long side and still referenced`);
  ok(r1.findings.filter((f) => f.rule === "missing-figure").length === r0.findings.filter((f) => f.rule === "missing-figure").length, `${t}: no \\includegraphics broken by the renames`);
  const pdf = byPath.get("figures/spectra_plot.pdf");
  let pdfOk = null;
  try { execFileSync("pdftoppm", ["-v"], { stdio: "ignore" }); pdfOk = true; } catch { pdfOk = null; }
  if (pdfOk && pdf && r0.findings.some((f) => f.rule === "uncompressed-pdf")) {
    const tmp = `${DL}/${tag}-${label}-spectra.pdf`;
    (await import("node:fs")).writeFileSync(tmp, pdf.bytes);
    try { execFileSync("pdftoppm", ["-r", "20", "-png", "-singlefile", tmp, tmp.replace(/\.pdf$/, "")], { stdio: "pipe" }); } catch { pdfOk = false; }
    ok(pdfOk && pdf.size < before.find((x) => x.path === "figures/spectra_plot.pdf").size, `${t}: recompressed PDF figure is smaller and renders with pdftoppm`);
  }
  await p.locator("#fixed").scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${SHOTS}/${tag}-${label}-fixed.png` });
  return { inSize, outSize };
}

for (const [vp, tag] of [[{ width: 1280, height: 800 }, "desktop"], [{ width: 390, height: 844 }, "mobile"]]) {
  const s = await open(vp, tag);
  const { p } = s;
  ok((await p.title()).includes("texdiet"), `${tag}: title names texdiet`);
  ok(await p.isVisible("#drop"), `${tag}: drop zone visible`);
  ok(await p.$eval('a[href="https://voyager-from-space.github.io"]', (a) => !!a.offsetParent), `${tag}: link back to voyager portfolio visible`);
  ok(!(await p.isVisible("#results")), `${tag}: results panel hidden before any zip`);
  ok(await p.$eval('link[rel="canonical"]', (l) => l.href) === "https://texdiet.vercel.app/" && await p.$eval('meta[property="og:url"]', (m) => m.content) === "https://texdiet.vercel.app/", `${tag}: canonical and og:url point at https://texdiet.vercel.app/`);
  ok(await p.$$eval('a[href="./proof.html"]', (as) => as.some((a) => !!a.offsetParent)), `${tag}: link to timing notes is visible`);
  const caps = await p.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.textContent.trim() && getComputedStyle(e).textTransform === "uppercase").length);
  ok(caps === 0, `${tag}: no all-caps text-transform labels (${caps} found)`);
  ok(!/overleaf/i.test(await p.content()), `${tag}: brand name of the online editor never appears on the page`);
  const html = (await p.content()).toLowerCase();
  ok(deny.length > 0 && deny.every((d) => !html.includes(d)), `${tag}: 0 denylist hits in rendered html (${deny.length} patterns)`);
  await p.screenshot({ path: `${SHOTS}/${tag}-start.png` });

  await upload(p, SMALL);
  let f = await findings(p);
  ok(!(await p.textContent("#results")).includes("\u00b7"), `${tag}: no "A · B" dot pattern in the results`);
  ok(f.length >= 10, `${tag}: small fixture renders ${f.length} findings (>= 10)`);
  ok(f.every((x, i) => i === 0 || f[i - 1].score >= x.score), `${tag}: findings ranked by score, highest first`);
  ok(f.filter((x) => x.sev === "High").every((x) => /\.tex:\d+/.test(x.where)), `${tag}: every high finding points to file:line`);
  ok(f.some((x) => x.rule === "tikz-not-externalized" && x.title.startsWith("7 TikZ pictures")), `${tag}: counts 7 un-externalized TikZ pictures`);
  ok(f.some((x) => x.rule === "oversized-raster" && x.measured.includes("2068×1172 px")), `${tag}: reads 2068×1172 px from the PNG header`);
  ok(f.some((x) => x.rule === "missing-figure" && x.where.includes("chapters/results.tex:6")), `${tag}: flags the missing figure at chapters/results.tex:6`);
  ok(await p.$eval("#fix", (b) => !b.disabled), `${tag}: build-fixed-zip button enabled after diagnosis`);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag}: no horizontal overflow`);

  if (existsSync(HEAVY)) {
    await settle(p);
    await upload(p, HEAVY);
    f = await findings(p);
    ok(f[0]?.rule === "oversized-raster" && f[0].measured.startsWith("15.6 MB, 3400×3400 px"), `${tag}: heavy thesis top finding is the 15.6 MB 3400×3400 PNG`);
    ok(f.length === 17, `${tag}: heavy thesis renders ${f.length} findings (expected 17)`);
    ok(f.some((x) => x.rule === "uncompressed-pdf"), `${tag}: heavy thesis flags the uncompressed PDF figure`);
    ok((await p.textContent("#stats")).includes("35.1 MB"), `${tag}: stats show the measured 35.1 MB total`);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.locator("#results").scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${SHOTS}/${tag}-heavy-results.png` });
    await p.screenshot({ path: `${SHOTS}/${tag}-heavy-full.png`, fullPage: true });
    if (tag === "desktop") await checkFixed(p, tag, HEAVY, "heavy");
  } else console.log("SKIP  heavy fixture missing; run: python3 scripts/make-fixtures.py heavy");

  if (tag === "mobile" || !existsSync(HEAVY)) { await settle(p); await upload(p, SMALL); await checkFixed(p, tag, SMALL, "small"); }
  await p.evaluate(() => document.fonts.ready);
  ok(s.errors.length === 0, `${tag}: no console errors or failed requests${s.errors.length ? " -> " + s.errors.join(" | ") : ""}`);
  ok(s.external.length === 0, `${tag}: no requests leave the site${s.external.length ? " -> " + s.external.join(" ") : ""}`);
  await s.ctx.close();
}


for (const [vp, tag] of [[{ width: 1280, height: 800 }, "desktop"], [{ width: 390, height: 844 }, "mobile"]]) {
  await checkProof(vp, tag);
}

{
  const s = await open({ width: 1280, height: 800 }, "drag");
  const b64 = readFileSync(SMALL).toString("base64");
  const dt = await s.p.evaluateHandle((b) => {
    const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
    const d = new DataTransfer(); d.items.add(new File([bytes], "dropped.zip", { type: "application/zip" })); return d;
  }, b64);
  await s.p.dispatchEvent("#drop", "drop", { dataTransfer: dt });
  await s.p.waitForSelector("#results:not([hidden]) .finding");
  ok((await s.p.textContent("#res-title")).includes("dropped.zip"), "drag and drop a zip renders findings");

  await settle(s.p);
  await s.p.click("#sample");
  await s.p.waitForSelector("#results:not([hidden]) .finding");
  ok((await findings(s.p)).length >= 10, "sample thesis button renders findings");

  await settle(s.p);
  await s.p.setInputFiles("#file", { name: "notes.zip", mimeType: "application/zip", buffer: Buffer.from("not a zip") });
  await s.p.waitForFunction(() => document.getElementById("status").textContent.startsWith("Could not read"));
  ok(!(await s.p.isVisible("#results")), "a broken zip shows an error and no results");
  await s.p.evaluate(() => document.fonts.ready);
  ok(s.errors.length === 0, `drag/sample/error flows: no console errors${s.errors.length ? " -> " + s.errors.join(" | ") : ""}`);
  await s.ctx.close();
}

await browser.close();
server.kill();
console.log(`\n${passes} passed, ${fails} failed  (${BASE})`);
process.exit(fails ? 1 : 0);
