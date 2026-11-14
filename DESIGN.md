# Patronus — "Months to Darkness"

NASA Space Apps 2026 · Challenge: **Be An Earth System Trend Detective!** (Advanced)
Status: **v1** (Nov 14, 2026). Team-facing version: `site/patronus-brief.html`.

> Branding: "Patronus" is used only as a word. No Harry Potter or NASA logos. Use distinct repo/URL names (e.g. `patronus-blackout-watch`).

## 1. Problem
Drought drains hydropower reservoirs, and that causes blackouts: Brazil 2021, Sichuan 2022, northern Vietnam 2023, Ecuador 2024, Kariba (Zambia/Zimbabwe) 2024, and the 2026 El Niño. Each time, the warning signs were in the data, and nobody turned them into action.

## 2. Product: three layers
1. **Trend (answers the challenge).** Mann-Kendall with an autocorrelation correction, Sen's slope, and Benjamini–Hochberg FDR. Applied to deseasonalized 2002–2026 GRACE/GRACE-FO water storage and GPM rainfall for every major hydropower basin, weighted by installed GW (WRI Global Power Plant Database). Caveats: the 2017–18 GRACE gap, and declines driven by groundwater pumping.
2. **Forecast.** The probability that hydro (or reservoir level) falls below a danger threshold in each of the next 1–6 months, with calibrated ranges.
3. **Decision and cost.** Expected shortfall (MWh) × replacement cost, plus blackout hours, comparing acting now with acting later. Validate against published 2024 cost estimates.

## 3. Scope: wide claim, deep demo
- **Automated everywhere:** the trend map, the warning indicator, the crisis scoreboard and the 2026 watchlist.
- **Hand-built for one place: Lake Kariba.** The 2024 replay, a dated 2027 forecast, the cost model and a full page.
  - Why Kariba: the Zambezi River Authority cut the 2027 power allocation by 36%. Usable storage was 36.7% on 14 Oct 2026. NOAA gives a very strong El Niño >90% odds, and SARCOF expects below-normal Jan–Mar 2027 rain. The Zambezi basin is large enough for GRACE-FO to resolve. SWOT has covered it since 2023.
- Ecuador and the others appear in the scoreboard and the opening montage, not as full pages.

## 4. Story arc
1. **This keeps happening:** the crisis scoreboard (alarm date vs. onset date, months of warning, false alarms in calm years).
2. **It's getting worse:** the global trend map ("X GW in significantly drying basins").
3. **It's happening now:** the 2026 watchlist.
4. **Zoom in:** the Kariba 2024 replay, then the 2027 forecast and cost.
5. **Check us:** a dated, public, timestamped forecast.

Pitch line, to be filled in from the backtest: "NASA's water data sees hydropower crises coming ~N months ahead."

## 5. Validation rules
- Every model must beat persistence and climatology. AI components get their own scoreboard rows.
- Use only data that existed on the forecast date (account for each dataset's latency).
- Report misses and false alarms alongside hits.
- Ablations only use datasets that exist across the whole backtest (GPM, SMAP, GRACE-FO, MODIS, S2S).
- Crisis onset dates are collected by hand from news, so the scoreboard doesn't depend on Ember monthly coverage.

## 6. Technology options (not yet chosen)
Each option must help us see earlier, decide better, explain clearly or prove it. Each plugs into the spine and has a fallback.
- **Jev** (TypeSafe System One model): typed decisions with calibrated probabilities. Candidate uses:
  - classifying GDELT news into typed crisis events;
  - setting the alert level (watch / warning / act);
  - checking each claim in the AI brief against the data.

  Jev is not the forecaster. It's in early access, and its speed and cost figures are vendor-reported.
- **Reservoirs from space:** SAM2 / Prithvi-EO-2.0 / TerraMind outlines plus SWOT heights give volume, for a watchlist of hundreds of reservoirs.
- **JEPA Earth world model:** a surprise alarm plus analog retrieval. Precedent: WeatherGenerator (NeurIPS 2026). Needs a GPU and must beat LightGBM.
- **Season scenarios:** the GEOS-S2S ensemble. Optionally ACE2 for scenario spread only.
- **Decision engine:** water balance plus stochastic optimization (SDDP-lite) plus conformal prediction.
- **AI analyst:** a Claude agent with tools, writing multilingual cited briefs. Also an MCP server.
- **Proof layer:** Black Marble blackout detection, plus cryptographic timestamps on forecasts.
- **The show:** a 3D globe, a 3D Kariba drawdown, a night-lights time-lapse, and a scrolling story page.

## 7. Open items
- Team size and owners per workstream.
- Access: GPU, Jev early-access key, Earth Engine.
- Data check: Kariba lake-level series, Ember coverage, the 2026 submission and demo rules.
- Exact danger threshold (e.g. below the 10th percentile for that calendar month) and forecast horizon.
- Primary user.

## Changelog
- v0 — Captured the initial brief.
- v1 — Global story with Kariba as the close-up; trend layer added; crisis scoreboard and 2026 watchlist; cost/decision layer; validation rules; technology options including Jev; team brief page.
