// end-to-end check of texdiet in headless chromium, desktop + mobile.
// local: serves site/ on 127.0.0.1:4174.  live: BASE_URL=https://voyager-from-space.github.io/texdiet/ SHOTS=screenshots/live npm run verify
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const PORT = 4174, LIVE = process.env.BASE_URL, BASE = LIVE || `http://127.0.0.1:${PORT}/`;
const SHOTS = root + (process.env.SHOTS || "screenshots/local");
const SMALL = root + "test/fixtures/small-thesis.zip", HEAVY = root + "test/heavy/heavy-thesis.zip";
mkdirSync(SHOTS, { recursive: true });
const server = LIVE ? { kill() {} } : spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", root + "site"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

const denyFile = root + ".identity-denylist";
const deny = existsSync(denyFile) ? readFileSync(denyFile, "utf8").split("\n").map((l) => l.trim().toLowerCase()).filter(Boolean) : [];
let fails = 0, passes = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); cond ? passes++ : fails++; };
const browser = await chromium.launch();

async function open(viewport, tag) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1 });
  const p = await ctx.newPage();
  const errors = [], external = [];
  p.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(`${m.type()}: ${m.text()}`); });
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("requestfailed", (r) => errors.push("requestfailed: " + r.url()));
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

for (const [vp, tag] of [[{ width: 1280, height: 800 }, "desktop"], [{ width: 390, height: 844 }, "mobile"]]) {
  const s = await open(vp, tag);
  const { p } = s;
  ok((await p.title()).includes("texdiet"), `${tag}: title names texdiet`);
  ok(await p.isVisible("#drop"), `${tag}: drop zone visible`);
  ok(await p.$eval('a[href="https://voyager-from-space.github.io"]', (a) => !!a.offsetParent), `${tag}: link back to voyager portfolio visible`);
  ok(!(await p.isVisible("#results")), `${tag}: results panel hidden before any zip`);
  ok(!/overleaf/i.test(await p.content()), `${tag}: brand name of the online editor never appears on the page`);
  const html = (await p.content()).toLowerCase();
  ok(deny.length > 0 && deny.every((d) => !html.includes(d)), `${tag}: 0 denylist hits in rendered html (${deny.length} patterns)`);
  await p.screenshot({ path: `${SHOTS}/${tag}-start.png` });

  await upload(p, SMALL);
  let f = await findings(p);
  ok(f.length >= 10, `${tag}: small fixture renders ${f.length} findings (>= 10)`);
  ok(f.every((x, i) => i === 0 || f[i - 1].score >= x.score), `${tag}: findings ranked by score, highest first`);
  ok(f.filter((x) => x.sev === "high").every((x) => /\.tex:\d+/.test(x.where)), `${tag}: every high finding points to file:line`);
  ok(f.some((x) => x.rule === "tikz-not-externalized" && x.title.startsWith("7 TikZ pictures")), `${tag}: counts 7 un-externalized TikZ pictures`);
  ok(f.some((x) => x.rule === "oversized-raster" && x.measured.includes("4000×3000 px")), `${tag}: reads 4000×3000 px from the PNG header`);
  ok(f.some((x) => x.rule === "missing-figure" && x.where.includes("chapters/results.tex:6")), `${tag}: flags the missing figure at chapters/results.tex:6`);
  ok(await p.$eval("#fix", (b) => b.disabled), `${tag}: fixed-zip button is present and disabled (next slice)`);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag}: no horizontal overflow`);

  if (existsSync(HEAVY)) {
    await p.reload({ waitUntil: "networkidle" });
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
  } else console.log("SKIP  heavy fixture missing; run: python3 scripts/make-fixtures.py heavy");

  ok(s.errors.length === 0, `${tag}: no console errors or failed requests${s.errors.length ? " -> " + s.errors.join(" | ") : ""}`);
  ok(s.external.length === 0, `${tag}: no requests leave the site${s.external.length ? " -> " + s.external.join(" ") : ""}`);
  await s.ctx.close();
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

  await s.p.reload({ waitUntil: "networkidle" });
  await s.p.click("#sample");
  await s.p.waitForSelector("#results:not([hidden]) .finding");
  ok((await findings(s.p)).length >= 10, "sample thesis button renders findings");

  await s.p.reload({ waitUntil: "networkidle" });
  await s.p.setInputFiles("#file", { name: "notes.zip", mimeType: "application/zip", buffer: Buffer.from("not a zip") });
  await s.p.waitForFunction(() => document.getElementById("status").textContent.startsWith("Could not read"));
  ok(!(await s.p.isVisible("#results")), "a broken zip shows an error and no results");
  ok(s.errors.length === 0, `drag/sample/error flows: no console errors${s.errors.length ? " -> " + s.errors.join(" | ") : ""}`);
  await s.ctx.close();
}

await browser.close();
server.kill();
console.log(`\n${passes} passed, ${fails} failed  (${BASE})`);
process.exit(fails ? 1 : 0);
