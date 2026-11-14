# texdiet

Find what makes your LaTeX project slow to compile. Drop the project's source zip in the page and get a ranked list of the causes, each with the file and line and the size measured from your files.

**Use it:** https://texdiet.vercel.app (mirror: https://voyager-from-space.github.io/texdiet/)

Free online LaTeX editors cap compile time on their free plans, often at a few seconds. A thesis with a few full-resolution PNGs or a dozen TikZ figures can blow past that. texdiet tells you which files and lines to fix first.

Everything runs in your browser. The zip is read with JSZip in the tab and never uploaded.

## What it checks

| Rule | What it measures |
|---|---|
| Huge PNG/JPEG figures | bytes and pixel size, read from the PNG/JPEG header |
| Uncompressed or heavy PDF figures | PDF streams with no compression filter, file size |
| EPS figures | files that get converted to PDF on every compile |
| SVG via Inkscape | `svg` package, `\includesvg` |
| TikZ not externalized | `tikzpicture` and pgfplots axis count with no `\tikzexternalize` |
| pgfplots data | inline coordinates plus rows of `\addplot table` files |
| minted | shell-escape code blocks |
| fontspec | font families loaded |
| Slow packages | tabularray, acro, mhchem, forest |
| `[H]` floats | count of forced floats |
| Debug tracing | `\tracingall`, `\tracingonline` |
| Bibliography | `.bib` entry count and size |
| Missing figures | `\includegraphics` targets not in the zip |
| Unused images | images in the zip that nothing includes |
| Draft mode | large figure payload with no `draft` or `\includeonly` |

Findings are ranked by an estimated impact score. The score is a ranking aid, not a measured compile time.

## The fixed zip

Click **Build fixed zip** after the diagnosis and download `<name>-texdiet.zip`. In the browser, texdiet:

- downscales oversized figures to at most 2000 px on the long side (about 6.7 in at 300 dpi). Photos become JPEG at quality 85. A PNG stays PNG if it has transparency or ends up under 300 KB. A file is only replaced when the new copy is smaller.
- adds Flate compression to uncompressed PDF figures (simple PDFs only; anything else is left alone).
- adds `\tikzexternalize` with a `tikz-cache/` folder. It only switches on when shell-escape is on, so a compile without it behaves as before.
- leaves a `% texdiet:` comment above every edit, flags minted, EPS, SVG and big pgfplots data, and comments out debug tracing.
- never deletes content. When a figure path changes from `.png` to `.jpg`, the original line is kept in a `% texdiet:` comment. A `TEXDIET-CHANGES.txt` in the zip lists every change with before/after bytes.

Compile times were measured with pdfTeX 3.141592653-2.6-1.40.29 (TeX Live 2026) on an 8-core build machine. For the public proof thesis (8 pages, 7 TikZ pictures), a warm pdflatex pass without shell-escape went from 380.4 ms to 338.4 ms (median of 5, sides alternated). The gap is the smaller output PDF (28.2 MB to 3.2 MB) being written; a draft-mode run that does not write a PDF was 0.313 s against 0.318 s. After TikZ pictures were cached with shell-escape, later passes were 197.1 ms (first cache pass 1527.4 ms). Both versions compiled in under half a second on this machine. These times are not a measurement of a hosted editor's 10-second limit. The numbers and method are in [timing notes](https://texdiet.vercel.app/proof.html).

## Develop

```sh
npm install                       # playwright, for the verify script only
python3 scripts/make-fixtures.py  # builds test/fixtures/small-thesis.zip and test/heavy/heavy-thesis.zip
npm run serve                     # http://127.0.0.1:4174
npm run verify                    # headless checks, desktop + mobile
node scripts/build-fixed.mjs in.zip out.zip
python3 scripts/time-compile.py --orig in.zip --fixed out.zip --out test/timing/results.json
BASE_URL=https://voyager-from-space.github.io/texdiet/ SHOTS=screenshots/live npm run verify
```

`site/` is the whole app: plain HTML, CSS and JS, no build step. The rules live in `site/rules.js` as one table of pure functions.

The heavy test thesis uses public-domain NASA/JPL images from images-assets.nasa.gov.

## License

MIT. JSZip is bundled under its MIT license (`site/vendor/jszip-LICENSE.md`). IBM Plex fonts under the SIL OFL 1.1 (`site/fonts/OFL.txt`).
