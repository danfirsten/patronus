# Patronus: core questions and answers

The single story: **Zambia and Lake Kariba.** Every number comes from `DESIGN.md` §8, §12, §13 or §14, or from `web/public/data/*.json`. The ⚠ marks show where our answer is still weak.

## WHO
- **Primary customer (hypothesis):** Zambia's power planners: the Ministry of Energy and the national utility ZESCO. They decide when to contract imports, when to start load-shedding, and how much to ask the Zambezi River Authority (ZRA) to release. They already pay for being late. In 2024 ZESCO's replacement power cost 17–26 US cents/kWh, about $51M a month for 300 MW (ZESCO filing to the regulator, Jul 2024).
- **Other users:** the Zambezi River Authority (sets the yearly water allocation), Zimbabwe's utility ZPC, and development lenders (World Bank, AfDB) who fund adaptation.
- **Who benefits:** the people who lose power. In 2024 that meant hospitals, water pumping, factories and households. Load-shedding started at 8 hours a day on 11 Mar 2024 and was reported at up to 21 hours a day (news).
- **Who pays (hypothesis):** it stays a free public warning, because a public warning is what makes ignoring it costly. It could be funded as climate adaptation, with paid detailed briefings for utilities. ⚠ We have not tested willingness to pay.
- **Who we are:** a 3-person team (Dan, Sean, Arvin) at NASA Space Apps Seattle, with open data and open code.

## WHAT
- **For a 12-year-old:** "Patronus uses satellites to see when a country's power lakes are running dry, months before the lights go out, and shows what acting early would save."
- **What the user does:** opens the Kariba page and sees the chance the lake falls into the danger zone by the end of 2027 (36%, or 4 of 11 past El Niño years). Then, in the simulator, they test acting now.
- **What the user gets:** a dated, public warning, and a clear trade-off. A 30% release cut from Jan 2027 lowers the danger odds from 4 in 11 to 2 in 11 El Niño years, at a cost of 1.5 TWh of hydropower.
- **What it does not do:** it does not forecast El Niño itself, because NOAA does that. It does not predict exact blackout hours. It does not replace the utility's operating models. The monthly country-level model is experimental.

## WHEN
- **Lead times:** 0–6 months from water already stored (strong skill). 6–18 months from El Niño plus reservoir history (the Kariba alarm in Jul 2023). Decades from the trend map.
- **When in their year:** ZRA sets the next year's allocation in Oct–Dec, and the rainy season decides the lake from Nov to Apr. Patronus is most useful in Jul–Dec, before those decisions are locked in.
- **Why now:** NOAA expects a strong to very strong El Niño through Jan–Mar 2027 (>79% chance). ZRA has already cut the 2027 allocation by 36%, and projects the lake at 9% at the end of 2027.

## WHERE
- **First:** Lake Kariba (Zambia/Zimbabwe). Zambia got about 86% of its electricity from hydro in 2024.
- **Already built out:** 31 reservoirs on 4 continents, covering 77 GW at the dams plus 22 GW downstream. The trend map covers 466 hydropower basins, and the El Niño exposure map covers 48 hydro-dependent countries.
- **NASA data:** GRACE/GRACE-FO (water stored in each basin, with GFZ); G-REALM satellite lake levels (TOPEX, Jason and Sentinel-6, with partner agencies); MERRA-2 and GPCP (rain and soil); GEOS-S2S (seasonal outlook); Black Marble (night lights).
- **Where judges see it:** https://patronus-blackout-watch.aui-svi.workers.dev

## WHY
- **Stakes:**
  - Zambia's 2024 growth forecast was cut from 4.7% to 1.2% (IMF, citing power shortfalls).
  - Lusaka's night lights dimmed by about 52% at the 2024 peak (Black Marble).
  - Ecuador lost 1–1.5% of GDP in 2024 (finance minister).
  - Vietnam lost about $1.4B in 2023 (World Bank).
- **Why existing warnings failed:** the warnings were technical, internal and easy to ignore. Ecuador's grid operator warned in Oct–Dec 2023, and the cuts still reached 14 hours a day by Oct 2024. Patronus makes the warning public, dated, and priced in options.
- **What's different:** existing tools are either paid short-range inflow forecasts for operators (0–10 days) or drought maps that stop at "it's dry". We found nothing public that turns satellite water data into country-level shortfall odds plus a decision simulator plus a published track record.
- **Why NASA should care:** satellite altimetry is the backbone. ZRA publishes no downloadable lake history, and G-REALM gives us 34 years of it. It shows NASA water missions guiding real energy decisions.

## HOW
1. **Measure:** satellites track the water in each lake and basin (lake level since 1992, basin water storage since 2002).
2. **Compare:** we check today's level against the same month in every past year, and against how the lake behaved in past El Niño years.
3. **Warn and test:** we publish the odds of falling into the danger zone and let planners test release cuts. Every forecast is hashed and timestamped.

- **How we know it works:**
  - In a strictly forward test, Kariba 2024 was flagged in Jul 2023: 5 months before the official cut and 8 months before load-shedding.
  - Applied unchanged to 31 reservoirs, the method flagged 14 of 17 past crises before they began. 8 of those came before the lake had dropped below its warning level.
  - Misses: Kariba 2015, Kariba 2019 and Tarbela 2025.
- **How it answers the challenge:** pick a variable (water storage or lake level) and a region (any hydropower basin), plot it since 2002, then measure the trend (Sen's slope) and its significance (Mann-Kendall with FDR). The Trend Detective page lets anyone do this, with 107 regions and 9 variables.
- **After the hackathon:** pilot with ZESCO and ZRA before the 2027 rainy season. Then add SWOT (high-resolution lake heights) and the operators' own gauges. Expand the reservoir watch.

## FEEL
- **Before:** "Every year we find out the lake is too low when it's already too low. Then we buy emergency diesel and cut power to hospitals and homes."
- **After:** "I know how much time I have, and what acting now buys me. If we cut releases 30% from January, the chance of a blackout-level lake drops from 4 in 11 to 2 in 11."

## Hard judge questions
- **"Isn't this just El Niño forecasting?"** No. NOAA forecasts El Niño. We translate it into *this lake's* odds, using 34 years of satellite levels, and our model learned that Kariba rises about 2 m less in El Niño years.
- **"Your country model is weak. Why trust any of it?"** We show it as experimental, on purpose. The part we claim, reservoir storage plus El Niño, beats both baselines in a strictly forward test and caught 14 of 17 crises.
- **"14 of 17, but 6 were already low?"** Correct, and we say so. 8 were genuine early warnings. A "lake already low" rule alone gets 12, so our model adds two catches and earlier warning on six more.
- **"Why would a ministry trust a hackathon tool?"** Every forecast is timestamped publicly, so its track record builds in the open. It uses public NASA data and open code. The 2027 forecast can be checked against reality.
- **"Is it scalable?"** Yes, we've already scaled it: one method, unchanged, applied to 31 reservoirs on 4 continents, with no API keys and no logins.
- **"What would you do with 6 more months?"** Pilot with ZESCO and ZRA, add SWOT and gauge data, and extend to sub-monthly detection of flash droughts (we missed Sichuan 2022).

## Pitch-ready lines (say these aloud)
1. "In 2024 El Niño drained Lake Kariba, and Zambia's lights went out for up to 21 hours a day."
2. "NASA's satellites saw it coming. Our model flagged it in July 2023, five months before officials cut the water."
3. "El Niño is back. Today there's a 1-in-3 chance Kariba falls into the danger zone by the end of 2027."
4. "Patronus shows what acting now buys: a 30% release cut from January halves those odds."
5. "We tested it on 31 reservoirs on 4 continents. It flagged 14 of 17 past crises, and we show the misses."

## Weak spots to fix before the pitch
- ⚠ **Willingness to pay** is untested. Present it as a public good, with funding as a hypothesis.
- ⚠ **No sourced Zambian hospital or water-pumping fact yet.** The "21 hours" figure is from news reports. Find one sourced human-impact fact for Zambia, or say "reported".
- ⚠ **"Halves the odds"** is 4→2 of 11 analog years: small numbers. Say "4 in 11 to 2 in 11", not a percentage.
- ⚠ **No contact with ZESCO or ZRA.** Say "pilot target", not "partner".

## 7-slide map
1. Title and one-liner (WHAT).
2. Kariba 2024: 21 h/day cuts, Lusaka lights −52%, growth forecast 4.7→1.2% (WHY, FEEL-before).
3. The warning existed: Jul 2023 alarm, 5 months early (HOW we know).
4. How: NASA data → trend and significance → El Niño reservoir model (HOW, WHERE-data, the challenge answer).
5. Now: 1 in 3 by end-2027, with the simulator (WHEN-now, FEEL-after).
6. Proof and reach: 14 of 17 crises on 4 continents, misses shown, timestamped (validity, scale).
7. Customer and next step: ZESCO, the Ministry and ZRA; pilot before the 2027 rains; live link (WHO, after the hackathon).
