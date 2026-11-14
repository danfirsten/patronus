# Patronus — "Months to Darkness"

NASA Space Apps 2026 · Challenge: **Be An Earth System Trend Detective!** (Advanced)
Status: **v0, the starting brief.** Nothing below has been revised yet. Each change we agree on gets an entry in the changelog at the bottom.

> Branding: "Patronus" is used only as a word. No Harry Potter logos, fonts or artwork. Use distinct repo/URL names (e.g. `patronus-blackout-watch`) to avoid confusion with Patronus AI.

## 1. Problem
Drought drains hydropower reservoirs, which leads to blackouts and economic and political fallout. This happens again and again: Brazil 2021, Sichuan 2022, northern Vietnam 2023, Ecuador 2024, Zambia/Zimbabwe (Kariba) 2024, and the 2026 El Niño (India, Asia, the Alps, southern Norway).
What these cases share: the warning signs were there, but nothing turned them into action.

## 2. Concept
For a hydro-dependent grid, forecast the **probability that hydro output falls below a danger threshold in each of the next 1–6 months**. Add:
- an alarm for when conditions stop looking like normal variation;
- an AI-written plain-language brief for decision-makers.

Pitch line (it must be proven by our backtests): *"Every blackout we studied cast a shadow in NASA's data first."*

## 3. Data layers
1. **Water arriving:** GPM rainfall, SMAP soil moisture, GRACE-FO total water storage, MODIS snow cover.
2. **Water stored:** SWOT reservoir heights; reservoir surface area from Landsat/HLS/Sentinel-2 (via Prithvi-EO); NISAR radar.
3. **Water to come:** GEOS-S2S seasonal forecasts.
4. **Labels:** Ember monthly hydro generation; national operators (ONS, ENTSO-E).
5. **Outcome check:** Black Marble nighttime lights (Suomi NPP archive; NOAA-20/21 going forward).
6. **OSINT:** GDELT and news, rationing announcements, spot prices, search trends, turned into a dated event timeline by an AI.

Backbone: Google Earth Engine (alternative: `earthaccess`).

## 4. Model ladder
1. Baselines: climatology, persistence.
2. LightGBM with quantile outputs (the guaranteed demo).
3. Small JEPA latent world model; its "surprise" is the alarm signal.
4. Foundation-model features: Prithvi-EO, AlphaEarth embeddings.
5. Conformal prediction for calibrated probability ranges.

## 5. Validation
- Leave-one-crisis-out backtest (the 5 crises), plus calm years to measure false alarms.
- Headline metric: months of warning at a fixed false-alarm rate. Also Brier score and quantile loss.
- Ablations: remove one NASA dataset at a time.
- Live, dated predictions for grids stressed by the 2026 El Niño.

## 6. Extras
- What-if reservoir water-balance simulator.
- AI analyst brief in the country's language, with citations.
- Ecuador blackout replay (Jan 2024 warning → April blackouts) as the pitch opener.

## 7. Weekend deliverable
World risk map; a page per country with a gauge, probability bands and the brief; an alert feed or API. 2–3 countries done properly.
Saturday night: LightGBM and backtests working. Sunday stretch goals: JEPA alarm, what-if simulator.

## 8. Open questions
- Demo countries
- Danger threshold and forecast horizon
- Whether the JEPA is worth the risk
- How explicitly to show statistical significance
- Primary user
- Story arc, visual identity, demo flow

## Changelog
- v0 — Captured the initial brief.
