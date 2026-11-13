# Upload a project zip

## Sub-features
- File picker (`#file`), drag and drop onto `#drop`, "Try a sample thesis" (`#sample`), error on a file that is not a zip.

## How to get to it (user POV)
Open the page. Click the dashed box or drop a .zip on it. Or click "Try a sample thesis" under it.

## Driving it with Playwright
`setInputFiles('#file', 'test/fixtures/small-thesis.zip')`; for drop, build a `DataTransfer` with a `File` in `page.evaluateHandle` and `dispatchEvent('#drop', 'drop', { dataTransfer })`. End state: `#results` visible, `#res-title` contains the file name, `#status` reads "Read N files in X ms, locally."

## Gotchas
- `#results` must be checked with `isVisible`, not the `hidden` property; a CSS `display` rule once overrode `[hidden]`.
- A zip with one top-level folder has it stripped, so paths read `chapters/intro.tex`, not `thesis/chapters/intro.tex`.
