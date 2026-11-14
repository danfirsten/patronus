# Future Detector back-test v2: what it found

An independent back-test of the Patronus question, run in the Future Detector repo on 14 Nov 2026. It gives the team a second opinion. It does **not** replace the Patronus generation or Kariba models, and nothing in the app reads it yet. Numbers: `web/public/data/backtest_fd.json`. Raw outputs: `data/reference/fd_backtest/`.

## Setup in one paragraph
- **67 generation units:** 53 countries (Ember monthly, from 2000 where available), the 4 Brazil ONS subsystems (SE/CO, S, NE, N), and 10 US states from the EIA bulk file (WA, CA, NY, OR, AL, ID, TN, MT, SD, AZ).
- **Kariba** is scored separately on G-REALM lake level.
- **Split:** train on months up to 2020, test on 2021-2025.
- **Label:** a month is a shortfall when it falls below the 20th percentile of that calendar month in training. A capacity-corrected label is reported as a second view.
- **Learner:** logistic regression, picked on a 2018-2020 validation split.
- **Baselines:** climatology and persistence.
- **Scores:** AUC-PR and Brier skill, with 90% intervals from 300 block-bootstrap resamples over test months.
- **No publication-lag adjustment, and no recalibration.**

## Five headline numbers
| # | Finding | Value [90% interval] |
|---|---|---|
| 1 | Best model vs climatology (AUC-PR ratio) | x2.06 [1.95-2.18] at 1 month · x1.48 [1.39-1.58] at 3 · x1.25 [1.18-1.33] at 6 |
| 2 | Best model vs persistence | x1.26 [1.21-1.31] at 1 · x1.23 [1.19-1.28] at 3 · x1.14 [1.11-1.18] at 6 |
| 3 | Water signals beyond recent generation, pooled over 67 units | x1.01 [1.00-1.02] at 1 · x0.98 [0.96-0.99] at 3 · x0.92 [0.90-0.94] at 6. **No gain.** |
| 4 | Brazil only, with ONS reservoir storage (EAR) and inflow (ENA), vs hydro history | x1.08 [1.03-1.13] at 1 · x1.21 [1.03-1.40] at 3 · x1.20 [1.04-1.36] at 6. Adding GRACE gives x1.27-1.40 at 2-5 months. |
| 5 | Brazil SE/CO 2021 (onset July 2021) | Signals-only model P = 0.62 / 0.76 / 0.84 at 3 / 2 / 1 months ahead. Climatology is 0.19. Hydro history and persistence never reached 0.40. |

**Bottom line:** the model is a 1-3 month ranking aid built mainly on recent generation. It is not a 6-month warning, and its probabilities are not calibrated. Water signals add skill only where reservoir storage is observed directly, as in Brazil.

## Crisis lead times (alert = P(shortfall in the onset month) >= 0.40)
| Crisis | Unit | Result |
|---|---|---|
| Brazil 2021 | SE/CO subsystem | **3 months** ahead (signals-only model) |
| Brazil 2021 | national | **Missed.** P < 0.13 at 1-4 months. The 0.44 at 6 months collapses later, so it is not a usable warning. |
| Kariba 2024 | lake level | Every model "flags" it 6 months ahead, but the level had been below its 20th percentile since March 2022, so that is persistence. The stricter check uses a model with no level input: for April 2024, the first record-low month, it gives P 0.51 at 4 months and 0.58 at 3 months. |
| Sichuan 2022 | CHN, national only | **Missed** (no open provincial data) |
| Vietnam 2023 | VNM | **Missed** (P <= 0.09) |
| Ecuador 2024 | ECU | **Missed** by the full model (P <= 0.16). The signals-only model reached 0.41 at 5 months. |

## Honest misses and caveats
- The Brazil storage gain holds only on the main label. On the capacity-corrected label it is x1.02-1.07, and every interval includes 1. Brier skill is negative from 3 months for every Brazil model. The sample is 5 correlated units.
- **Calibration:** none was done, and Brier skill is at or below zero at 4-6 months on several subsets.
- **Latency:** none was applied, so leads may be 1-3 months too optimistic compared with Patronus's lag-aware test.
- **Kariba's label is storage, not generation:** no open monthly Zambia or Zimbabwe generation series exists.

## Why these numbers differ from `generation_backtest.json`
| | Patronus | Future Detector v2 |
|---|---|---|
| Label | capacity factor at least 15% below an expanding same-month median (base rate 16%) | below the training 20th percentile (test rate 29%) |
| Split | blocked leave-one-year-out with a 12-month gap, plus a forward test from 2024 | a single split: up to 2020 / 2021-25 |
| Units | 23 countries + Sichuan, Ember from about 2019 | 53 countries + 4 Brazil subsystems + 10 US states, more training years |
| Lags | applied | not applied |
| Crisis rule | P(any shortfall in the next 6 months) >= 0.64 | P(shortfall in the onset month) >= 0.40 |

Because the label and base rate differ, AUC-PR values cannot be compared directly. Compare the ratios against each baseline instead. The two back-tests agree on the main point: pooled water signals add little beyond recent generation (Patronus's ablations show the same).

## Reproduce
```bash
python3 -m pipeline.ext_fd_backtest   # data/reference/fd_backtest/ -> web/public/data/backtest_fd.json
```
To rerun the back-test from raw data, use the Future Detector repo:
1. `hydro/fetch_nasa.py`: IMERG, JPL, GRACE-DA and SMAP. This needs an Earthdata netrc.
2. `build_v2.py`
3. `run_v2.py`
4. `focus_v2.py`

Fetch URLs are listed in `data/reference/fd_backtest/v2_provenance.json`.
