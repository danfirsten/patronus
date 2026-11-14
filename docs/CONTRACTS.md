# Patronus data contracts

The pipeline (Python, `pipeline/`) writes JSON to `web/public/data/`. The web app (`web/`) reads only these files. The shapes are fixed; extra fields are fine. Rules for every file:

- Months are `"YYYY-MM"` strings. Dates are `"YYYY-MM-DD"`.
- Probabilities are 0–1. Percentages are named with a `_pct` suffix.
- Money is in millions of US dollars, with an `_musd` suffix.
- Missing values are `null`, never `NaN`.
- Every file has a top-level `"generated_at"` (ISO timestamp) and `"sources"`: a list of source ids that match `meta.json`.
- **Use real data only.** If something can't be computed, write `null` and add an explanation to a top-level `"notes"` list. Never invent numbers.

Probability → risk level, everywhere: P(shortfall) < 0.2 is `low`; 0.2–0.4 is `watch`; 0.4–0.6 is `warning`; ≥ 0.6 is `danger`.

---

## meta.json  (owner: integration)
```json
{"generated_at": "...", "issue_date": "2026-11-15",
 "sources": [{"id": "gravis", "name": "GRACE/GRACE-FO TWS (GFZ GravIS)", "provider": "NASA/GFZ", "nasa": true,
              "url": "...", "coverage": "2002-04..2026-08", "license": "..."}]}
```
Source ids: `ember_monthly`, `ember_yearly`, `ember_china`, `gravis`, `power`, `grealm`, `oni`, `cpc_enso`, `geos_s2s`, `gppd`, `hydrobasins`, `gibs_blackmarble`, `ons`, `zra`, `world_bank`, `imf`, `zesco_erb`, `news`.

## countries.json  (owner: generation)
48 hydro-dependent countries (hydro ≥ 30% share and ≥ 1 TWh, latest Ember year), plus Sichuan with `iso3: "CHN-SC"`.
```json
{"countries": [{"iso3": "ECU", "name": "Ecuador", "continent": "South America",
  "tier": 1, "hydro_share_pct": 70.4, "hydro_twh": 22.1, "hydro_gw": 5.1,
  "lat": -1.8, "lon": -78.2, "monthly_from": "2019-01", "monthly_to": "2026-08",
  "has_country_page": true}]}
```
Tiers: 1 = monthly generation forecast; 2 = reservoir forecast (satellite lake level); 3 = trend and ENSO exposure only. `lat`/`lon` is the capacity-weighted centroid of hydro plants.

## basins.geojson + trends.json  (owner: trend)
`basins.geojson`: simplified HydroBASINS level-4 polygons that contain hydro plants. Each has property `basin_id`. Keep it under about 3 MB.
```json
{"method": "Mann-Kendall (Hamed-Rao autocorrelation correction) + Sen slope on deseasonalized monthly GRACE/GRACE-FO TWS, 2002-04..2026-08; Benjamini-Hochberg FDR q<0.05 across basins",
 "period": {"from": "2002-04", "to": "2026-08"},
 "summary": {"n_basins": 0, "n_drying": 0, "n_wetting": 0, "gw_total": 0, "gw_drying": 0, "gw_wetting": 0,
             "headline": "X GW of hydropower sits in basins with a significant drying trend since 2002"},
 "basins": [{"basin_id": "1040000010", "name": null, "countries": ["ZMB", "ZWE"], "hydro_gw": 2.1, "n_plants": 4,
   "centroid": [28.1, -16.3],
   "tws_slope_cm_per_decade": -1.2, "tws_p": 0.01, "tws_q": 0.03,
   "precip_slope_pct_per_decade": -3.0, "precip_p": 0.2, "precip_q": 0.4,
   "trend_class": "drying",
   "series": {"months": ["2002-04", "..."], "tws_anom_cm": [0.1, "..."]}}]}
```
`trend_class` is one of `drying`, `wetting`, `no_significant_trend`, based on TWS q < 0.05. Include `series` only for the top 50 basins by GW, to keep the file small.

## enso.json  (owner: enso)
```json
{"method": "...",
 "summary": {"gw_el_nino_losers": 0, "gw_la_nina_losers": 0, "n_el_nino_losers": 0, "n_la_nina_losers": 0,
             "headline": "..."},
 "countries": [{"iso3": "ZMB", "name": "Zambia", "variable": "reservoir_level|hydro_generation|basin_precip",
   "el_nino_effect_pct": -18.0, "el_nino_p": 0.01, "la_nina_effect_pct": 4.0, "la_nina_p": 0.4,
   "n_el_nino": 10, "n_la_nina": 9, "record": "1981-2025",
   "exposure": "el_nino_loser|la_nina_loser|both|neutral",
   "season_note": "Effect is strongest in the Dec-Mar rainy season"}],
 "outlook": {"source": "NOAA CPC + NASA GEOS-S2S", "issued": "2026-11", "oni_latest": {"season": "ASO 2026", "value": 2.46},
             "status": "El Nino Advisory", "summary": "...",
             "geos_nino34_forecast": [{"season": "NDJ", "value": 3.99}]},
 "projections": {"text": "Extreme El Nino events are projected to roughly double...", "refs": [{"title": "...", "url": "..."}]}}
```
A country counts as a loser in a phase if its effect is ≤ −5% with permutation p < 0.1.

## watchlist.json  (owner: generation; Kariba rows merged by integration)
```json
{"issued": "2026-11-15",
 "countries": [{"iso3": "ECU", "name": "Ecuador", "tier": 1, "risk_level": "watch", "max_p_shortfall": 0.31,
   "months": [{"month": "2026-12", "p_shortfall": 0.12, "p_severe": 0.03,
               "anomaly_p10_pct": -20.0, "anomaly_p50_pct": -5.0, "anomaly_p90_pct": 8.0}],
   "drivers": ["Basin water storage 1.2 SD below normal", "El Nino: this grid usually loses 12%"],
   "enso_exposure": "el_nino_loser"}]}
```
`months` covers the next 6 months after the last observed month that can be forecast (state the first month). Anomalies are percent difference in hydro capacity factor from that calendar month's normal.

## country/{ISO3}.json  (owner: generation)
```json
{"iso3": "ECU", "name": "Ecuador", "tier": 1,
 "history": [{"month": "2019-01", "hydro_twh": 1.9, "cf_anom_pct": -3.0, "shortfall": false, "severe": false}],
 "drivers_now": {"tws_anom_sd": -1.2, "precip_3m_anom_pct": -25.0, "soil_root_anom_sd": -0.8, "oni": 2.46},
 "backtest": [{"issue": "2023-09", "target": "2023-10", "horizon": 1, "p_shortfall": 0.7, "observed_shortfall": true}],
 "forecast": {"issued": "...", "months": ["... same shape as watchlist months ..."]},
 "analogs": [{"month": "2023-08", "similarity": 0.91, "shortfall_next_6m": true}],
 "costs": {"replacement_usd_per_kwh": 0.20, "voll_usd_per_kwh": 1.0,
           "expected_cost_next_6m_musd": {"p10": 0, "p50": 0, "p90": 0}}}
```

## generation_backtest.json  (owner: generation)
```json
{"design": "Blocked leave-one-year-out CV with a 12-month gap; pooled LightGBM across tier-1 countries; features respect publication lags",
 "n_countries": 23, "n_country_months": 0, "base_rate_shortfall": 0.0,
 "by_horizon": [{"horizon": 1, "brier": 0.0, "bss_vs_climatology": 0.0, "bss_vs_persistence": 0.0, "bss_vs_enso_only": 0.0,
                 "auc_pr": 0.0, "auc_pr_climatology": 0.0, "auc_pr_ci90": [0.0, 0.0]}],
 "reliability": [{"horizon": 3, "bins": [{"p_mean": 0.1, "observed_rate": 0.08, "n": 120}]}],
 "ablations": [{"removed": "gravis", "horizon": 3, "auc_pr": 0.0, "delta_vs_full": 0.0}],
 "feature_importance": [{"feature": "tws_anom_sd", "gain_share": 0.2}],
 "limitations": ["..."]}
```

## kariba.json  (owner: kariba)
```json
{"thresholds": {"min_operating_m": 475.5, "max_operating_m": 488.5, "warning_usable_pct": 20, "danger_usable_pct": 10},
 "storage_curve": {"method": "...", "points": [{"level_m": 475.5, "usable_pct": 0}]},
 "history": [{"date": "1992-11-22", "level_m": 476.6, "usable_pct": 8.0}],
 "latest": {"date": "2026-11-09", "level_m": 479.92, "usable_pct": 31.0, "zra_gauge": {"date": "2026-11-10", "level_m": 479.98, "usable_pct": 31.7}},
 "backtest": {"design": "...", "by_horizon": ["... same metrics shape as generation_backtest.by_horizon ..."],
              "ablation_no_grace": ["..."],
              "crisis_2024": {"first_warning_p_gt_0_5": "2023-..", "first_danger_p_gt_0_5": "2023-..",
                              "zra_allocation_cut": "2023-12-28", "load_shedding_start": "2024-03-11",
                              "lead_months_vs_load_shedding": 0, "lead_months_vs_zra": 0}},
 "forecast": {"issued": "2026-11-15", "months": [{"month": "2026-12", "usable_p10": 0, "usable_p50": 0, "usable_p90": 0,
              "p_below_warning": 0, "p_below_danger": 0}]},
 "zra_projection": {"end_2027_usable_pct": 9, "end_2027_level_m": 476.8, "allocation_2027_bcm": 23, "cut_pct": 36, "source_url": "..."},
 "enso": {"el_nino_years": ["..."], "mean_level_change_el_nino_m": 0, "mean_level_change_other_m": 0, "p": 0},
 "analogs": [{"date": "2023-10", "similarity": 0.9, "what_happened": "Fell to 2.9% usable by Dec 2024"}],
 "cost_of_waiting": {"assumptions": {"replacement_contracted_usd_per_kwh": 0.17, "replacement_emergency_usd_per_kwh": 0.26,
                     "voll_usd_per_kwh": 1.0, "source": "ZESCO ERB filing Jul 2024; VoLL literature"},
                     "curve": [{"action_month": "2026-12", "expected_cost_musd_p10": 0, "expected_cost_musd_p50": 0, "expected_cost_musd_p90": 0}],
                     "headline": "Waiting from December to April adds about $X M in expected costs"},
 "other_reservoirs": [{"name": "Cahora Bassa", "country": "MOZ", "grealm_id": "...", "latest_level_m": 0, "anomaly_m": 0}]}
```

## crises.json  (owner: integration, hand-curated with sources)
## scoreboard.json  (owner: integration, built from the backtests)
```json
{"rows": [{"id": "kariba-2024", "name": "Lake Kariba 2024", "countries": ["ZMB", "ZWE"], "enso": "El Nino",
  "official_warning": "2023-12-28", "onset": "2024-03-11",
  "patronus_alarm": "2023-10", "lead_months": 5, "lead_vs_official_months": 2,
  "caught_by": "now|next|both|missed", "notes": "..."}],
 "false_alarms": {"per_country_5yr": 0.0, "definition": "..."}}
```

## nightlights.json + img/nightlights/*.png  (owner: proof)
```json
{"frames": [{"id": "zambia-2024-02", "place": "Lusaka and Copperbelt", "date": "2024-02-15", "src": "img/nightlights/zambia-2024-02-15.png",
  "bbox": [25, -17, 30, -12], "caption": "Before load-shedding"}]}
```

## ledger.json  (owner: proof)
```json
{"entries": [{"file": "kariba.json", "sha256": "...", "logged_at": "2026-11-15T...", "ots": "ledger/kariba.json.ots|null",
  "verify": "sha256sum web/public/data/kariba.json"}]}
```

## briefs/{id}.md  (owner: integration)
AI-written briefs, generated after the numbers exist. Each is labelled as AI-written and checked against the data.
