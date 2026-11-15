# Future Detector lead-time test: do slow-memory signals push warnings past 3 months?

An independent test run in the Future Detector repo on 14 Nov 2026. It follows on from `BACKTEST-FD.md` (PR #1) and uses the same 67 units, split and baselines, extended from 6 to 12 forecast horizons. It is a second opinion: nothing in the app reads it yet, and no existing file is changed. Numbers are in `web/public/data/leadtime_fd.json`.

## Verdict
1. **No family lengthens the useful warning time.** We added reservoir storage from space, MODIS snow cover and seasonal forecasts (CFSv2/NMME rain, temperature and Niño3.4, plus IOD and PDO) to the v2 model. Ranking changed by x0.97-1.01 at every horizon from 1 to 12 months. The horizon where the model stops beating persistence got shorter, not longer: 10 months before, 8 after.
2. **Satellite storage is a good measurement but not a warning outside Brazil.** G-REALM altimetry was matched to GPPD dams and capacity-weighted, covering 43 units, 29 of them countries outside Brazil. The index correlates r = 0.93 with ONS measured storage in Brazil SE/CO. Outside Brazil it adds x1.00 over recent generation. **In Brazil, satellite storage alone matches the ONS EAR gain** (x1.10-1.23 at 2-5 months).
3. **Snow gives a small gain at 2-4 months only** (x1.02-1.03 on melt-season targets in 40 snow-fed units). It is gone by 6 months.
4. **Seasonal forecasts add nothing pooled** (x1.00). Their one visible effect: Brazil SE/CO 2021 is flagged **3 months** ahead instead of 1.
5. **The limit is calibration, not ranking.** Recent generation alone out-ranks persistence at every horizon to 12 months (x1.15-1.28). But its Brier skill vs climatology is only +3-5% beyond 3 months, and on our p20 label it beats persistence on Brier score only at 1 month.
6. **Crises:** Brazil national, Sichuan 2022, Vietnam 2023 and Ecuador 2024 are still missed. Kariba 2024's 12-month "lead" is persistence.

## Useful lead time (months), 67 units, test 2021-2025
"Ranking" means the AUC-PR ratio vs the baseline has its 90% interval above 1 at every horizon from 1 up to H. "Brier" means the Brier-score gain interval is above 0.

| model | ranking vs persistence | Brier vs persistence | Brier vs climatology | ranking vs persistence (capacity-corrected label) |
|---|---|---|---|---|
| recent generation only | 12 | 1 | 12 | 12 |
| v2 full model | 10 | 1 | 4 | 7 |
| + storage from space | 8 | 1 | 4 | 7 |
| + MODIS snow | 9 | 2 | 4 | 6 |
| + seasonal forecasts | 10 | 1 | 4 | 6 |
| + all three | 8 | 1 | 4 | 6 |
| recent generation + all three | 12 | 3 | 12 | 12 |

## Suggestions for Patronus
- **Use the satellite storage index where generation follows a large multi-year reservoir, as in Brazil.** It reproduced the gain from measured storage there. The matching takes G-REALM lakes (already a Patronus source) and GPPD plants within 0.5 degrees, weighted by MW. It is worth checking per system before trusting it. The per-unit coverage table is in the JSON under `storage_coverage`.
- **Do not expect seasonal rain forecasts to add skill at basin scale.** CFSv2 box-rain forecasts correlate only 0.13 with observed rain at 1 month and 0.06 at 6.
- **Recalibration matters more than new inputs** for any month-6+ message.

## Caveats
- **Same caveats as PR #1:** no publication-lag adjustment, no recalibration, a single 2021-25 test, and a p20 label (with the capacity-corrected label as a second view).
- **NMME:** one model only (CFSv2).
- **ENSO outlook:** the official CPC/IRI probabilities have no machine-readable archive, so a CFSv2 Niño3.4 forecast stands in. It is built from 2 m temperature over the Niño3.4 box (r = 0.80 with the observed ONI at 1 month).
- **SWOT:** not usable. It starts 2023-07, so there is no training overlap.
- **Source ids not in `meta.json`:** `modis_mod10cm`, `nmme_cfsv2`, `psl_dmi`, `ncei_pdo` and `eia_bulk` are listed under `external_sources_not_in_meta` in the JSON instead. We did not edit `meta.json`.
