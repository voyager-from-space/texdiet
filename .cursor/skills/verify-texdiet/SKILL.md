---
name: verify-texdiet
description: Drive the texdiet web app (static site in site/, LaTeX zip diagnosis) in headless Chromium and prove it works locally or on the live GitHub Pages URL. Use after any change to site/ or the rules, and before every push or deploy.
---

# verify texdiet

texdiet is a static page. The only surface is the browser. There is no server code.

## Launch

- Fixtures (once, or after editing `scripts/make-fixtures.py`): `python3 scripts/make-fixtures.py`. Writes `test/fixtures/small-thesis.zip` (committed) and `test/heavy/heavy-thesis.zip` (gitignored, downloads 8 NASA images on first run).
- Deps: `npm install` (Playwright 1.65.0; Chromium is already cached on the box).
- `node scripts/verify.mjs` starts its own `python3 -m http.server 4174` on 127.0.0.1 serving `site/`, waits 800 ms, and kills it at the end. Ready means the page title contains "texdiet".
- Live: `BASE_URL=https://voyager-from-space.github.io/texdiet/ SHOTS=screenshots/live node scripts/verify.mjs`. No server is started.

## Doctor

`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4174/rules.js` (local, while serving) or the live URL plus `rules.js`. Expect 200. If port 4174 is taken by something you did not start, stop and pick another port rather than killing it.

## Drive

Stable handles in `site/index.html`:
- `#file` hidden file input. Use `page.setInputFiles('#file', path)`.
- `#drop` drop zone. Dispatch a `drop` event with a `DataTransfer` built in the page.
- `#sample` loads `site/sample/sample-thesis.zip`.
- `#results` (hidden until a zip is read), `#res-title`, `#stats`, `#findings .finding` with `data-rule`, `.sev`, `.score`, `.measured`, `.where`.
- `#status` shows progress and errors.
- `#fix` is the fixed-zip button. Disabled until slice 2.

## Evidence

Screenshots go to `screenshots/local/` or `screenshots/live/` (`SHOTS` env): `<desktop|mobile>-start.png`, `-heavy-results.png`, `-heavy-full.png`. The script prints one PASS/FAIL line per check and a total. Exit code 1 on any failure. Before sharing any screenshot, open it and check it shows no usernames, paths, tabs or emails.

Proof standard: upload through the real input or drop event. Never call `analyze()` directly as a substitute for the page. Assert measured numbers (bytes, pixels, file:line), not just that cards exist.

## Cleanup

The script kills the server it spawned. If a run crashes, kill only the PID of the `http.server 4174` you started. Screenshots survive cleanup.

## Helpers

- `scripts/verify.mjs`: the harness above.
- `scripts/make-fixtures.py [small|heavy]`: fixture builder.
- `sh scripts/check-identity.sh`: denylist grep over the tree and tracked files. Run before every push, together with `git log --format='%an %ae %cn %ce' | sort -u`.
