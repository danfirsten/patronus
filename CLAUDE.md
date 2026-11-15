# Patronus: agent guide

NASA Space Apps 2026 hackathon project. Team of 3. **Submission deadline: Sun Nov 15, 2026, 11:59 PM local time.**

## What we're building
Patronus ("Months to Darkness") uses NASA water data to warn hydropower-dependent countries of power shortfalls months to decades ahead, and puts a price on waiting. Showpiece: Lake Kariba (Zambia/Zimbabwe). Global layers: drying-trend map of hydro basins (GRACE/GRACE-FO), ENSO fingerprints per grid, crisis scoreboard, 2026 watchlist.

## The challenge and judging
Challenge: **Be An Earth System Trend Detective!** (Advanced). Full text, judging criteria, submission rules and awards: [`docs/CHALLENGE.md`](docs/CHALLENGE.md).

- The challenge asks for a tool that selects NASA variables, gets them for a region, plots the time series, and measures the rate of change and its significance (t-test, Mann-Kendall, confidence intervals). Suggested audience: students and the science-literate public.
- Judged 1 to 5 on Impact, Creativity, Validity, **Relevance** (answers this challenge; NASA data is central) and Presentation.
- **Relevance risk:** Patronus is framed for finance ministries, not students. Wherever we pitch or describe it, make the challenge answer explicit: *this variable, this region, this trend (Sen's slope), this significance test (Mann-Kendall + FDR).*
- Demo: at most 7 slides or a 30-second video. English. Every external resource goes in the References field.

## Where things are
| Path | What |
|---|---|
| `DESIGN.md` | Concept, build decisions (section 11), and **current results and pitch guidance (section 12)**. Read section 12 first. |
| `docs/CONTRACTS.md` | JSON contract between the pipeline and the web app. |
| `docs/VERIFY.md` | How the hashed, timestamped forecast ledger works. |
| `DESIGN_SYSTEM.md` | "Drawdown" visual identity. |
| `pipeline/` | Python pipeline. Run everything: `python3 -m pipeline.run_all`. Writes `web/public/data/*.json`. |
| `web/` | Vite + React + TS static app. `cd web && npm install && npm run dev`. See `web/README.md`. |
| `data/reference/` | Checked-in data. `forecast/`: inputs the pipeline reads (countries, Kariba levels, ONI, GRACE box). `remediation/`: crisis actions, costs, ZRA readings. See `docs/DATA-TREE.md`. |
| `site/` | Team pages: concept brief and direction vote. |

## Rules
- **Real data only.** Never invent numbers. If something can't be computed, write `null` and a note (see `docs/CONTRACTS.md`). Use the verified wordings in `DESIGN.md` section 8.
- Report misses and false alarms alongside hits. Models must beat persistence and climatology to be part of a claim.
- No NASA logos or branding, no Harry Potter imagery. "Patronus" is just a word; Patronus AI is an unrelated company.
- When results change, update `DESIGN.md` section 12 so the pitch stays in sync with the numbers.
