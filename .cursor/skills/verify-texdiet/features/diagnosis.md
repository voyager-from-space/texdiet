# Diagnosis

## Sub-features
- Stats row (files, total size, figures, main file), ranked finding cards (rank, severity, est. impact, title, measured, fix, file:line).

## How to get to it (user POV)
Upload any zip. The diagnosis appears under the drop zone.

## Driving it with Playwright
After upload read `#findings .finding` cards. Small fixture: 13 findings, a "7 TikZ pictures" card, a PNG card measuring "4000×3000 px", a missing-figure card at `chapters/results.tex:6`. Heavy fixture: 17 findings, top card "15.6 MB, 3400×3400 px", stats total "35.1 MB".

## Gotchas
- Scores are estimates for ranking. Do not word them as seconds.
- The heavy fixture exists only after `python3 scripts/make-fixtures.py heavy`; verify skips those checks if it is missing.
