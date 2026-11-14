# Global reservoir watch: method and results

`python3 -m pipeline.reservoirs` writes `web/public/data/reservoirs.json` (about 1.1 MB) in about 1 m 45 s.
Code: `pipeline/reservoirs.py` (backtest, scoring, JSON), `pipeline/reservoir_model.py` (series, targets, ENSO test, ensemble), `pipeline/reservoir_catalog.py` (lake list and GPPD match), `pipeline/reservoir_crises.py` (crisis dates and sources).

## What it does
It applies the Kariba "next" idea (satellite lake level plus an ENSO-conditioned analog ensemble) to **31 hydro reservoirs** in NASA/USDA G-REALM. These have **77 GW at the dams and another 22 GW in downstream cascades** whose flow they set (WRI GPPD, exact name matches).

The reservoirs are Kariba, Cahora Bassa, Volta/Akosombo, Kainji, Shiroro, Nasser, Lake Malawi (Shire cascade), Lake Victoria (Owen Falls), Mtera, Guri, La Vueltosa, Itaipu, Sobradinho, Emborcação, Itumbiara, Nova Ponte, São Simão, Mascarenhas de Moraes, Água Vermelha, Balbina, Daule-Peripa, Lake Junín (Mantaro), Tarbela, Tehri, Srisailam, Upper Indravati, Thac Mo, Xiaowan, Three Gorges, Toktogul and Mosul.

**Left out:**
- **Not in G-REALM:** Mangla, Bhakra, Tucuruí, Furnas, Três Marias, Hoa Binh, Son La, Kossou, Itezhi-Tezhi and Mazar/Paute.
- **Unusable series:**
  - Nam Ngum: the series ends in 2016.
  - G-REALM "Kafue": the target is the Kafue Flats, not the reservoir.
  - Garafiri: wet-season gaps every year.
  - Kpong: a run-of-river headpond.
  - Gibe III and GERD: still filling.

For Xiaowan, Tehri, Indravati and Three Gorges, only the record after first filling is used.

## Method (fixed before any crisis was scored)
1. **Level.** The monthly mean of the 10-day altimetry passes. Spikes more than max(4 robust SD, 1 m) from a 7-pass running median are removed. Gaps of 1–2 months are interpolated; longer gaps stay empty.
2. **Target.** The level against the same calendar month in **earlier years only**:
   - **warning** = below that month's 20th percentile;
   - **danger** = below its 10th percentile.

   The altimetry datum (EGM2008 geoid) is not the operator's gauge datum. Percentiles of the lake's own record make the datum irrelevant, and no storage curve is needed. For Kariba, `usable_pct` (from the ZRA-fitted curve in `kariba_data.py`) is reported as well.
3. **ENSO sensitivity.**
   - Each lake's wet season runs from its mean low month to its mean high month.
   - Each season gets the DJF ONI of the winter nearest its midpoint, using Kariba's definitions: El Niño ≥ 0.5, La Niña ≤ −0.5.
   - Two-sided permutation tests (20,000 shuffles) compare El Niño with other seasons and La Niña with other seasons.
4. **Forecast.** The current level plus each past year's level change over the same 12 calendar months, capped at the highest level seen.
   - Issue month t uses levels through t−1 and the ONI season ending in t−1.
   - Analogs are restricted to the current ENSO phase **only if** step 3 gives p < 0.1 for that phase. The test is recomputed each January from past seasons only and needs at least 8 seasons. Otherwise all past years are used.
5. **Backtest.**
   - Strictly forward, issued monthly from 1998, horizons 1–12, scored from 2000.
   - Baselines:
     - climatology: the share of earlier same-month levels below the threshold;
     - persistence: 1 if the lake is below warning now, else 0.
   - The alarm rule is Kariba's: P(below warning) > 0.5 in any of the next 12 months.
6. **Crises.**
   - 17 documented crises, each with dates and sources (`reservoir_crises.py`).
   - **Caught** means our first alarm in the 12 issues up to the onset month came before the onset month. Leads are therefore capped at 12 months.
   - Each catch is labelled:
     - **forecast** if the lake was not yet below warning when the alarm was issued;
     - **state** if the lake was already below warning.
   - A persistence-only rule is scored on the same crises for comparison.

## Results
**ENSO sensitivity (full record, p < 0.1)**

| Lake | Phase | Wet-season level effect | p |
|---|---|---|---|
| Kariba | El Niño | −1.7 m | 0.02 |
| Cahora Bassa | El Niño | −1.8 m | 0.09 |
| Sobradinho | El Niño | −1.1 m | 0.09 |
| Lake Victoria | El Niño | +0.4 m (wetter short rains) | 0.001 |
| Three Gorges | El Niño | +6.9 m | 0.08 (only 10 seasons) |
| Volta | La Niña | +1.1 m | 0.07 |
| Água Vermelha | La Niña | +2.0 m | 0.04 |
| Emborcação | La Niña | +8.0 m | 0.05 |

Guri has the expected El Niño sign (−2.9 m) but is not significant (p = 0.15). The other 23 lakes show no detectable ENSO effect, so they use climatology analogs.

**Pooled skill (31 lakes, issues 2000–2026, about 6,500–7,000 forecasts per horizon)**

| Horizon | Brier skill vs climatology | Brier skill vs persistence | AUC-PR (climatology 0.27) |
|---|---|---|---|
| 1 month | 0.66 | 0.34 | 0.89 |
| 3 months | 0.38 | 0.31 | 0.73 |
| 6 months | 0.15 | 0.28 | 0.58 |
| 12 months | −0.02 | 0.28 | 0.46 |

- **Against climatology:** skill is positive from 1 to 10 months. It beats climatology in 25 of 31 lakes at 3 months, 17 of 31 at 6 months and 12 of 31 at 12 months.
- **Against persistence:** the binary persistence baseline is weak, and every lake beats it from 3 months on.
- **At 12 months** the method has no skill over climatology.

**Crises (17 scored)**

| Crisis | Reservoir | Official warning | Onset | Our first alarm | Lead (months) | Type | Persistence-rule lead |
|---|---|---|---|---|---|---|---|
| Brazil 2001 (Southeast) | Emborcação | 2001-05-17 | 2001-06 | 2000-09 | 9 | state | 9 |
| Brazil 2001 (Northeast) | Sobradinho | 2001-05-17 | 2001-06 | 2000-08 | 10 | forecast | 6 |
| Ghana 2006-07 | Volta | none found | 2006-08-26 | 2005-08 | 12 | forecast | miss |
| Venezuela 2009-10 | Guri | 2009-11-11 | 2010-01-12 | 2009-11 | 2 | forecast | 0 (late) |
| Nigeria 2012 | Kainji | none found | 2012-03-17 | 2011-07 | 8 | forecast | 7 |
| Brazil 2014-15 (Southeast) | Emborcação | none found | 2014-10 | 2013-10 | 12 | state | 12 |
| Zambia/Zimbabwe 2015-16 | Kariba | 2015-03 | 2015-06 | **missed** (max P 0.45) | — | — | miss |
| Brazil 2015 (Northeast) | Sobradinho | 2015-05-05 | 2015-09-26 | 2014-09 | 12 | forecast | 10 |
| Malawi 2015-16 | Lake Malawi | none found | 2015-11 | 2015-01 | 10 | forecast | 7 |
| Ghana 2016 | Volta | none found | 2016-04 | 2015-04 | 12 | state | 12 |
| Venezuela 2016 | Guri | none found | 2016-04-21 | 2015-04 | 12 | state | 12 |
| Zambia/Zimbabwe 2019 | Kariba | 2019-03-01 | 2019-05-09 | **missed** (P 0.50, alarm needs > 0.5) | — | — | 0 (late) |
| Brazil 2021 (Southeast) | Emborcação | 2021-05-27 | 2021-05-28 | 2020-05 | 12 | forecast | 7 |
| Itaipu 2021 | Itaipu | 2021-05-27 | 2021-10-20 | 2020-10 | 12 | state | 12 |
| Pakistan 2022 | Tarbela | none found | 2022-03-21 | 2021-06 | 9 | forecast | 2 |
| Zambia/Zimbabwe 2024 | Kariba | 2023-12-28 | 2024-03-11 | 2023-03 (in force since 2022-01) | 12 | state | 12 |
| Pakistan 2025 | Tarbela | 2025-03-15 | 2025-03-20 | **missed** (lake at its 48th percentile) | — | — | miss |

- **Caught 14 of 17** before onset. 8 of the catches came before the lake had fallen below its warning level; 6 were "already low" state signals.
- **Persistence baseline:** the "lake already low" rule alone catches 12 of 17. The ensemble adds Ghana 2006 and Venezuela 2009, and gives earlier warning on six more crises.
- **Missed:** Kariba 2015 and Kariba 2019, and Tarbela 2025. Tarbela reaches dead level every spring by design, so a percentile target cannot see it.
- **Not scorable:**
  - Kyrgyzstan 2008: the Toktogul record starts in Jul 2008.
  - Ecuador 2023-24: Mazar/Paute is not in G-REALM.

**Live forecast (issued 2026-11-15, data through Oct 2026, ONI ASO 2026 = +2.46, El Niño)**
- **Highest P(below warning) in the next 12 months:** Cahora Bassa, Kainji, La Vueltosa and Srisailam (all 1.0), then Toktogul 0.69, Three Gorges 0.67 (3 analogs only), São Simão 0.57, Xiaowan 0.50 and Kariba 0.45 (El Niño analogs).
- **Cahora Bassa** is at its 12th percentile now. It is El Niño-sensitive, but the forward gate has not opened, so it uses climatology analogs.
- **Kainji, La Vueltosa and Srisailam** are already below warning, partly because of long-term level trends (see limitations).

## Limitations
- **Datum and meaning of a percentile.**
  - The altimetry level is not the operator's gauge.
  - A low percentile is not a low usable storage. Kariba by percentile has been in its warning zone since Jan 2022, while `kariba.json` uses 20% usable storage.
- **Lakes with trends.** Some lakes trend (sedimentation, upstream dams, operating rules). For them, "below the earlier 20th percentile" happens more than 20% of the time (base rate 0.27) and can last for years.
- **Analog ensemble.**
  - It ignores the lake's shape and its operating limits.
  - The ENSO outlook is the ONI known at issue, not an archived forecast.
- **Rule-driven lakes.** Itaipu, Three Gorges, Lake Victoria and Lake Malawi levels follow operating rules more than drought.
- **Crisis dates.** These come from news and official statements, and several are known only to the month. Multi-reservoir crises are scored on one main reservoir chosen in advance; the others are listed in `other_reservoirs`.
