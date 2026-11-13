# Fixed zip (stub)

## Sub-features
- One-click download of a patched zip. Not built yet (slice 2).

## How to get to it (user POV)
The "Fixed zip: coming soon" button in the results header.

## Driving it with Playwright
Today: assert `#fix` is disabled. Slice 2: click it, capture the download with `page.waitForEvent('download')`, unzip it and assert it is smaller and still contains every .tex file.

## Gotchas
- No speed claim may appear on the page until compile times are measured (slice 3).
