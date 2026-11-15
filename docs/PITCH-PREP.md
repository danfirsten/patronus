# Patronus: pitch prep (Sun Nov 15, 2026)

Built from `docs/CORE-QUESTIONS.md`, `DESIGN.md` §8 and §12–14, `docs/CHALLENGE.md` and a walk through the live site. Sean's final 7-slide deck lives in his own repo, so this follows the 7-slide map in CORE-QUESTIONS. If his slide order differs, keep the words and move them to his slides.

**Rehearsal page (phone):** https://claude.ai/artifact/9VWPtjZh8YJDDroPY5zbcq. It has a per-slide timer with checkpoints, a 2/3-minute toggle, script and cue cards, and a random judge question. It's private until Dan shares it from its Share menu.

**New since the prep (Sean's `docs/VOLL.md`):**
- Acting when the alarm fired in July 2023 would have saved about **$150–300M**. That's the central case, with realistic imports; at the low value-of-lost-load it's about break-even.
- Use it as a range, credited to the counterfactual. Keep time and power as the lead.

---

## 1. Speaker roles
Same split for both lengths, so there are only two handoffs.

| Role | Slides | Plays to | Owns in Q&A |
|---|---|---|---|
| **A: Narrator** `[name]` | 1–2 | Warm, clear storyteller; sets the human stakes | Story, AI use, "talked to customers?" |
| **B: Scientist** `[name]` | 3–4 | Knows the pipeline and the stats cold | Accuracy, data, El Niño, latency, challenge fit |
| **C: Closer** `[name]` | 5–7 | Calm, business-minded; lands the decision and the ask | Who pays, moat, ZRA, viability, roadmap |

- **A drives the laptop** while C talks on slide 5.
- **Choosing people:** B should be whoever ran the pipeline. C should be the most relaxed speaker under questioning.
- **Handing off in Q&A:** if a question belongs to someone else, say "Good question. [Name] built that part." Never answer two at once.

## 2. Run of show
The pace is about 150 words a minute. The 3-minute script is 435 words; the 2-minute one is 238.

### 3-minute (180 s)
| # | Slide | Who | Secs | Clock | If long, cut |
|---|---|---|---|---|---|
| 1 | Patronus: months to darkness | A | 9 | 0:09 | "We use NASA water data to" |
| 2 | The lights went out | A | 32 | 0:41 | "Zambia gets most of its power from that lake." |
| 3 | The warning was in the data | B | 18 | 0:59 | Nothing; this is the proof of timing |
| 4 | How it works | B | 27 | 1:26 | "Here's how. We read three NASA datasets." |
| 5 | 2027: the window is open (+ demo) | C | 35 | 2:01 | "The earlier you start, the gentler it is." (keep 22% vs 73%) |
| 6 | Check us | C | 21 | 2:22 | "And every forecast is hashed and timestamped…" |
| 7 | Who it's for, and the ask | C | 31 | 2:53 | The 26¢ vs 17¢ sentence |
| | Buffer | | 7 | 3:00 | |

**Checkpoints:** slide 2 done by **0:45**, slide 4 by **1:30**, slide 7 starts by **2:25**.

### 2-minute (120 s)
| # | Who | Secs | Clock |
|---|---|---|---|
| 1 Title | A | 7 | 0:07 |
| 2 The lights went out | A | 25 | 0:32 |
| 3 Warning in the data | B | 9 | 0:41 |
| 4 How it works | B | 18 | 0:59 |
| 5 2027 | C | 22 | 1:21 |
| 6 Check us | C | 7 | 1:28 |
| 7 Customer and ask | C | 17 | 1:45 |
| Buffer | | 15 | 2:00 |

**Checkpoints:** slide 3 starts by **0:35**, slide 5 by **1:00**, slide 7 by **1:30**. There's no live demo in this version; slide 5 shows a simulator screenshot instead.

### Transitions
- **A → B:** A: "The warning was in NASA data." *(click)* B: "In July 2023, our model raised the alarm…"
- **B → C:** B: "…from today's lake level." *(click)* C: "And it matters right now."
- **Demo:** C: "Watch." A drags the slider to 30%. C: "2 in 11."
- **End:** "Patronus. Months of warning, not minutes." Then hold one beat of silence.

## 3. Script (3-minute)
**1 · A.** We're Patronus. We use NASA water data to give countries that run on hydropower months of warning before the lights go out.

**2 · A.** In 2024, Lake Kariba, the world's largest man-made reservoir, fell to under 3% usable water. Zambia gets most of its power from that lake. Power went off 8, then 12 hours a day. From space, NASA's night-light satellite saw Lusaka dim by half. Emmanuel Simukoko runs a small shop in Lusaka. He lost about 30% of his business. He told Yale E360: "When the lights are off, people think that my shop is closed." The warning was in NASA data.

**3 · B.** In July 2023, our model raised the alarm on Kariba: five months before the river authority cut the water, and eight months before load-shedding began. Zambia did the right things, but late. Load-shedding in March. Imports in August. An emergency tariff in November.

**4 · B.** Here's how. We read three NASA datasets. GRACE-FO weighs the water in the river basin. Radar altimetry measures the lake's height. MERRA-2 gives the rain. Then we test which trends are real: Sen's slope for the rate of change, Mann-Kendall for significance. That is the challenge answer, and anyone can run it on our Trend Detective page. Finally, we replay past El Niño years from today's lake level.

**5 · C.** And it matters right now. A very strong El Niño is under way. The river authority has already cut Kariba's 2027 allocation by more than a third. Patronus says there's about a 1 in 3 chance the lake falls into the danger zone by the end of 2027. Watch. A 30% release cut from January brings that down to 2 in 11 years. The earlier you start, the gentler it is. From December, a 22% trim does it. Wait until September, and you need a 73% slash.

**6 · C.** Don't just trust us. Check us. We ran the same method, unchanged, on 31 reservoirs on 4 continents. It flagged 14 of 17 past power crises; 8 of them came while the lake still looked fine. We show the 3 we missed. And every forecast is hashed and timestamped before the outcome.

**7 · C.** Our customer is the power planner at ZESCO, Zambia's utility. Today they find out when the lake is already low, and buy emergency power at 26 cents a kilowatt-hour instead of contracted imports at 17. With Patronus they know how much time they have, and what acting now buys them. Hospitals, factories and families get a schedule instead of a surprise. Our ask: help us run a 2027 pilot alongside the river authority and ZESCO. Patronus. Months of warning, not minutes.

### 2-minute script
1. **A:** We're Patronus. We give countries that run on hydropower months of warning before the lights go out.
2. **A:** In 2024, Lake Kariba fell to under 3%. Zambia lost power 8, then 12 hours a day. NASA night-light data shows Lusaka dimmed by half. Emmanuel Simukoko, a Lusaka shopkeeper, lost about 30% of his business: "When the lights are off, people think that my shop is closed."
3. **B:** But in July 2023, our model raised the alarm. Five months before the official cut. Eight months before the blackouts.
4. **B:** We read NASA data: GRACE-FO for basin water, radar altimetry for the lake, MERRA-2 for rain. We measure the trend with Sen's slope and test it with Mann-Kendall. Anyone can try it on our Trend Detective page. Then we replay past El Niño years from today's level.
5. **C:** Now a very strong El Niño is back. Today it's about 1 in 3 that Kariba hits the danger zone by end-2027. A 30% release cut from January makes it 2 in 11. Start in December and a 22% trim does it. Wait until September and you need 73%.
6. **C:** Same method, 31 reservoirs: 14 of 17 past crises flagged. We publish our misses.
7. **C:** Our customer is ZESCO's power planner. With Patronus they know how much time they have, and what acting now buys them. Our ask: a 2027 pilot with ZESCO and the river authority. Patronus. Months of warning, not minutes.

### Cue cards
1. **A:** Patronus = months of warning before the lights go out.
2. **A:** Kariba under 3% → 8, then 12 h/day → Lusaka dims by half → Emmanuel, −30%.
3. **B:** Alarm Jul 2023 → 5 months before the cut, 8 before load-shedding. Late on everything: Mar, Aug, Nov.
4. **B:** GRACE-FO, altimetry, MERRA-2 → Sen's slope + Mann-Kendall → replay El Niño years. Trend Detective.
5. **C:** El Niño now; allocation cut by more than a third → about 1 in 3 → 30% cut from Jan → 2 in 11. 22% from Dec vs 73% from Sep.
6. **C:** 31 lakes, 4 continents, 14 of 17, 8 truly early. Misses shown. Timestamped.
7. **C:** ZESCO planner. "How much time I have, and what acting now buys me." Pilot 2027. Months of warning, not minutes.

### Say / never say
| Say | Never say |
|---|---|
| "about 1 in 3" (the odds) | "36%" for the odds |
| "cut by more than a third" (the allocation) | "36% cut" next to the odds |
| "8, then 12 hours a day" | "21 hours a day" (news only) |
| "the IMF cut its growth **forecast** from 4.7% to 1.2%" | "growth fell to 1.2%" (actual 2024 growth was near 4%) |
| "about 1.4 TWh" (net), if asked | "1.5 TWh" as the cost |
| "14 of 17 (reservoir watch), 8 truly early" | "we caught 14 crises early" |
| NOAA: "above 79%" (12 Nov CPC) | "83%" (the October issue) |
| "about $150–300M saved, in the central case" (Sean's counterfactual) | a single dollar figure |
| Ecuador = "it keeps happening" | "we'd have caught Ecuador" |
| "our hypothesis is…" for customers and payment | "ZESCO wants this" |

## 4. Q&A drill (15 s each, then bridge back to Kariba)
| # | Question | Who | Answer | Bridge |
|---|---|---|---|---|
| 1 | **Who pays?** | C | Hypothesis: the public warning stays free; a utility or a development lender pays for a version run on its own data. One month of 300 MW of emergency power cost Zambia about $51M. We haven't talked to a customer yet; the pilot is how we find out. | "That $51M a month is the price of finding out late." |
| 2 | **Why not ZRA's projection?** | C | ZRA gives one number: 9% at end-2027. We give the odds around it (median 31%, about 1 in 3 below 10%), and their 9% sits inside our range. We also show what a cut buys. ZRA is our decision partner. | "A single number can't tell a planner how much time they have. Odds can." |
| 3 | **Moat?** | C | The data is open, so the moat isn't data. It's a method fixed before scoring and tested on 31 lakes, plus a public, timestamped track record that compounds, and the decision layer on top. | "2027 is our first live test, already timestamped." |
| 4 | **How accurate?** | B | Kariba alarm in Jul 2023, 5 months early. Since 1995: 3 hits, 2 misses, 2 false alarms. 31 reservoirs: 14 of 17 flagged, 8 truly early. Brier skill 0.38 vs climatology at 3 months. | "The misses are on the page next to the hits." |
| 5 | **What if El Niño fades?** | B | The odds drop, and the forecast updates monthly; it's already weighted by the outlook. But the lake starts at 31% and the allocation is cut by more than a third. | "Either way the planner knows earlier." |
| 6 | **Data latency?** | B | Lake level from altimetry is days old (9 Nov for a 15 Nov forecast). GRACE-FO lags a few months, which is fine for decade trends. The decision is seasonal. | "The decision window is months, not days." |
| 7 | **Just El Niño forecasting?** | B | No. We take NOAA's and NASA's El Niño forecasts. Only 9 grids (54 GW) and 8 of 31 lakes show a robust El Niño effect, and we turn that into lake level and a decision. | "Kariba rises about 2 m less in El Niño years, p ≈ 0.01." |
| 8 | **6 of 14 already low?** | B | Right. A "lake already low" rule gets 12 of 17. Ours adds Ghana 2006 and Venezuela 2009 and warns earlier on six more. The honest claim is 8 of 17 truly early. | "Kariba 2024 is the clean case: July 2023." |
| 9 | **Why trust a hackathon tool?** | A | It shouldn't, blindly. Hashed, timestamped forecasts; misses on the page; open code and data. 2027 is a public test. | "Check us in December 2027." |
| 10 | **Weak country model?** | B | Labelled experimental, on purpose. The claims rest on the reservoir models, which beat climatology and persistence on unseen data. | "The Kariba claim stands on the reservoir model." |
| 11 | **Is the cost real?** | C | Prices are real (ZESCO filing: 17¢ vs 26¢). Sean's counterfactual says acting in Jul 2023 saves about $150–300M in the central case, about break-even at the low assumption. | "What we're sure of is the timing: a 22% trim from December, or a 73% slash from September." |
| 12 | **Talked to ZESCO/ZRA?** | A | Not yet; it's a weekend build. The first step is one conversation with ZESCO planning and a 2027 pilot next to their own numbers. | "The forecast is public, so they can check it first." |
| 13 | **How is this the challenge?** | B | Trend Detective: 9 NASA variables × 107 regions, seasonal cycle removed, Sen's slope with a 95% interval, Mann-Kendall, FDR on the map. Three guided demos. 392 GW of hydro sits in significantly drying basins. | "For Kariba the threat isn't a steady slide. It's El Niño." |
| 14 | **6 more months / scale?** | C | Add SWOT for lakes we can't see (Ecuador, Vietnam), pilot with one utility, backtest with archived El Niño forecasts, work on the Kariba 2015/2019 misses. Already runs on 31 reservoirs, no logins. | "First stop is still Kariba 2027." |
| 15 | **AI use?** | A | Yes, for research, critique and coding. The concept, choices and checks are ours; AI-written material is labelled. | "Every number traces to a source on the Proof page." |

**Drill these first:** #1, #2, #4, #5 and #12.

**Traps on screen during Q&A:**
- **TWh:** the simulator's sentence says "1.5 TWh". If asked: "1.5 is held back by choice; net, about 1.4."
- **Cost tile:** it goes **up** with a cut ($108M → $270M), because the power is replaced on purpose. If asked: "That's the replacement bill. The point is the danger odds halve."
- **Trend Detective case 1:** step 1 shows no significant long-term fall (p = 0.28). That's the point: step 3 shows the El Niño effect (p = 0.008).

## 5. Live demo (3-minute only, if allowed)
**Pre-load two tabs:**
1. `https://patronus-blackout-watch.aui-svi.workers.dev/#/kariba`, scrolled to "TRY IT: WHAT IF WE ACT NOW?". Slider at 0%, start Jan 2027, El Niño years.
2. `…/#/explore`, case 1, opened at step 3.

**The clicks:**
1. Point at "31% usable now" and the 1-in-3 odds. Optional.
2. **Drag the slider to 30%.** The screen shows "4 in 11 → 2 in 11"; say "2 in 11". This is the only click spoken in the script.
3. Trend Detective step 3: El Niño, p = 0.008. For Q&A, or if time allows.

**Backups:**
- Slide 5 carries a simulator screenshot. Say the same words and don't apologise.
- A phone hotspot.
- Screenshots of all demo states on the laptop.
- The 30-second video saved locally.
- Last resort: `cd web && npm run build && npm run preview` on the laptop.

## 6. Rehearsal plan
Feature freeze is at 3 PM. **Submit by 9 PM** (the deadline is 11:59 PM local).

| When | What |
|---|---|
| Before 3 PM | Each person reads their slides aloud 3 times with the timer page |
| 3:15 | Run 1: 3-minute, cold, timer only, note the checkpoints |
| 3:30 | Make the cuts the timer demands; agree who clicks |
| 3:45 | Run 2: 3-minute with slides and the demo |
| 4:00 | Run 3: the 2-minute version |
| 4:15 | Q&A drill: 15 minutes, random questions, 15 s per answer |
| Mentor slot | Mentor practice run (checklist below) |
| After | Apply the top 3 notes; Run 4 at the confirmed length |
| Evening | Run 5: full dress, standing, no notes. Then stop |

**Listen for:**
- Did we finish slide 7?
- Did we name the customer and the feeling?
- Did we name the NASA data and say "Sen's slope" and "Mann-Kendall"?
- Did any "never say" words slip out?
- Handoffs under 1 second.
- One number per sentence.
- Eyes on the judges.

**Mentor run checklist:**
- [ ] Confirm the format (2 or 3 minutes, demo or not).
- [ ] Do one timed run.
- [ ] Ask: "Who is the customer and how do they feel?"
- [ ] Ask: "Which NASA data, and what's the trend test?"
- [ ] Ask for 3 hard questions.
- [ ] Ask: "One thing to cut? One thing missing?"
- [ ] Apply at most 3 notes.

**Submission checklist (before 9 PM):**
- [ ] **Demo:** at most **7 slides including the title**, or a video of at most **30 seconds**.
- [ ] **Video:** plays locally and online; English or English subtitles.
- [ ] **Language:** everything in English.
- [ ] **References field:** every external resource. Use `docs/SOURCES.md`, plus Sean's back-test datasets (IMERG, SMAP, JPL/CSR GRACE, GRACE-DA, MODIS snow, NMME/CFSv2), Yale E360, libraries and fonts.
- [ ] **AI ("Super Intelligence") disclosure** on the project page; AI images or video get a visible watermark. Confirm the exact wording on the Submission Guide (the site was down when this was written).
- [ ] No NASA logos or insignia; no Harry Potter imagery.
- [ ] **Links:** the live site, repo and video open in an incognito window. **Make `danfirsten/patronus` public.**
- [ ] All 3 members are on the Members tab.
- [ ] Both checkboxes ticked.
- [ ] Submit, then reopen the project page logged out.

## 7. Weak points and fixes
1. **"Months to darkness" with no months number.** The Kariba page's first month with a ≥1-in-3 chance below 10% is about Oct 2027, roughly 11 months away. Optional slide-5 line: "On today's numbers, Zambia has about 11 months." Check it on screen first.
2. **The customer is unvalidated** and "who pays" is a hypothesis. Say so first; the ask is a pilot.
3. **Simulator traps** (the 1.5 TWh sentence; the cost tile rising with the cut). Stop the demo on "4 in 11 → 2 in 11".
4. **The Overview page says "up to 21 hours a day"** (news only). Have the prepared answer ready.
5. **NOAA odds:** use "above 79%" (12 Nov CPC). DESIGN §8 is now aligned.
6. **The two 36s** sit side by side on the Kariba page. Say "more than a third" and "about 1 in 3".
7. **Relevance in the 2-minute version:** slide 4 must *show* "Sen's slope", "Mann-Kendall" and a Trend Detective screenshot.
8. **Sean** checks his deck order against §2 and adds team names to slide 7.
