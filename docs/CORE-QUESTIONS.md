# Patronus: core questions

> **Update (Nov 15, from Dan):** no single named customer and no sales ask. Patronus is pitched as a free, open hackathon tool that *could be used by* utilities, river authorities and energy ministries in hydro-dependent countries. ZESCO is fine as one concrete example. The pitch wording in `docs/PITCH-PREP.md` overrides the customer and "ask" wording below.

This is the one story for the whole team: rehearse from it. Every number has its source in brackets. Nov 14, 2026. Built by the core-questions sub-thread and checked by MAIN.

**The story in one breath:** In 2024 Lake Kariba ran almost dry and Zambia's lights went out. NASA satellites saw it coming. Patronus turns that NASA water data into a warning that tells a power utility how much time it has and what acting now buys it. A very strong El Niño is under way right now, and the 2027 warning is live.

---

## Pitch-ready: the 5 answers that matter most
Say these out loud, word for word, until they fit the time.

**1. Why it matters (the hook).**
> "In 2024, Lake Kariba, the world's largest man-made reservoir, fell to 2.89% usable water. Zambia gets about 86% of its power from hydro. People went 8, then 12 hours a day without power. From space, Lusaka's lights dimmed by half. The IMF cut Zambia's growth forecast from 4.7% to 1.2%. And this keeps happening: Ecuador lost 1 to 1.5% of its GDP the same year, and Vietnam lost about $1.4 billion in 2023."

[crises.json: ZRA via Pindula, Lusaka Times, IMF Nov 2024; nightlights.json; DESIGN §8]

**2. Who it's for, and how they feel.**
> "Our customer is the power planner at ZESCO, Zambia's power utility. Today they find out the lake is in trouble when it's already low. Then they buy emergency diesel at 26 cents a kilowatt-hour instead of imports contracted ahead at 17. With Patronus they know months ahead how much time they have, and what acting now buys them. Hospitals, factories and families get a planned schedule instead of a surprise."

[ZESCO's Jul 2024 filing to the Energy Regulation Board, DESIGN §11.6]

**3. What it does, in three steps.**
> "One: we read NASA satellite data. That's how much water the basin holds (GRACE-FO), how high the lake is (radar altimetry), and how much rain fell (MERRA-2). Two: we test which trends are real, with standard statistics. Three: we play past El Niño years forward from today's lake level. That shows the chance the lake hits the danger zone, and what a release cut now would change."

**4. How we know it works.**
> "We ran it the hard way, using only data that existed at the time. For Kariba, our El Niño model raised the alarm in July 2023: five months before the official cut, and eight months before load-shedding. Then we applied the same method, unchanged, to 31 reservoirs on 4 continents. It flagged 14 of 17 past power crises before they began. In 6 of those the lake was already low, so we count 8 as true early warnings. We also show our misses, including Kariba in 2015 and 2019."

[DESIGN §12, §14; docs/RESERVOIRS.md]

**5. Why now, and the challenge answer.**
> "A very strong El Niño is under way today, and the river authority has already cut Kariba's 2027 water allocation by more than a third. Our forecast says that in 4 of the 11 past El Niño years we replay, the lake ends 2027 in the danger zone. A 30% release cut from January brings that to 2 in 11, at a cost of about 1.4 terawatt-hours of power. And for the challenge: pick any NASA variable and any of 107 regions, and our Trend Detective page plots it. It gives the trend (Sen's slope) and whether it's significant (Mann-Kendall)."

[DESIGN §8, §13; kariba_sim.json `examples`: mean generation 5.51 → 4.16 TWh; explorer/index.json]

---

## WHO
**Who is the customer?** ZESCO, Zambia's state power utility, and specifically its system planners.
- They carry the cost of acting late. Emergency power costs 26¢/kWh, against 17¢ for imports contracted in advance. 300 MW of replacement power cost about $51M a month. [ZESCO filing to ERB, Jul 2024]
- They write the load-shedding schedule that hospitals and households live with.
- **Decision partner:** the Zambezi River Authority (ZRA), which sets how much water each country may release. The simulator speaks to that decision.
- **Second customer:** Zimbabwe's utility ZPC, which shares the lake.

**Who are the users?**
- ZESCO planners and energy-ministry analysts use the Kariba page and the simulator.
- Students and the science-literate public use the Trend Detective page. They are the challenge's suggested audience.
- Journalists can check a dated, public forecast.

**Who benefits?** Hospitals, clinics, factories and households in Zambia and Zimbabwe. In 2024 Zambia had 8 h/day of load-shedding from 11 Mar and 12 h/day from 20 May. [Lusaka Times; crises.json] News reported up to 21 h/day; say "reported".

**Who pays, or would? (hypothesis)**
- The public warning stays free.
- A utility, or a development lender funding its energy resilience, would pay for a tailored version run on their own operating data.
- Why that's plausible: one month of 300 MW emergency power costs about $51M.
- **We have not talked to any customer yet.** Say so plainly if asked.

**Who are we?** A team of 3 at the Seattle event (Dan, Sean, Arvin; add a role each).
- In a weekend we built and tested the whole pipeline.
- We found real faults in the data: rainfall breaks and drift.
- We publish our misses.

## WHAT
**For a 12-year-old:** "It watches lakes behind dams from space, and warns a country months ahead when the lake might get too low to make electricity."

**What the user does, and gets:**
- On the Kariba page they see:
  - today's level (31% usable on 9 Nov 2026, by satellite);
  - the chance of the danger zone by end-2027;
  - past alarms, with the misses.
- In the simulator they cut releases and watch the danger shrink, against the power that costs.
- On Trend Detective anyone picks a variable and a region, and gets the trend and its significance.

**What it does not do:**
- It does not forecast El Niño. It uses NOAA's and NASA GEOS's forecasts.
- It is not an operating plan. The simulator is illustrative.
- It does not predict blackout hours or exact dollars. The cost of waiting ranges from $8M to $144M depending on assumptions.
- The short-range country forecasts are experimental.
- It can't see reservoirs that the altimeters don't track: Ecuador's Mazar/Paute and Vietnam's Hoa Binh and Son La.

## WHEN
| Lead time | What we use | Skill | What the customer can do |
|---|---|---|---|
| 0–6 months | Lake level now + past seasons | Beats climatology: Brier skill 0.38 at 3 months, 0.15 at 6 (31 lakes); Kariba model 0.84 at 1 month, 0.46 at 6 | Ration, protect hospitals in the load-shedding schedule, buy imports |
| 6–18 months | El Niño outlook × the lake's El Niño fingerprint | Kariba alarm Jul 2023, 5 months before the cut. Record since 1995: 3 hits, 2 misses, 2 false alarms | Cut releases early, contract imports at 17¢ not 26¢ |
| Decades | GRACE/GRACE-FO storage trend since 2002 | 392 GW of hydro in basins with significantly declining storage | Diversify, interconnect, change reservoir rules |

**When in their year:**
- Before the yearly allocation. ZRA set the 2024 allocation on 28 Dec 2023; our alarm came in July.
- Then monthly through the Nov–Apr rains.
- Don't say "every December": we have two ZRA dates, not a published calendar.

**Why now:**
- **El Niño:** ONI is +2.46. NOAA expects a strong to very strong El Niño through Jan–Mar 2027 (>79% chance). SARCOF expects below-normal Jan–Mar 2027 rain over Zambia and Zimbabwe.
- **The 2027 allocation:** ZRA has cut it by 36% (36 → 23 BCM), and projects 9% usable storage at end-2027.
- **Our forecast**, timestamped: a median of 31% in Dec 2027, P(below 10%) = 0.36 (4 of 11), and P(below 20%) = 0.45.

## WHERE
**Where it applies:**
- Kariba first.
- 31 reservoirs on 4 continents (77 GW at the dams, plus 22 GW downstream).
- The global layers cover 48 hydro-dependent countries.

**NASA data:**
- **GRACE/GRACE-FO** (with GFZ/DLR): basin water storage, 2002–2026.
- **G-REALM** (NASA/USDA altimetry from TOPEX, Jason-1/2/3 and Sentinel-6): lake levels, Kariba from 1992.
- **MERRA-2** (via NASA POWER): rain, soil and temperature.
- **GPCP** (NASA GSFC/GEWEX): rain for the El Niño fingerprints.
- **GEOS-S2S:** the Niño-3.4 outlook.
- **Black Marble** (via NASA GIBS): night lights.
- Not NASA: Ember (generation), NOAA ONI, WRI power plants.

**Where judges see it:** https://patronus-blackout-watch.aui-svi.workers.dev. It is auto-deployed from `main` and listed in README.md.
- ⚠ The Trend Detective page is on `main` but not yet in the navigation. Sean's nav agent holds `App.tsx`. It must be wired before the 3 PM freeze.

## WHY
**Stakes:**
- **Kariba 2024:** the lake fell to 2.89% usable on 11 Dec 2024. Load-shedding ran 8 then 12 h/day. Lusaka's lights dimmed by 52%. The IMF cut growth from 4.7% to 1.2%.
- **Ecuador 2024:** 1–1.5% of GDP lost, with 14 h/day cuts from 24 Oct 2024.
- **Vietnam 2023:** about $1.4B, roughly 0.3% of GDP (World Bank, preliminary).

**Why warnings failed:**
- They came late, or nobody had to act on them.
- Ecuador's grid operator asked for rationing on 24 Oct 2023 and warned in Dec 2023, yet cuts reached 14 h/day by Oct 2024.
- At Kariba, the first official signal came 5 months after our alarm.
- Patronus warns earlier, puts a price on waiting, and timestamps the warning in public.
- **Ecuador is context only.** We can't score it, so never imply we'd have caught it.

**What's different:**
- HydroForecast is paid and mostly 0–10 days ahead.
- Drought monitors don't connect drought to electricity, and operator models aren't public.
- We found nothing public, free and global that does all of this.

**Why NASA should care:**
- It turns GRACE-FO, G-REALM and MERRA-2 into a country-level decision months ahead. ZRA publishes no downloadable lake history; NASA altimetry gives 34 years of it.
- It uses partner-agency data (GFZ, Sentinel-6).
- It documents data faults: MERRA-2 rain breaks, and GPCP drift after 2019 confirmed by Kariba's satellite lake level.

## HOW
**3 steps:**
1. **Read** NASA satellite and model data monthly.
2. **Test** which signals are real: drying trends (Mann-Kendall) and El Niño effects (permutation tests). Kariba rises about 2 m less from Oct to Jun in El Niño years (p ≈ 0.01).
3. **Replay** past El Niño years from today's level, count how often the lake ends in danger, and show what a release cut changes.

**How we know it works:** strictly forward backtests that beat climatology and persistence.
- **Kariba "next" model:** alarm Jul 2023. Record: 3 hits, 2 misses, 2 false alarms.
- **31 reservoirs:** 14 of 17 crises flagged (8 true early warnings, 6 already low). Missed Kariba 2015, Kariba 2019 and Tarbela 2025. Over all seasons: 219 hit episodes, 26 missed, 64 false-alarm runs.
- **Country monthly model:** weak (Brier skill 0.03–0.07), caught 1 of 6 crises. Labelled experimental.
- **Tested and dropped:** Brazil reservoir data and heatwave features.

**How it answers the challenge:**
- **Variable:** 9 to choose from.
- **Region:** 107 (52 basins, 24 countries, 31 reservoirs).
- **Time series:** monthly, seasonal cycle removed.
- **Rate of change:** Sen's slope with a 95% confidence interval.
- **Significance:** Mann-Kendall (Hamed-Rao), with FDR across basins on the map.
- **Result:** 392 GW of hydro sits in significantly drying basins. Only 19 GW of that also had significantly less rain.
- Three guided demos.

**Adoption after the hackathon:**
- A 2027 pilot next to ZRA's projection and ZESCO's planning, published monthly.
- The forecast is already timestamped, so 2027 becomes a public test.
- Then add the customer's own data.
- No partner yet.

## FEEL
| | Before | After |
|---|---|---|
| ZESCO planner | "We'll know how bad it is when the lake is low. By then the cheap options are gone." | "I know how much time I have, and what acting now buys me." |
| River authority | "If we cut releases now, we lose power we may not need to lose." | "A 30% cut from January takes the danger from 4 in 11 El Niño years to 2 in 11. I can see the trade." |
| Hospital or factory | "The power goes off without warning." | "We have a schedule, and we planned around it." |
| Student | "I hear 'climate trend' but can't check it." | "I picked a lake, ran the test, and saw whether the change is significant." |

---

## Hard judge questions
- **Isn't this just El Niño forecasting?**
  No. We take NOAA's and NASA's forecasts. We test which places actually lose water under El Niño: only 9 grids hold up robustly (54 GW), and only 8 of our 31 lakes show a significant effect. Then we turn that into a lake level and a power decision.
- **Your country model is weak. Why trust any of it?**
  We say so, and we label it experimental. The claims rest on the reservoir models, which beat climatology and persistence on data they never saw.
- **14 of 17, but 6 were already low?**
  Right. A "lake already low" rule alone catches 12 of 17. Our model adds Ghana 2006 and Venezuela 2009, and warns earlier on six more. The real claim is 8 of 17 warned before the lake dropped below its warning level.
- **Why would a ministry trust a hackathon tool?**
  It shouldn't, blindly. Every forecast is hashed and timestamped before the outcome, the misses are on the page, and the code and data are open. 2027 is a live test.
- **Is it scalable?**
  Yes, within satellite coverage: 31 reservoirs already, with free data and no logins. NASA's SWOT mission would add many more lakes.
- **What would you do with 6 more months?**
  Add SWOT to reach Ecuador and Vietnam. Pilot with one utility on its real release data. Backtest with archived El Niño forecasts. Work on the Kariba 2015 and 2019 misses.
- **Where does the 36% come from?**
  4 of 11 replayed El Niño years end 2027 below 10%. It's a small sample, so say "about 1 in 3".
- **Is the cost model real?**
  The prices are real (ZESCO filing). The total is illustrative ($8M–$144M), so we lead with time and power, not dollars.
- **Did you use AI?**
  Yes, for research, critique and coding. The concept is the team's, and AI-written briefs are labelled.

---

## Flags: fix before the pitch
1. **One customer:** ZESCO's planners. ZRA is the decision partner and ZPC the second customer.
2. **Who pays** is a hypothesis. We have talked to no customer yet.
3. **Energy cost:** say "about 1.4 TWh" (net, 5.51 → 4.16 TWh), not 1.5. Fixed in DESIGN §13.
4. **Two different 36s:** say "cut by more than a third" for the allocation and "about 1 in 3" for the odds.
5. **Trend Detective** must be in the site navigation before the 3 PM freeze.
6. **Ecuador is a hook, not proof.**
7. **Don't present the reservoir-watch Kariba 2024 catch as the July 2023 El Niño alarm.** They are different results.
8. **Fill in team names and roles** on slide 7 and the project page.
9. **No sourced hospital number.** Keep it qualitative.
10. **Don't say "every December"** about ZRA's calendar.
11. **Name the scoreboard behind every fraction:** "2 of 5" is the country model; "14 of 17" is the reservoir watch.

## The 7 slides
| # | Slide | On screen |
|---|---|---|
| 1 | Patronus: months to darkness | Title, one-line promise, team names |
| 2 | The lights went out | Lusaka night lights before/after (−52%); lake at 2.89%; IMF 4.7% → 1.2%; one line for Ecuador and Vietnam |
| 3 | The warning was in the data | Kariba lake level with our Jul 2023 alarm, ZRA's Dec 2023 cut, Mar 2024 load-shedding |
| 4 | How it works: NASA data to a decision | GRACE-FO, G-REALM, MERRA-2 → Sen's slope + Mann-Kendall + FDR → El Niño replay; Trend Detective screenshot |
| 5 | 2027: the window is open | El Niño +2.46; allocation cut by more than a third; 4 in 11 → 2 in 11 with a 30% cut, about 1.4 TWh; the "after" line |
| 6 | Check us | 14 of 17 (8 true early), misses named; 54 GW El Niño-exposed; 392 GW drying; timestamped forecast |
| 7 | Who it's for, and the ask | ZESCO planners → hospitals and families; the 2027 pilot; live link; team |

---

## "So what? What can you do with 3 months?" (lead-time answer)
**Short answer:** 3 months is enough to do the three things Zambia did *after* the lights went out in 2024. And every extra month of warning turns the same water saving from a shock into a trim.

**1. The water you must save doesn't change. Lead time decides how painful saving it is.**
From our simulator (`pipeline/kariba_sim.py`, El Niño analog years, 2027 allocation of 23 BCM), this is the release cut needed to bring the danger zone (below 10% at end-2027) from 4 in 11 years down to 2 in 11, by the month the cut starts:

| Start the cut in | Cut needed | Hydropower given up |
|---|---|---|
| Dec 2026 | 22% | ~1.1 TWh |
| Jan 2027 | 25% | ~1.1 TWh |
| Mar 2027 | 30% | ~1.1 TWh |
| May 2027 | 37% | ~1.1 TWh |
| Jul 2027 | 49% | ~1.1 TWh |
| Sep 2027 | 73% | ~1.1 TWh |

- The total energy given up is about the same in every row. What changes is how hard each month is hit: a 22% trim spread over a year, or a 73% slash in the last months.
- To keep the lake above 10% in *all* 11 El Niño years, the cut has to start by Feb 2027 at the latest (64% from Dec, 91% from Feb). After that it can't be done.

**2. Three months is how long the fixes take, and in 2024 they all came too late.**

| Fix | How long it takes | Zambia 2024 |
|---|---|---|
| Contracted imports (Eskom, Mozambique, Southern African Power Pool) | Weeks to months to negotiate | Load-shedding started 11 Mar 2024; imports from South Africa reportedly began 1 Aug 2024 at 218 MW, 5 months later. Contracted imports cost 17¢/kWh vs 26¢ for emergency diesel (ZESCO filing) |
| Emergency rental power (barges, gensets) | Karpowership says ~28 days to arrive after signing (Senegal) and <30 days to generate; Aggreko mobilised 48 MW in <90 days | Rented after the crisis began |
| Emergency tariff to pay for imports | Months through the regulator | ZESCO applied in Jul 2024; the narrower emergency tariff took effect 1 Nov 2024 |
| Planned load-shedding that protects hospitals, water pumping and mines | Weeks to set up and publish | Cuts started at 8 h/day and grew to reportedly up to 21 h/day |

**3. Most warnings are longer than 3 months anyway.**
- **0–3 months:** the short-range models.
- **5–8 months:** the Kariba El Niño model flagged 2024 in Jul 2023.
- **Up to 12 months:** in the reservoir watch, 8 of 17 past crises were flagged before the lake was even low.

So 3 months is the floor, not the typical warning.

**Pitch line:**
> "In 2024 Zambia did everything right, but late. Load-shedding started in March, imports in August, and the emergency tariff in November. Three months of warning puts all three *before* the lights go out. And the water you have to save doesn't change. Warning just lets you save it gently: a 22% trim from December, instead of a 73% slash in September."

**Caveats:** the analog years are history, not a forecast of exact rain. The simulator is illustrative, not an operating plan. The imports date comes from a news report citing Reuters, so verify it before putting it on a slide.

**Sources:**
- [Zambia boosts imports (AllAfrica/Bloomberg)](https://allafrica.com/stories/202411040476.html)
- [Zambia seeks imports for mining (Apr 2024)](https://newsletter.mw.creamermedia.com/article/zambia-seeks-power-imports-for-key-mining-sector-2024-04-23)
- [Emergency tariff dates](https://www.we.com.na/mw-main/zambia-electricity-emergency-continues2025-02-04147242)
- [Karpowership timelines](https://en.wikipedia.org/wiki/Karpowership)
- [Aggreko 48 MW in <90 days](https://www.casestudies.com/company/aggreko/case-study/innovative-solution-and-virtual-pipeline-to-meet-seasonal-peak-demand)
- ZESCO ERB filing, Jul 2024 (`docs/SOURCES.md`)
