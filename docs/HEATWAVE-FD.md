# Heatwave signals for hydropower-shortfall warnings (future-detector back-test)

Source of the numbers: `web/public/data/heat_fd.json` (new file, follows docs/CONTRACTS.md). The analysis was run in the separate future-detector hydro back-test (scripts `hydro/heat_fetch.py`, `heat_build.py`, `heat_run.py`, `heat_export.py` there), reusing its v2 units, labels, split, baselines and bootstrap. This PR adds only this doc and that JSON file; no existing Patronus file, model or forecast is changed.

**Question:** Sichuan 2022 was missed by every model. Do heatwave signals (NASA POWER daily Tmax/T2M: heatwave days, Tmax anomaly, cooling degree days, 1-3 month lags) improve monthly hydropower-shortfall warnings, pooled, in summer, or for Sichuan?

## Verdict in six lines

1. **Heat adds no skill when pooled.** On 68 units (the 67 v2 units + Sichuan), hydro history + heat vs hydro history alone ranks shortfalls x1.006 [90% 1.001-1.011] at 1 month, x0.99 at 3 and x0.985 [0.977-0.997] at 6. Full v2 + heat vs full v2 gives x1.00 / x0.99 / x0.98. Brier skill does not change (+31% / +8-9% / 0% either way).
2. **Summer months: no gain either.** On Jun-Sep (NH) / Dec-Mar (SH) targets, heat gives x1.01 at 1 month and makes ranking worse at 3-6 months (x0.94-0.98, all intervals below 1). Results are the same on the capacity-corrected label.
3. **Only hint: snow/glacier-fed systems in summer.** On 15-18 hand-picked units (Alps, Nordics, Central Asia, US West, Sichuan), hydro + heat vs hydro gives x1.03-1.07 at 1-3 months on the capacity-corrected label (intervals above 1), but only x1.02 at 1 month on the brief's label. On top of the full model it adds nothing (x0.97-1.01). This is one subset among many comparisons, so treat it as suggestive.
4. **Sichuan 2022: still missed.** The heat was there: August 2022 had 10 heatwave days, Tmax +1.7 sd and cooling degree days +2.0 sd. But in Ember's provincial monthly data, Sichuan hydro in August 2022 is near normal (-1.7% YoY). Only September (-22% YoY) is a shortfall, and only on the capacity-corrected label. For September at 1 month ahead, full + heat gives P 0.03 and heat-only 0.29 (below the 0.40 alert rule). The national CHN series is not flagged earlier either (September P 0.13 -> 0.15 at 1 month).
5. **Why:** the heatwave and the generation drop came within the same 4-6 weeks, so monthly heat known at issue time cannot lead the event. Elsewhere, heat is mostly redundant with recent generation. Heat alone ranks better than climatology (x1.22 [1.11-1.33] at 1 month, capacity-corrected label), but its P >= 0.40 alerts are right 35-39% of the time against a 29-30% base rate.
6. **Verdict: do not add monthly heat features to the model.** A Sichuan-type flash heat-drought needs sub-monthly generation/inflow data and heat *forecasts* (e.g. S2S week 2-6 Tmax), not lagged monthly heat. The v2 conclusion stands: this is a 1-3 month ranking aid built on recent generation, with storage where it is measured.


## What was done

- **Data:** NASA POWER daily point API (MERRA-2 based, no key), T2M_MAX and T2M, 1990-01-01..2026-10-31. Up to 12 points per unit (a 3x3 grid per box, snapped to 0.5 deg). 330 points in total, 0 failed requests (future-detector `hydro/heat_fetch.py`). MODIS LST and direct MERRA-2 were not used: POWER already is MERRA-2-based and covers 1990+ daily; MODIS starts in 2000 and is cloud-gappy.
- **Sichuan unit (CHN_SC):** Ember China provincial monthly generation (`release_chn_subnational_generation_monthly.csv`, id `ember_china` in Patronus meta.json), Sichuan hydro 2016-01..2026-09. Sampling box: lon 97.3-108.6, lat 26.0-34.4, the same as pipeline/ uses for CHN-SC. Its v1/v2 water signals were computed with the unchanged build_v2 functions, restricted to this one box; the v2 panel was not rebuilt. It has only 5 training years (2016-2020), so its thresholds are thin.
- **Features** (future-detector `hydro/heat_build.py`; all use days up to the end of the issue month; climatologies use 1991-2020 only):
  - `hw_days`: days in the month inside a heatwave (Tmax above the calendar-day 90th percentile, +-7-day window, for >= 3 consecutive days). Computed per point, then averaged.
  - lags `hw_l1`, `hw_l2`, and the 3-month sum `hw_3m`
  - `tx_z`: monthly mean Tmax z vs the same calendar month, plus lags 1-2 and the 3-month mean
  - `cdd_z`: cooling degree days (base 18 C) z, plus the 3-month mean. In cold units with zero CDD climatology, z is set to 0 and capped at +-5.
- **Evaluation** (future-detector `hydro/heat_run.py`): calls `run_v2.run` unchanged, with the same split (train targets <= 2020, test 2021-01..2025-12), the learner chosen on 2018-2020 validation (logistic won everywhere except heat-only on the adjusted label), the same climatology and persistence baselines, 300-sample block bootstrap and P >= 0.40 rule. The model sets are hydro history ± heat, signals v2 ± heat, full v2 ± heat, and heat only.

## Main table (brief's label `short`, all 68 generation units, ~4,080 unit-months per lead, test base rate 29%)

| lead | clim | pers | hydro | hydro+heat | signals v2 | signals v2+heat | full v2 | full v2+heat | heat only |
|---|---|---|---|---|---|---|---|---|---|
| 1 AUC-PR | 0.326 | 0.534 | 0.668 | 0.672 | 0.457 | 0.457 | 0.676 | 0.676 | 0.339 |
| 3 AUC-PR | 0.328 | 0.397 | 0.498 | 0.494 | 0.386 | 0.379 | 0.488 | 0.483 | 0.317 |
| 6 AUC-PR | 0.323 | 0.354 | 0.440 | 0.433 | 0.314 | 0.306 | 0.405 | 0.396 | 0.293 |

The v2 numbers move by <= 0.003 vs the earlier future-detector v2 back-test only because Sichuan is added: on the 67 v2 units alone, full v2 reproduces it (AUC-PR 0.678 / 0.490 / 0.406 vs 0.678 / 0.490 / 0.407).

### Heat effect: AUC-PR ratio with heat / without [90% bootstrap]

| subset, label | lead 1 | lead 3 | lead 6 |
|---|---|---|---|
| all units, short: hydro+heat / hydro | 1.006 [1.001-1.011] | 0.992 [0.984-0.999] | 0.985 [0.977-0.997] |
| all units, short: full+heat / full | 1.001 [0.998-1.003] | 0.988 [0.982-0.995] | 0.978 [0.969-0.988] |
| all units, short_adj: hydro+heat / hydro | 1.009 [0.998-1.019] | 0.970 [0.949-0.994] | 0.958 [0.937-0.980] |
| summer targets, short: hydro+heat / hydro | 1.012 [1.003-1.020] | 0.977 [0.965-0.987] | 0.974 [0.962-0.986] |
| summer targets, short: full+heat / full | 1.003 [0.999-1.007] | 0.971 [0.961-0.980] | 0.965 [0.955-0.975] |
| snow/glacier, summer, short: hydro+heat / hydro | 1.024 [1.001-1.041] | 1.001 [0.986-1.018] | 0.993 [0.978-1.010] |
| snow/glacier, summer, short_adj: hydro+heat / hydro | 1.027 [1.009-1.051] | 1.065 [1.011-1.116] | 1.002 [0.956-1.050] |
| snow/glacier, summer, short_adj: full+heat / full | 1.005 [1.00-1.01] | 1.005 [0.98-1.03] | 0.980 [0.96-1.01] |
| heat only / climatology, short | 1.04 [0.95-1.13] | 0.97 [0.91-1.04] | 0.91 [0.85-0.97] |
| heat only / climatology, short_adj | 1.22 [1.11-1.33] | 1.14 [1.07-1.22] | 1.02 [0.96-1.09] |

Summer = target month Jun-Sep (box centre north of the equator) or Dec-Mar (south). Snow/glacier units, hand-picked before scoring: CHE, AUT, NOR, SWE, ISL, KGZ, TJK, PAK, GEO, CAN, NZL, US_WA, US_OR, US_ID, US_MT, US_CA, US_AZ, CHN_SC. Leads 2, 4 and 5 are in heat_results.json; they follow the same pattern.

## Sichuan and China 2022 (P(shortfall) issued 1 / 2 / 3 months ahead)

| unit, target | observed (short / short_adj) | full v2 | full v2 + heat | hydro + heat | heat only |
|---|---|---|---|---|---|
| CHN_SC 2022-08 | no / no | 0.001 / 0.000 / 0.003 | 0.001 / 0.000 / 0.004 | 0.000 / 0.000 / 0.004 | 0.19 / 0.15 / 0.21 |
| CHN_SC 2022-09 (short_adj) | no / **yes** | 0.030 / 0.017 / 0.006 | 0.032 / 0.017 / 0.007 | 0.067 / 0.009 / 0.007 | 0.29 / 0.12 / 0.09 |
| CHN 2022-08 (short_adj) | no / **yes** | 0.053 / 0.004 / 0.006 | 0.055 / 0.005 / 0.005 | 0.093 / 0.013 / 0.026 | 0.09 / 0.07 / 0.11 |
| CHN 2022-09 (short) | **yes** / yes | 0.134 / 0.024 / 0.002 | 0.153 / 0.030 / 0.003 | 0.067 / 0.011 / 0.003 | 0.36 / 0.22 / 0.16 |
| CHN 2022-10 (short) | **yes** / yes | 0.58 / 0.16 / 0.02 | 0.61 / 0.18 / 0.03 | 0.41 / 0.06 / 0.02 | 0.32 / 0.31 / 0.21 |

- **Sichuan heat at issue time:**
  - May 2022: 0 heatwave days, Tmax -1.4 sd
  - June: 0.3 heatwave days
  - July: 2.7 heatwave days, Tmax +0.6 sd
  - August: 10.3 heatwave days, Tmax +1.7 sd, CDD +2.0 sd
  - September: 0 heatwave days
  
  Spring 2022 was very wet (rain z +3.3 in May, soil +3.5), and generation ran 10-42% above the previous year from January to July. Nothing visible at a 2+ month lead pointed to a shortfall.
- **Label problem:** the crisis (power rationing from about 14-25 August 2022) lasted about two weeks. In monthly totals, August is still near normal because July-early August were strong; September is the low month.
- **Other named crises:** heat changes no lead materially.
  - Brazil SE/CO 2021 (brief's label): full + heat crosses 0.40 at 3 months (P 0.409, vs 0.362 without heat). This is a threshold artifact.
  - Heat-only P for SE/CO sat at 0.32-0.36 through early 2021 and edged to 0.41-0.47 in the crisis months: hot conditions in central Brazil, not a sharp signal.
  - Brazil national, Kariba, Vietnam and Ecuador: unchanged.

## Limits

- **Data latency is ignored, as in v2.** POWER daily is about 3 days behind, so heat is actually more timely than generation, but this was not exploited.
- **Heat forecasts were not used.** Only observed heat up to the issue month; no S2S Tmax forecasts.
- **Box sampling is coarse.** Up to 12 POWER points per unit, and Sichuan's box also covers parts of Yunnan, Tibet, Gansu and Chongqing.
- **Sichuan has only 5 training years (2016-2020).** Its capacity grew by more than 20 GW, so the brief's raw label rarely fires there.
- **One logistic coefficient per feature, pooled across units.** A unit-specific heat effect (e.g. melt-driven gains in glacier basins vs losses elsewhere) can cancel out when pooled. A per-regime model was not tried.
- **Many comparisons on one test period.** Intervals just above 1 are weak evidence.

## heat_fd.json shape

- `generated_at`, `sources` (meta.json ids), `question`, `design`, `features`, `heat_feature_names`, `labels`, `verdict` (six strings), `notes`
- `by_horizon.{short|short_adj}[]`: `{horizon, subset, n, n_shortfall, units, base_rate_shortfall, auc_pr{model}, bss_vs_climatology{model}, heat_effect{pair: {auc_pr_ratio, ci90, brier_gain_ci90}}}`
- `crises.{short|short_adj}[]`: `{name, unit, target_month, observed_shortfall, p_by_model{model: [{horizon, p_shortfall}]}, lead_months_p_ge_0_4{model}}`. Sichuan is `CHN-SC`; other unit codes are future-detector codes (e.g. `BRA_SE`, `US_WA`).
- Model keys: `climatology`, `persistence`, `hydro_history`, `hydro_plus_heat`, `signals`, `signals_plus_heat`, `full`, `full_plus_heat`, `heat_only`.
