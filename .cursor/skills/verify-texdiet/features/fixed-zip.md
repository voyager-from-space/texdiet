# Fixed zip

## Sub-features
- Build button (`#fix`), result panel (`#fixed`) with the before/after bytes table (`#bytes`), change list (`#changes .change[data-kind]`), download link (`#download`, file `<name>-texdiet.zip`).

## How to get to it (user POV)
Upload a zip, then click "Build fixed zip" in the Diagnosis header. Click the amber Download button.

## Driving it with Playwright
`click('#fix')`, wait for `#fixed:not([hidden]) .change`, then `Promise.all([page.waitForEvent('download'), page.click('#download')])` and `download.saveAs(...)`. Unzip in Node with the `jszip` dev dependency and assert: smaller than the input, every .tex/.bib/.cls/.sty present, every original source line still present (or kept in a `% texdiet: ... Original line:` comment), images decode in the browser, oversized images now <= 2000 px and still referenced, `\tikzexternalize[prefix=tikz-cache/]` in main.tex, PDF renders with `pdftoppm` when installed. Downloads land in `test/out/` (gitignored).

## Gotchas
- Zip size depends on content: flat synthetic images deflate to almost nothing, so a JPEG replacement can make the zip bigger. The fixtures use real NASA photos for that reason.
- No speed claim may appear on the page until compile times are measured (slice 3).
