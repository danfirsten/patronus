# Patronus — "Months to Darkness"

NASA Space Apps 2026 · Challenge: **Be An Earth System Trend Detective!** (Advanced)
Status: **v2, ready to build** (Nov 14, 2026). Submissions close **Sun Nov 15, 11:59 PM local time**.
Team pages: `site/patronus-brief.html` (concept, v1), `site/team-vote.html` (vote on direction).

> Branding: "Patronus" is used only as a word. No Harry Potter or NASA logos. Use distinct repo/URL names (e.g. `patronus-blackout-watch`); Patronus AI is an unrelated company.

---

## 1. One-liners

| | |
|---|---|
| **Problem** | When drought drains hydropower reservoirs, countries pay dearly: Ecuador lost an estimated 1–1.5% of GDP in 2024, and Vietnam about $1.4B in 2023. The warning signs were in NASA's data months earlier, but no tool turned them into a decision in time. |
| **Audience** | Finance ministries, regulators and development lenders in hydro-dependent emerging economies. They bear the cost of acting late but have no independent early warning. Secondary: journalists, investors, insurers, large manufacturers. |
| **Solution** | Patronus uses NASA water data to warn hydro-dependent countries of power shortfalls from months to decades ahead, and says what waiting will cost and when to act. |
| **Challenge answer** | We find which hydropower basins are significantly drying since 2002 (where, by how much, how significant), and how each grid's hydropower responds to El Niño and La Niña. |
| **Differentiator** | Other tools show that water is changing. Patronus is an independent, public warning that puts a price on delay. |
| **Proof** | The same pipeline is run on five past crises and many calm years. We report months of warning, misses and false alarms. |
| **Why now** | A very strong El Niño is under way, and Lake Kariba's 2027 power allocation has already been cut by 36%. |
| **Pitch line** | "The warning existed. Patronus makes ignoring it expensive and public." |
| **Pitch opener** | "Ecuador's grid operator warned in December 2023 that drought would bring blackouts. Ten months later, Ecuadorians were living with 14 hours of darkness a day, at a cost of up to 1.5% of GDP." |

## 2. Product: three time horizons
| Horizon | Driven by | Output | Type of action |
|---|---|---|---|
| **Now, 0–6 months** | Water already stored and arriving (GRACE-FO, SMAP, GPM, MODIS snow, SWOT), plus GEOS-S2S | Monthly probability of a hydro shortfall, with calibrated ranges, and the cost of waiting | Reactive: ration, tariffs, emergency imports |
| **Next, 6–18 months** | Official ENSO forecast (NOAA CPC / IRI) × the grid's **ENSO fingerprint** | "El Niño is coming; your grid usually loses X% under it" | Proactive: hold water, contract imports early, plan backup generation, budget |
| **Later, decades** | GRACE/GPM drying trend + projected rise in extreme El Niños | Structural exposure | Preventive: diversify, interconnect, change reservoir rules |

- **We do not build an ENSO forecaster.** NOAA, IRI and WMO already do this well. We consume their forecasts.
- **ENSO fingerprint:** for each grid, how its hydro output and basin water historically respond to El Niño and La Niña, with permutation-test significance. Both phases matter. About 35% of the world's hydro dams show reliable ENSO anomalies (Ho et al. 2017, ERL). Large reservoirs dampen the effect, so use generation and storage, not only rain.
- **Cost layer:** expected shortfall (MWh) × replacement cost ($/MWh), plus blackout hours × GDP loss per hour. Compare acting now with acting in N months. Validate against Ecuador 2024, Vietnam 2023 and Zambia 2024 estimates.
- **Shared-exposure feature** (adapted from HarvestShield): "your backup grid is in the same drought." Example: Colombia cut exports to Ecuador on Oct 1, 2024. Zambia and Zimbabwe share Kariba.

## 3. What we show: wide claim, deep demo
**Automated everywhere:**
1. **Global trend map.** Every major hydropower basin. Mann-Kendall (with an autocorrelation correction) + Sen's slope + Benjamini–Hochberg FDR on deseasonalized GRACE/GRACE-FO water storage and GPM rainfall, weighted by installed GW (WRI Global Power Plant Database). Headline: "X GW in significantly drying basins."
2. **ENSO exposure map.** Which grids lose under El Niño, which under La Niña, and by how much. Headline: "X GW in grids that lose under El Niño, and extreme El Niños are projected to double."
3. **Crisis scoreboard.** Brazil 2021, Sichuan 2022, Vietnam 2023, Ecuador 2024, Kariba 2024, plus calm years. Columns: when the alarm fired (by horizon), when the crisis began, months of warning, false alarms. Note which layer would have caught each crisis (e.g. Sichuan 2022 was a heatwave, not ENSO).
4. **2026 watchlist.** Every hydro-dependent grid ranked today.

**Hand-built for one place: Lake Kariba (Zambia/Zimbabwe).**
- 2024 replay: Black Marble night lights going dark, next to the NASA signal and the news timeline.
- 2027 forecast across all three horizons, with the cost model, and a dated, timestamped public prediction.
- Hook: NOAA flagged a likely very strong El Niño in June 2026, about 5 months before the Zambezi River Authority cut the 2027 allocation.

## 4. Story arc (demo and pitch)
1. **This keeps happening:** a montage of the five crises, then the scoreboard.
2. **It's getting worse:** the trend map and the ENSO exposure map.
3. **It's happening now:** the 2026 watchlist.
4. **Zoom in:** Kariba 2024 replay, then 2027 across the three horizons, with costs.
5. **Check us:** a timestamped public forecast.

## 5. Validation rules
- Every model must beat persistence and climatology on held-out data, or it isn't part of the claim. AI components get their own scoreboard rows.
- Use only data that existed on each forecast date, including dataset latency (e.g. GRACE-FO is roughly 2 months behind).
- The main test runs on many country-months. The five crises are illustrations, not the whole test. Lesson from Future Detector's Africa alarm, which rested on one drought.
- Report misses and false alarms alongside hits.
- Ablations only use datasets that span the whole backtest (GPM, SMAP, GRACE-FO, MODIS, S2S). SWOT starts in 2023 and NISAR in 2025.
- ENSO fingerprints use longer records than GRACE where possible (rainfall back to the 1980s), because the GRACE era has only about 5 El Niños and 5 La Niñas.

## 6. Data
| Layer | Source |
|---|---|
| Water storage | GRACE / GRACE-FO mascons (2002–) |
| Rain | GPM IMERG |
| Soil moisture | SMAP L4 |
| Snow | MODIS snow cover |
| Reservoirs | SWOT heights (2023–); Sentinel-2 / HLS water extent |
| Seasonal outlook | NASA GEOS-S2S |
| ENSO | NOAA ONI / Niño-3.4 history; CPC and IRI forecasts |
| Labels | Ember monthly generation by fuel; ZRA Kariba lake levels; ONS (Brazil); CENACE (Ecuador) |
| Hydro capacity | WRI Global Power Plant Database |
| Outcomes | Black Marble night lights (VNP46; Suomi NPP archive, NOAA-20/21 onward) |
| Crisis timeline | GDELT and news, plus hand-collected onset dates |

Backbone: Google Earth Engine, with `earthaccess` as a fallback.

## 7. Engine and technology
**Recommended base (team vote pending):** Future Detector's working pipeline, switched from 10 km fire cells and weeks to basins/countries and months. Keep from it:
- held-out testing and bootstrap confidence intervals;
- ablations;
- look-alike past cases;
- the hashed prediction ledger;
- the Proof page and its "what it can't do" section.

**Core model:** gradient boosting (LightGBM) with quantile outputs and conformal calibration, against persistence and climatology baselines.

**Options** (each must help us see earlier, decide better, explain clearly or prove it, and each needs a fallback):
- **Jev** (TypeSafe, early access): turn GDELT news into typed crisis events; set the alert level (watch / warning / act); check each claim in the AI brief against the data. It is not the forecaster.
- **Reservoirs from space:** SAM2 / Prithvi-EO-2.0 / TerraMind water outlines + SWOT heights → volume, for a watchlist of hundreds of reservoirs.
- **JEPA world model:** a surprise alarm and look-alike past states. Needs a GPU and must beat LightGBM.
- **Decision engine:** water balance + stochastic optimization → recommended rationing schedule and cost-of-waiting curve.
- **AI analyst:** a Claude agent with tools that writes multilingual, cited briefs. Patronus is also exposed as an MCP server.
- **Proof layer:** Black Marble outage detection plus cryptographic timestamps on forecasts.
- **The show:** 3D globe, 3D Kariba drawdown, night-lights time-lapse, scrolling story page.

## 8. Verified facts (use these wordings)
- **Vietnam 2023:** about $1.4B, roughly 0.3% of GDP, a preliminary World Bank estimate (Aug 2023).
- **Ecuador 2024:** about 1–1.5% of GDP per Finance Minister Vega. The Guayaquil chamber of commerce put early-2024 losses above $1.44B.
  - CENACE warned in Dec 2023 that blackouts would come in the 2024–25 dry seasons.
  - Cuts rose to 14 h/day on Oct 24, 2024.
  - **Do not say** "warned in January, nothing until April." That claim is unconfirmed.
- **Kariba:** the 2027 power allocation was cut 36% (36 → 23 BCM). Usable storage was 36.7% on 14 Oct 2026. ZRA projects 9% at the end of 2027 if the full allocation is used.
- **ENSO:** NOAA (Oct 2026) puts the odds above 83% of a strong-to-very-strong El Niño through Jan–Mar 2027. SARCOF expects below-normal rain over most of central and southern SADC, Zambia and Zimbabwe included, in Jan–Mar 2027.
- **Projections:** extreme El Niños roughly double, from about once every 20 years to about once a decade (Cai et al. 2014), and keep rising after warming stabilizes (Wang et al. 2020).
- **Still to verify:** the Brazil 2021 link to La Niña; the Brazil and Sichuan figures from the original brief.

## 9. Landscape (we checked whether this exists)
- **HydroForecast (Upstream Tech):** paid inflow forecasts for operators, mostly 0–10 days ahead.
- **S2S4E:** an EU research tool, now ended.
- **Smart Climate Hydropower Tool:** single-basin research tool.
- **Nordic hydro-balance services:** paid, for power traders.
- **Drought monitors:** don't connect drought to electricity.
- **Operators' internal models:** not public.

We found nothing public, free and global that links satellite water data and ENSO to a country's shortfall risk, prices it, and publishes a track record.

## 10. Weekend plan
| When | Must have |
|---|---|
| Sat, first hours | Settle the open questions (section 11). Data access. Read the 2026 submission guide. |
| Sat afternoon | Trend map; ENSO fingerprints; crisis onset dates collected |
| Sat night | Kariba forecast + backtest vs baselines; cost model |
| Sun morning | Web app: maps, scoreboard, watchlist, Kariba page |
| Sun 3 PM | **Feature freeze.** Video, project page, slides. |
| Sun by 6 PM | Submission uploaded; buffer until 11:59 PM |

## 11. Open questions
See the latest list in the conversation; record each decision here as it is made.

## Changelog
- v0 — Captured the initial brief.
- v1 — Global story with Kariba as the close-up; trend layer; scoreboard and watchlist; cost layer; validation rules; technology options including Jev.
- v2 — Problem statement with verified costs; audience changed to finance ministries, regulators and lenders; watchdog positioning after the landscape check; three time horizons with ENSO fingerprints (no in-house ENSO forecaster); shared-exposure feature from HarvestShield; Future Detector engine as recommended base; corrected Ecuador timeline.
