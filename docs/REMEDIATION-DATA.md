# Remediation data: what happened, what was done, what it cost

Purpose: give Patronus sourced facts about each crisis's stages, the actions taken, and what each action cost or achieved. The "what if they had acted at our alarm date" replay, the Playbook and the `#/plan` simulator can then point at real precedents instead of assumptions.

Everything here was checked against the source on 14-15 Nov 2026. Anything we could not confirm was dropped (see "Rejected" below). The files are new; nothing in `pipeline/` or `web/` was changed.

## The files

All new files are in `data/reference/remediation/`.

### `crisis_actions.csv`: 47 dated events across the 5 scoreboard crises

One row per dated event: Kariba/Zambia 2024 (20 rows), Brazil 2021 (9), Ecuador 2023-24 (11), Northern Vietnam 2023 (4), Sichuan 2022 (3).

*Why it applies:* this is the record of what each country actually did and when, with the cost or effect where one was published. A decision replay needs exactly this to compare against.

| Column | Meaning |
|---|---|
| `crisis_id` | Same ids as `web/public/data/crises.json` (`kariba-2024`, `brazil-2021`, `ecuador-2023-24`, `vietnam-2023`, `sichuan-2022`) |
| `date` | ISO date of the event, not the publication date |
| `date_precision` | `day`, `month` (first of the month stands in) or `approx` (within about a week; usually the report date) |
| `stage` | `warning`, `onset`, `escalation`, `peak`, `recovery` |
| `type` | `warning` (someone said trouble was coming), `action` (a decision was taken), `outcome` (a measured result or cost) or `state` (the system's condition: lake level, deficit, imports) |
| `actor` | Who did it, e.g. ZRA, ZESCO, CENACE, MME |
| `text` | One plain-English line |
| `value`, `unit` | The headline number, if there is one. Units are explicit, e.g. `h/day`, `MW`, `BRL bn`, `MUSD`. Empty when the event has no number. |
| `source_url`, `source_type` | `P` = primary (government, regulator, operator or utility document or data). `N` = news, including news quoting officials. These are the same tags `crises.json` uses. |
| `note` | Conflicts, corrections and caveats. Read it before putting a row on a slide. |

### `kariba_zra_statements.csv`: 35 Lake Kariba gauge readings from 11 ZRA press statements

The readings run from Dec 2023 to Feb 2025. Seven more readings, from Mar to Sep 2023, come from the "same date last year" columns printed in the 2024 statements. Each reading gives the level in metres, the usable storage in billion m³ (BCM) and the usable %. All rows are `P`.

*Why it applies:* this is the lake's state on the dates the decisions were made, from the operator's own gauge. The replay can then show "on the day load-shedding went to 12 h the lake was at 13.0%" without relying on satellite estimates.

## How it was verified

- **ZRA statements:** downloaded the PDFs from zambezira.org and read the tables directly. Two statements (12 Apr and 13 Aug 2024) are scanned images with no text, so they were skipped.
- **Cross-check against our own model:** the storage curve in `web/public/data/kariba_sim.json` (`usable_pct = a·x + b·x²`) reproduces every ZRA usable-% figure within 0.11 points (curve 0.00 to 0.11 below ZRA). This validates the curve over 475.9-479.6 m with 35 points it was not fitted to.
- **Satellite vs gauge:** we paired 34 readings with the nearest G-REALM date (within 5 days). G-REALM reads a median **0.23 m below** ZRA (mean 0.26 m, range −0.98 to +0.02 m). Near the floor, 0.23 m is about 1.6 usable-% points. `kariba.json` already warns about this ("~0.2-0.4 m below the gauge at the 2024 low"); these pairs put a number on it for 2023-25.
- **News and other documents:** each figure was opened at its source and the sentence quoted. When the given URL blocked automated access (Lusaka Times, Herald, allAfrica and dialogue.earth returned HTTP 403), we used another source that states the same fact, or dropped the figure.

## Conflicts and corrections (also in the `note` column)

| Item | What we found |
|---|---|
| Kariba, 28 Dec 2023 allocation "from 30 to 16 BCM" | The ZRA statement gives 16 BCM but **does not state the previous figure**. The "from 30" in `kariba.json` / `crises.json` needs another source. |
| Kariba North halted ~14 Sep 2024 | Only ZESCO's *warning* that it "may likely shut down... by September 14" was found. No source opened confirms the shutdown. Keep "(approx.)" or call it a warning. |
| Kariba 214 MW cap | ZRA (6 Mar 2024) sets 214 MW average per utility **to end March 2024**, pending review. An extension to year-end appears only in a search snippet and was not verified. |
| Zambia imports Aug 2024 | Three versions: 218 MW negotiated from Eskom + ZPC "within August" (Xinhua, 1 Aug); 218 MW "from August 1... off-peak" (Open Zambia, 5 Aug); 168 MW secured from Eskom + 50 MW from SAPP expected 21 Aug (Zambian government's PDU, 16 Aug). `docs/CORE-QUESTIONS.md` uses "1 Aug at 218 MW", which only Open Zambia supports. |
| Zambia emergency tariff | ERB **rejected** ZESCO's first application (24 Aug 2024), approved on 10 Oct, and the tariff took effect on 1 Nov 2024 (ZESCO). |
| Zambia 12.6 c/kWh import price | The government says "as much as" 12.6 US c/kWh. This is a ceiling, not an average. It is below ZESCO's filing (17-26 c), which covers different supply blocks. |
| Ecuador 2024 cut hours | Global Voices says "8 to 14 h from 18 Sep". Primicias: cuts began **23 Sep** at 4-12 h/day, were 10 h/day until 17 Oct, and 14 h/day was announced 24 Oct and in force from **25 Oct**. We use Primicias. `crises.json` has wave 3 at "2024-09-22 (approx.)". |
| Ecuador industrial-cut order | Dated **5 Oct 2024** (CENACE order), not 6 Oct. |
| Ecuador power barge | USD 114.39 M for 100 MW over 540 days, signed 1 Aug 2024. It was expected 13 Sep and **started 16 Sep**. The 1,080 MW gap is CENACE's figure, so the barge covered about 9% of it. |
| Brazil R$26.9 bn vs R$15.8 bn | Both are in the same ONS-sourced article and measure different things: lower operating cost (26.9) vs the value of water kept in reservoirs (15.8). They overlap, so **do not add them**. |
| Brazil "almost R$9 bn" thermal cost | A forecast from June 2021 (ANEEL), not the final cost. |
| Brazil bonus | R$2.4 bn ÷ 5.6 TWh ≈ R$429/MWh, below the R$500/MWh rate. The source does not explain the gap. |
| Vietnam reservoirs | EVN (7 Jun 2023): Lai Chau and Son La below dead level on 6 Jun. VnExpress (13 Jun): Son La 1.7 m above it. Probably refill between the two dates. |

## Rejected (not in the files)

- **ZESCO revenue loss of ~US$35M/month (Mar 2024):** only seen in a search summary; the article blocks automated access.
- **"Mazar closed 18 times Jan-Jun 2024":** no source found states it, including the article it was attributed to.
- **Zambia "21 h/day" load-shedding:** no source opened states it. The government's "3 h/day supply" (Oct 2024) implies it; that row says so.
- **Vietnam imports in MW, and a 220 kV China line:** 2023 sources give energy (GWh/day), not MW.
- **Sichuan downgrade to Level 2 on 29 Aug 2022, and Sichuan cloud seeding:** not confirmed. The cloud-seeding reports found were about other provinces.
- **Brief's candidate "26 Aug 2024 476.76 m, 8.71%":** ZRA's own statement gives 27 Aug 476.75 m, 8.64%, which is what we use.

## How this can feed the replay, the Playbook and `#/plan` (hooks for Dan and Sean's team)

These are suggestions; nothing was wired in.

1. **`#/plan` simulator (pat-sim).** Read `crisis_actions.csv` client-side (or have the pipeline turn it into JSON) and filter by `crisis_id == "kariba-2024"`. Rows with `type=action` and a `value` give the real 2024 decision ladder to plot under the user's chosen plan: 8 h (11 Mar), 12 h (20 May), 17 h (1 Sep), imports (Aug), emergency tariff (1 Nov). That gives a "what you chose vs what Zambia did" line.
2. **Kariba counterfactual (pat-kariba-cf).** Use `kariba_zra_statements.csv` as the observed lake state at each decision date. For example, the 12-hour step came when ZRA had the lake at 13.0% (24 May). Rows tagged `Prior-year comparison column` give the 2023 path for the same weeks, which makes the "acted in Jul 2023" anchor concrete (the lake was at 27-29% then).
3. **Playbook / remediation section.** Measured action results to cite, all from this file:
   - Brazil's voluntary demand cut saved 5.6 TWh for R$2.4 bn, against MME's R$9.6 bn thermal alternative.
   - Ecuador paid USD 114 M for 100 MW against a 1,080 MW gap.
   - Sichuan brought in 132 GWh/day over 8 lines.
   - Vietnam imported about 11 GWh/day, about 1.3% of its daily output.
   - Zambia imported 496 MW against a 1,510 MW deficit.
4. **`crises.json` (pipeline/crises.py).** Add these events to the crisis timelines, and fix the Ecuador dates and the Kariba North wording listed above.
5. **`docs/SOURCES.md`** is generated from `web/public/data/meta.json` (`python3 -m pipeline.meta`), so it was not edited by hand. To list these sources, add one meta entry, e.g. "Crisis action records (ZRA statements, ZESCO/ERB, MME/CREG, ONS, CENACE via Primicias, EVN, Sichuan press)", and point it at this doc.

## What is still missing

- Monthly Kariba **turbine releases**: ZRA publishes allocations, not releases, so the cost model still assumes an even spread.
- A **primary ZESCO load-shedding notice** for each step: we have news and government restatements only.
- The **realised** Zambian import volumes and costs for 2024 (we have announced MW and a price ceiling).
- Ecuador's **total** emergency spend, and the Mazar level series before Dec 2024.
- Final audited cost of Brazil's 2021 thermal dispatch.
- Any **Zimbabwe-side** (ZPC/ZESA) action timeline.

_Change log: 2026-11-15, first version (arvin-remediation)._
