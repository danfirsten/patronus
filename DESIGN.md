# Patronus — "Months to Darkness"

NASA Space Apps 2026 · Challenge: **Be An Earth System Trend Detective!** (Advanced)
Status: **v4, built; results in section 12** (Nov 14, 2026). Submissions close **Sun Nov 15, 11:59 PM local time**.
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
- **ENSO fingerprint:** for each grid, how its hydro output and basin water historically respond to El Niño and La Niña, with permutation-test significance. Both phases matter. More than a third of the world's hydro dams show reliable ENSO anomalies (Ng, Turner & Galelli 2017, ERL 12:034010; 1,593 dams). Large reservoirs dampen the effect, so use generation and storage, not only rain.
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
- **Projections:** extreme El Niños roughly double, from about once every 20 years to about once a decade (Cai et al. 2014), and keep rising after warming stabilizes (Wang et al. 2017, Nature Climate Change).
- **Corrections (Nov 14):** Brazil 2021 had no rationing, and its "50%" was the tariff surcharge, not bills. Ecuador's late-2024 drought was ENSO-neutral. Zambia's "21 h/day" is news-only. See section 11.7 for the checked versions.

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

## 11. Build decisions (settled Nov 14)
Team: 3 people. Build from scratch, borrowing Future Detector's habits (held-out testing, bootstrap confidence intervals, look-alike cases, hashed ledger, a Proof page with a "what it can't do" list). Static demo: precomputed JSON plus a front end. English only. No personal API keys, no Jev, no GPU.

### 11.1 What we predict, and why that's the useful thing
A decision-maker needs three answers: **will there be a shortfall big enough to act on, when, and how big?** So every forecast gives:
1. **P(shortfall)** for each month ahead;
2. **the size of the deficit** as quantiles (P10, P50, P90), which feeds the cost model;
3. **the cost of waiting** (section 11.6).

Two kinds of target:

| Target | Used for | Definition |
|---|---|---|
| **Reservoir storage** (satellite lake level, G-REALM) | Kariba and other major hydro reservoirs | Level converted to % usable storage. Kariba operates between 475.50 m and 488.50 m (ZRA). **Warning** = usable storage < 20%. **Danger** = < 10%: the allocation can't be met and generation is curtailed. In Dec 2024 it fell to 2.89%. |
| **Hydro generation** (Ember monthly) | 23 hydro-dependent countries + Sichuan province | Monthly hydro capacity factor (generation ÷ installed capacity) compared with that calendar month's normal, using only past data. Capacity factor rather than raw generation, so new dams don't look like wet years. **Shortfall** = 15% or more below normal. **Severe** = 30% or more below normal. |

The reservoir target is the backbone, for two reasons:
- **NASA measures it.** G-REALM is NASA/USDA satellite altimetry.
- **It's long.** Kariba has 1992–2026 data roughly every 10 days, about 34 years and roughly 10 El Niño events. Ember monthly data mostly starts in 2019.

The 15% and 30% thresholds are starting points. Check them against the crises during the build: Vietnam May 2023 and Ecuador Oct 2023 / Sep 2024 must register as shortfalls.

### 11.2 Unit of analysis
- **Decisions and labels:** a country's grid (Ember) or a reservoir (Kariba is shared by Zambia and Zimbabwe).
- **Features:** water conditions over the river basins that feed the hydro plants. Take each plant from the WRI Global Power Plant Database, assign it to a HydroBASINS level-4 basin, and capacity-weight the basin values up to the country.
  - GRACE is about 300 km resolution, so use only basins large enough. Flag small ones as low-confidence (e.g. Ecuador's Andean basins).

### 11.3 Backtest
- Issue one forecast each month. Each forecast uses only data that would have been out by then:
  - GRACE (GFZ GravIS): about 3 months behind;
  - NASA POWER monthly: about 2 months behind (the daily series is only 3 days behind);
  - ONI: about 1 month behind;
  - Ember: about 2 months behind.
- **Horizons:** 1–6 months from the model; 7–18 months from the ENSO layer.
- **Generation model:** one model pooled across countries, using standardized anomalies.
  - Skill measured by **blocked leave-one-year-out** cross-validation, with a 12-month gap, because the records are short.
  - Also a strictly forward test for 2024–2026.
- **Kariba model:** strictly forward, rolling from 2003 when GRACE starts. A version without GRACE back to 1993 gives the GRACE ablation.
- **Baselines:**
  - **climatology:** the usual rate of shortfalls for that month;
  - **persistence:** the latest observed anomaly;
  - **ENSO-only:** the ONI by itself.
- **Metrics:**
  - Brier skill score, AUC-PR and reliability (are the probabilities calibrated?);
  - **months of warning before each crisis, at a fixed false-alarm rate** (at most 1 false alarm per country per 5 years);
  - **"Patronus alarm vs. first official warning"** for each crisis.

### 11.4 Which countries
"Hydro-dependent" means hydro is at least 30% of generation and at least 1 TWh in the latest Ember year. That gives **48 countries** (table: `data/reference/forecast/hydro_dependent_countries_ember.csv`), in three confidence tiers:
1. **Monthly forecast:** 23 countries with Ember monthly data, plus Sichuan. Includes Brazil, Vietnam, Ecuador, Colombia, Norway, Peru, Tajikistan, Kyrgyzstan, Georgia, Sri Lanka, Costa Rica, Canada, New Zealand and others.
2. **Reservoir forecast:** major hydro reservoirs with G-REALM levels. Kariba (Zambia/Zimbabwe) for certain. Check Cahora Bassa (Mozambique), Volta/Akosombo (Ghana), Guri (Venezuela) and others first thing.
3. **Trend + ENSO exposure only:** the remaining countries with yearly data only, e.g. Ethiopia, Laos, Nepal, DR Congo, Uganda, Paraguay.

### 11.5 Data stack (all verified, none needs a login)
- **Ember** monthly, yearly and China-province CSVs (`files.ember-energy.org/public-downloads/...`).
- **GFZ GravIS GRACE/GRACE-FO** water storage grid, 2002-04 to 2026-08.
- **NASA POWER (MERRA-2):** precipitation, root-zone and surface soil wetness, temperature. Monthly from 1981, daily to 3 days ago. These are **NASA model** variables, which the challenge explicitly allows. They stand in for GPM and SMAP, which need an Earthdata login.
- **G-REALM** satellite lake levels (NASA/USDA; TOPEX, Jason, Sentinel-6).
- **NASA GEOS-S2S** seasonal forecasts (NCCS datashare) and the GEOS Niño-3.4 forecast.
- **NOAA ONI.**
- **WRI Global Power Plant Database** (v1.3, 2021; newer plants such as Coca Codo Sinclair are missing).
- **HydroBASINS.**
- **NASA GIBS** Black Marble images (display images only).
- **Brazil ONS** reservoir data.
- **Optional upgrade** with a free NASA Earthdata account: GPM IMERG, SMAP L4, quantitative Black Marble, SWOT. Not required.
- **Note:** the CSR mascons and some other sites fail TLS in our cloud container but work on a laptop.

### 11.6 Cost model
- **Shortfall cost** = replaced energy × replacement cost + unserved energy × value of lost load (VoLL).
- **Replacement cost:**
  - Zambia: from ZESCO's July 2024 filing to the Energy Regulation Board. Eskom imports 17¢/kWh, Mozambique/Karpowership 22¢, inland diesel 26¢, blended 23.2¢. That came to $51M/month for 300 MW.
  - Other countries: 20¢/kWh by default, shown as an editable assumption.
  - Ecuador's power barges cost 8.5–10¢/kWh **before fuel**, so the all-in cost is higher.
- **VoLL:**
  - Central $1.00/kWh, range $0.50–1.50/kWh, from the peer-reviewed literature for developing countries.
  - Cross-check: Vietnam 2023 implies $1.56/kWh ($1.4B over 900 GWh unserved). Ecuador's chamber of commerce estimated $12M per hour of national blackout.
- **Cost of waiting (Kariba):** a simple water balance (inflow scenarios − releases − evaporation).
  - Inflow scenarios come from historical years in the same ENSO phase.
  - Compare starting conservation and import contracts in month m with waiting until the danger threshold is reached.
  - Waiting means paying emergency prices (26¢ diesel instead of 17¢ contracted imports) and leaving more energy unserved.
  - Output: expected cost against the month action starts.
- **Calibration check:** compare model costs with Ecuador (~1–1.5% of GDP), Vietnam ($1.4B) and Zambia (the IMF's growth forecast for 2024 cut from 4.7% to 1.2%). Show ranges, never single numbers.

### 11.7 Crisis scoreboard events
Onset is the first official cut, rationing or emergency-tariff action. Warning is the first documented official warning.

| Crisis | First official warning | Onset | ENSO phase | Notes |
|---|---|---|---|---|
| Brazil 2021 | 27–28 May 2021: national weather system's water-emergency alert | 28 May 2021: red-2 tariff flag. "Water scarcity" flag from 1 Sep 2021. **No rationing.** | **La Niña** (confirmed) | Southeast storage bottomed at 16.5% on 6 Oct 2021. The flag surcharge was +49.6%; **average bills rose about 6.8%** (not "50%+") |
| Sichuan 2022 | No dated official warning found | Cuts announced 14 Aug; industrial power cut 15–25 Aug 2022 | La Niña year; attributed to a record heatwave and drought | Hydro about 82% of supply; hydro output more than halved; Toyota and CATL plants shut. No official cost estimate |
| N. Vietnam 2023 | 10 May 2023: EVN told the ministry of a "high risk of serious shortage" | Late May 2023: rolling cuts | El Niño developing | 5.4 GW peak deficit; about 900 GWh unserved; $1.4B (World Bank, preliminary) |
| Ecuador 2023–24 | 24 Oct 2023: CENACE letter; Dec 2023: 2024–25 warning | 27 Oct 2023 (wave 1); ~14 Apr 2024 (wave 2); ~22 Sep 2024 (wave 3); 14 h/day from 24 Oct 2024 | Wave 1: El Niño. **Wave 3: ENSO-neutral, so not an El Niño event** | 1–1.5% of GDP (finance minister) |
| Kariba 2024 | 28 Dec 2023: ZRA cut the 2024 allocation to 16 BCM | 11 Mar 2024: Zambia 8 h/day load-shedding; 12 h from 20 May; Kariba North stopped ~14 Sep 2024 | El Niño 2023/24 | Lake at 475.91 m (2.89% usable) on 11 Dec 2024. "Up to 21 h/day" is news-only. IMF cut 2024 growth 4.7% → 1.2% |

Expected result: the ENSO layer should catch Brazil 2021, Vietnam 2023, Ecuador wave 1 and Kariba 2024. Sichuan 2022 and Ecuador's late-2024 wave need the 0–6 month water layer. Report it exactly as it turns out.

### 11.8 Live forecast (must be logged before submission)
- **Kariba:** for each month Dec 2026–Dec 2027, P(usable storage < 20%) and P(< 10%), with quantiles. Compare with ZRA's own projection of 9% live storage at the end of 2027.
- **Watchlist:** P(shortfall) for the next 6 months for every tier-1 country.
- **Proof:** hash each forecast file (SHA-256), commit it to the public repo, and stamp it with OpenTimestamps (no key needed). If that fails, the git commit time is the fallback proof.

### 11.9 Technology: in, stretch, out
- **In:**
  - LightGBM (probabilities + quantiles), calibrated with isotonic regression or conformal prediction;
  - look-alike past states (nearest neighbors, no GPU);
  - Mann-Kendall + Sen + FDR trend tests on the GravIS grid;
  - ENSO fingerprints using composites and permutation tests, built from 1981+ POWER rainfall, 1992+ G-REALM levels and Ember generation;
  - Kariba water balance and cost-of-waiting curve;
  - hashed ledger and Proof page;
  - night-lights replay from GIBS images;
  - AI-written briefs generated ahead of time, labelled as AI-written and checked against the data.
- **Stretch:**
  - more G-REALM reservoirs;
  - GEOS-S2S rainfall forecasts as a live feature (shown only, not backtested, unless hindcasts turn up);
  - an MCP server over the JSON files;
  - a 3D Kariba drawdown.
- **Out:** Jev (no access; mention as future work), JEPA (no GPU), reservoir segmentation and SWOT (Earthdata; heavy).

### 11.10 Submission and presentation
The official site returned errors during research, so these rules are **unconfirmed. Check them on the live pages.**
- **Demo:** a video of **30 seconds or less**, or **up to 7 slides**, hosted publicly. The demo can't be uploaded to the Space Apps site, and every link must open without a login.
- **Language:** English.
- **Window:** submit from the team page's Project tab between Sat 9 AM and **Sun Nov 15, 11:59 PM local time**.
- **Data:** list every NASA and non-NASA dataset with links. Share the code.
- **AI use:**
  - **Disclose it.** AI-generated images and video need a visible watermark.
  - No NASA logos or branding.
  - A search snippet says AI tools **"should not be used to come up with your idea for how to solve the challenge."** Check this wording on the live guide, and describe our AI use accurately: the team's original concept, with AI used for research, critique and coding.
- **Team:** at most 6 people.
- **Judging:** scored 1–5 on Impact, Creativity, Validity, Relevance and Presentation.
  - Local events nominate projects to global judging. Global nominees are announced Dec 3.
  - Global judging appears to use the project page plus the demo, not a live pitch.
- **Live pitch:** the format is set by the local event lead, so ask the organizers.
- **Award categories to aim for:** Best Use of Data, Best Use of Science, Global Impact (Galactic Impact), Best Storytelling.

**Rule corrections (audit session, read through a proxy; recheck on the live pages):**
- The guide calls AI tools "Super Intelligence (SI)".
- The 7-slide limit includes the title slide. Going over the limit makes the project ineligible for global judging.
- SI-generated images and video need a visible watermark. SI-generated code and data need an acknowledgement in the text and the metadata.
- Data from partner agencies is "highly encouraged". GRACE-FO (with GFZ) and G-REALM (Sentinel-6) qualify; name the partners.
- Deadline: click "Submit for Judging" by 11:59 PM local time on Sun 15 Nov.

## Changelog
- v0 — Captured the initial brief.
- v1 — Global story with Kariba as the close-up; trend layer; scoreboard and watchlist; cost layer; validation rules; technology options including Jev.
- v3 — Build decisions (section 11): targets and thresholds, unit of analysis, backtest, 48 countries in 3 tiers, verified no-login data stack, cost model with sourced inputs, crisis scoreboard dates, live forecast and ledger, tech in/stretch/out, submission rules (unconfirmed). Reference data in `data/reference/` (`forecast/` and `remediation/`).
- v2 — Problem statement with verified costs; audience changed to finance ministries, regulators and lenders; watchdog positioning after the landscape check; three time horizons with ENSO fingerprints (no in-house ENSO forecaster); shared-exposure feature from HarvestShield; Future Detector engine as recommended base; corrected Ecuador timeline.

## 12. Results (Nov 14 build) and what they mean for the pitch
All numbers come from `web/public/data/*.json` and were produced by `pipeline/`. Rerun the whole pipeline with `python3 -m pipeline.run_all`.

**Global trend map (GRACE/GRACE-FO 2002-04..2026-08; GPCP rain trend 2002-2019 because GPCP drifts after 2019)**
- 392 GW of hydropower (37% of 1,053 GW mapped) sits in 221 basins with significantly declining water storage; 343 GW in 108 wetting basins.
- **Lead with the split:** only **19 GW** of the drying total also saw significantly less rain (2002-2019). The other **373 GW** lost water storage without a rain decline, which points to groundwater pumping, glacier/snow loss or reservoir operations. The story is "the water stored in hydro basins is draining, mostly not because of less rain".
- **GPCP drift (confirmed):** the median basin GPCP/MERRA-2 ratio steps down to about 0.95 after 2020 (Africa 0.90, Kariba basin 0.65). Independent check: G-REALM shows Kariba rising about 6 m in 2020-21 while GPCP reads those years as dry.
- **Kariba basin:** no significant long-term rain trend. The storage loss is mostly reservoir drawdown; the risk is year-to-year El Nino swings.

**ENSO fingerprints (GPCP 1981–2025, permutation tests)**
- **Robust headline: 54 GW of hydropower sits in 9 grids that lose under El Niño in both the full record and a 1981-2019 check that excludes the suspect GPCP years:** Zambia, Zimbabwe, Vietnam, Laos, Nepal, Bhutan, Peru, Honduras, Myanmar. Full record: 58 GW in 12 grids (adds Mozambique, Malawi, Guatemala, which are not robust). Chance alone would give about 2.4 grids.
- 7 GW sits in 2 La Niña losers (Tajikistan, Guinea). That is not above chance.
- The known regional patterns come out as expected: Zambezi dry, southern Brazil wet and Southeast Asia dry under El Niño. Colombia has the right sign but is not significant.
- **Kariba:** the lake rises 2.1 m less from October to June in El Niño years (p = 0.01, 11 years).

**Kariba (the showpiece)**
- **"Now" ML model:** beats climatology, persistence and ENSO-only at 1–12 months, with Brier skill 0.84 at 1 month, 0.46 at 6 months and 0.03 at 12 months. It **missed 2024**: its first alarm came in Mar 2024, because it expected the usual rainy-season recovery.
- **"Next" El Niño water-balance ensemble:** first alarm **Jul 2023**, 5 months before ZRA's cut and 8 months before load-shedding. It gave P(below 20%) = 0.8 in Oct–Dec 2023. Its record across El Niño seasons since 1995 is 3 hits, 2 misses and 2 false alarms.
- **Live forecast** (blend): Dec 2027 median 31% usable, **P(below 10%) = 0.36, P(below 20%) = 0.45**. ZRA's 9% is a plausible dry-side outcome.
- **Cost of waiting:** illustrative only. Its sign is usually "act early", but its size ranges from $8M to $144M depending on the assumed release rate.

**Country monthly model (23 grids + Sichuan, Ember 2015/2019–2026)**
- **Weak.** Brier skill is 0.03–0.07, small but positive against all baselines. AUC-PR beats climatology only at 1 month. No single NASA input adds significant ranking skill, and GRACE slightly hurts at the country-month level.
- It caught 1 of 6 crises (Vietnam 2023, 6 months ahead) and missed Brazil 2021, Sichuan 2022 and all three Ecuador waves.
- **Label:** "experimental" in the app. A seasonal-target robustness test (specified after the primary analysis) is in `generation_backtest.json` → `seasonal_target`.

**Night lights:** Zambia's cities dimmed 23% (Jun 2024) and 36% (Sep–Oct 2024) against Feb 2023; Lusaka dimmed 52%. Ecuador shows no detectable dip because city cores saturate the scale and the satellite passes over at about 01:30.

**Data-quality findings worth mentioning to judges**
- NASA POWER (MERRA-2) rainfall has artificial breaks: Colombia in 2008 and 2021, Vietnam from 2016–17. We switched to GPCP for rainfall.
- POWER soil wetness shows a step change on 1 Oct 2026.
- GPCP looks suspicious over the Zambezi after 2020, so the Kariba model keeps POWER with trailing anomalies.
- Finding and documenting these is part of the Validity story.

**What this means for the pitch**
1. **Lead with Kariba and El Niño, not the monthly country model.** The honest claim is: "Reservoir storage plus the El Niño signal gave a 5-month head start on Kariba 2024, and today it says there is about a 1-in-3 chance Kariba falls into the danger zone by end-2027."
2. **The global layers** give the reach: 54 GW in robust El Niño-loser grids, and 392 GW in basins with drying water storage (19 GW with less rain, 373 GW without).
3. **Show the misses.** Short-range monthly country forecasts have little skill. The scoreboard shows that, and judges reward it under Validity.
4. **Scoreboard summary:** 2 of 5 crises caught with lead time (Kariba by the "next" model, Vietnam by the country model). Brazil, Sichuan and Ecuador were missed.

**Tested and rejected, kept to show rigour (Nov 14, evening)**
- **Brazil ONS reservoir storage (EAR/ENA)** was suggested by Sean's Future Detector back-test. Under our pre-set rule (blocked leave-one-year-out, publication lag) it made Brazil's own AUC-PR slightly worse at 5 of 6 horizons, so it was not adopted. Brazil has only 3 shortfall months under our label.
- **Heatwave features** (NASA POWER daily Tmax, heatwave days, cooling degree days), from Sean's `fd/heatwave` back-test, add no pooled skill: ×1.006 at 1 month, ×0.98–0.99 at 3–6. They do not catch Sichuan 2022 either, because the heat and the generation drop fall in the same 4–6 weeks. Not adopted. A flash heat-drought needs sub-monthly data and heat *forecasts*.
- **GPCP rainfall** drifts dry after 2019. It was detected independently by three agents, with Kariba's satellite lake level as the tie-breaker. Rain trends use 2002–2019, and the ENSO results are checked on 1981–2019.
- **For the pitch:** "we tested ideas that sounded good and dropped the ones that failed a pre-set test" is a Validity strength.

## 13. Pitch guidance from a mentor (Nov 14, Seattle) and what we do with it
**What the mentor said:** Impact, Creativity, Validity and Relevance look strong, and the data pipeline is the easy part. The score is decided by **presentation**. The judges are industry people who will think about viability. The mentor's specific advice:
1. **Pick one country and one metric**, and tell that story well. Don't tour the world.
2. **Name the customer.** Is it a country, a municipality or a person? Use one customer, as a hypothesis.
3. **Show how someone feels after using it.** The value is that people can plan for outages, and that hospitals and people who need care stay powered.
4. **Name the NASA data out loud**, and say how it answers the challenge: what is changing, where, by how much, and whether it is significant.
5. **Timing:** 7 slides maximum. Rehearse to time, and finish the deck. The mentor offered a practice run (Sat afternoon / Sun early morning).

**Our response**
- **The one story is Zambia and Lake Kariba.** Ecuador ($ cost) and Vietnam ($1.4B) get one line, as proof that this keeps happening.
- **Customer (hypothesis):** the people who decide how much water to release from Kariba and how to plan power for 2027. That means Zambia's and Zimbabwe's energy ministries and utilities (ZESCO, ZPC) and the Zambezi River Authority. Beneficiaries: hospitals, factories and households that lost up to 21 hours of power a day in 2024 (news reports).
- **The feeling:** *"I know how much time I have, and what acting now buys me."* The product turns dread into a decision window. The Kariba page and the pitch should say it in one line, from the simulator: **a 30% release cut from Jan 2027 lowers the chance of the danger zone from 4 in 11 to 2 in 11 El Niño years, at a cost of about 1.4 TWh of hydropower (net, kariba_sim.json; 1.5 TWh is held back by choice).**
- **The NASA data to name:** GRACE/GRACE-FO (water stored in the basin), G-REALM satellite altimetry (TOPEX/Jason/Sentinel-6, with partner agencies), MERRA-2 and GPCP (rain and soil), GEOS-S2S (seasonal outlook) and Black Marble (night lights).
- **The challenge answer, said explicitly:** "We pick the variable (water storage, lake level) and the region (each hydropower basin), plot it since 2002, and measure the trend (Sen's slope) and its significance (Mann-Kendall with FDR). The Trend Detective page lets anyone do the same."

**7-slide skeleton:**
1. **Title:** "Patronus: months to darkness".
2. **Problem, through one human-scale fact:** Lusaka's lights dimmed by 52% (Black Marble), and Zambia's growth forecast went from 4.7% to 1.2%.
3. **The warning existed:** our model flagged Kariba in Jul 2023, 5 months before the official cut.
4. **How:** NASA data → trend and significance → El Niño reservoir model (name the missions).
5. **Now:** a 36% chance Kariba falls below 10% by end-2027. The decision window, shown with the simulator.
6. **Proof and honesty:** the scoreboard with its misses, the timestamped forecast, and the global reach (54 GW El Niño exposure; the reservoir watch).
7. **Customer and ask:** who uses it, what changes for them, and the live link.

## 14. Global reservoir watch (Nov 14, late): the method generalizes
Source: `web/public/data/reservoirs.json` and `docs/RESERVOIRS.md`.
- **Coverage:** 31 G-REALM satellite-altimetry reservoirs on 4 continents. 77 GW at the dams, plus 22 GW downstream in cascades they control. Examples: Kariba, Cahora Bassa, Volta/Akosombo, Kainji, Guri, Itaipu, Sobradinho, Tarbela, Three Gorges, Toktogul.
- **Method:** the Kariba method, fixed before any crisis was scored. Each lake's level is compared with the same calendar month in earlier years only. Warning is below the 20th percentile and danger below the 10th. El Niño or La Niña analog years are used only where that lake shows significant ENSO sensitivity, re-tested each year on past data only.
- **Skill** (pooled, strictly forward, 2000–2026, about 6,500 forecasts per horizon):

  | Horizon | Brier skill vs climatology | AUC-PR | Climatology AUC-PR |
  |---|---|---|---|
  | 3 months | 0.38 | 0.73 | 0.27 |
  | 6 months | 0.15 | 0.58 | 0.27 |
  | 12 months | −0.02 | | |

  Skill is positive out to 10 months. 25 of 31 lakes beat climatology at 3 months, 17 at 6 months.
- **Crises:** **14 of 17 documented hydro crises flagged before onset.** Brazil 2001 (x2), Ghana 2006, Venezuela 2009-10, Nigeria 2012, Brazil 2014, Brazil 2015, Malawi 2015, Ghana 2016, Venezuela 2016, Brazil 2021, Itaipu 2021, Pakistan 2022, Kariba 2024. Missed: Kariba 2015, Kariba 2019 (P = 0.50, just short of the alarm threshold), Tarbela 2025.
  - **8 of the 14** alarms came while the lake was still above its warning level, meaning a genuine forecast.
  - **6 of the 14** fired when the lake was already low.
  - A plain "lake is already low" rule catches 12 of 17. Our forecast adds Ghana 2006 and Venezuela 2009 and warns earlier in six more.
  - Leads are capped at 12 months by the scoring window. Over all seasons there are 219 hit episodes, 26 missed and 64 false-alarm runs.
- **Honest wording:** "Applied unchanged to 31 reservoirs, the method flagged 14 of 17 past hydro crises on 4 continents before they began. In 8 of them the alarm came before the lake had dropped below its warning level." Do not present the reservoir-watch Kariba 2024 catch as the same result as the Jul 2023 El Niño alarm: by percentile, Kariba was already low from 2022.
- **Live (issued 2026-11-15):** already below warning are Cahora Bassa (12th percentile), Kainji, La Vueltosa and Srisailam. Next most at risk: Toktogul (0.69), Three Gorges (0.67, only 3 analogs), São Simão (0.57) and Xiaowan (0.50). Kariba is 0.45 under El Niño analogs.
