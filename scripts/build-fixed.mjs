#!/usr/bin/env node
// Build a texdiet-fixed zip in headless Chromium the way a user would: upload, diagnose, click Build.
// Usage: node scripts/build-fixed.mjs <input.zip> [output.zip]
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url))) + "/";
const input = resolve(process.argv[2] || root + "test/heavy/proof-thesis.zip");
const outDefault = input.replace(/\.zip$/, "-texdiet.zip");
const output = resolve(process.argv[3] || outDefault);
const PORT = 4175;

if (!statSync(input, { throwIfNoEntry: false })) {
  console.error("missing input zip:", input);
  process.exit(1);
}

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", root + "site"], {
  stdio: "ignore",
});
const browser = await chromium.launch({ args: ["--font-render-hinting=none"] });
try {
  await new Promise((r) => setTimeout(r, 600));
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.setInputFiles("#file", input);
  await page.waitForSelector("#results:not([hidden]) .finding", { timeout: 120000 });
  await page.click("#fix");
  await page.waitForSelector("#fixed:not([hidden]) .change", { timeout: 120000 });
  mkdirSync(dirname(output), { recursive: true });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#download")]);
  await dl.saveAs(output);
  const before = statSync(input).size;
  const after = statSync(output).size;
  console.log(`wrote ${output} (${before} -> ${after} bytes, ${basename(output)})`);
} finally {
  await browser.close();
  server.kill();
}
