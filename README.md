# texdiet

Find what makes your LaTeX project slow to compile. Drop the project's source zip in the page and get a ranked list of the causes, each with the file and line and the size measured from your files.

**Use it:** https://voyager-from-space.github.io/texdiet/

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

Coming next: one-click fixed zip (images downscaled, slow patterns commented out) with a before/after size list.

## Develop

```sh
npm install                       # playwright, for the verify script only
python3 scripts/make-fixtures.py  # builds test/fixtures/small-thesis.zip and test/heavy/heavy-thesis.zip
npm run serve                     # http://127.0.0.1:4174
npm run verify                    # headless checks, desktop + mobile
BASE_URL=https://voyager-from-space.github.io/texdiet/ SHOTS=screenshots/live npm run verify
```

`site/` is the whole app: plain HTML, CSS and JS, no build step. The rules live in `site/rules.js` as one table of pure functions.

The heavy test thesis uses public-domain NASA/JPL images from images-assets.nasa.gov.

## License

MIT. JSZip is bundled under its MIT license (`site/vendor/jszip-LICENSE.md`). IBM Plex fonts under the SIL OFL 1.1 (`site/fonts/OFL.txt`).
