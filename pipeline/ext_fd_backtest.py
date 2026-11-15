"""Future Detector back-test v2 -> web/public/data/backtest_fd.json.

An external, independent back-test of the same question Patronus asks (will hydro output fall
into shortfall 1-6 months ahead?), run in the Future Detector repo (hydro/run_v2.py, focus_v2.py).
Its outputs are copied into data/reference/fd_backtest/ so this script runs offline:

    python3 -m pipeline.ext_fd_backtest

It only reads data/reference/fd_backtest/ and writes web/public/data/backtest_fd.json.
It does not touch any other Patronus output. See docs/BACKTEST-FD.md.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone

from pipeline.paths import OUT, REFERENCE

SRC = REFERENCE.parent / "fd_backtest"  # data/reference/fd_backtest (not under forecast/)

# Long model names in the FD outputs -> short keys used in backtest_fd.json.
MODELS = {
    "climatology (country x calendar month)": "climatology",
    "persistence (shortfall last month)": "persistence",
    "hydro history only": "hydro_history",
    "signals v1 only": "signals_v1",
    "signals v2 only": "signals_v2",
    "hydro + storage": "hydro_storage",
    "full v1 (v1 signals + hydro)": "full_v1",
    "full v2 (v2 signals + hydro)": "full_v2",
}
GROUPS = {
    "all generation units": "all",
    "units with >= 5 training years": "ge5_train_years",
    "units with observed reservoir storage (BRA, BRA_*, CHN, USA, US_WA)": "storage_observed",
    "Brazil subsystems": "brazil_subsystems",
    "US states": "us_states",
}
BRAZIL_MODELS = {
    "climatology": "climatology",
    "persistence": "persistence",
    "hydro history only": "hydro_history",
    "hydro + EAR/ENA": "hydro_ear_ena",
    "hydro + EAR/ENA + GRACE": "hydro_ear_ena_grace",
    "EAR/ENA + rain/soil/GRACE, no hydro": "ear_ena_signals_no_hydro",
}
LEADS = [str(h) for h in range(1, 7)]


def _clean(x, nd=3):
    """Round floats; NaN/inf -> None (contract: null, never NaN)."""
    if isinstance(x, float):
        return None if (math.isnan(x) or math.isinf(x)) else round(x, nd)
    if isinstance(x, dict):
        return {k: _clean(v, nd) for k, v in x.items()}
    if isinstance(x, list):
        return [_clean(v, nd) for v in x]
    return x


def _short(name: str, table: dict) -> str:
    return table.get(name, name)


def _boot(b: dict) -> dict:
    return {"auc_pr_ratio": b["ratio"], "ratio_ci90": [b["lo90"], b["hi90"]],
            "brier_gain_ci90": [b.get("brier_gain_lo90"), b.get("brier_gain_hi90")]}


def _boot_key(k: str, table: dict) -> str:
    a, b = k.split(" vs ")
    return f"{_short(a, table)}__vs__{_short(b, table)}"


def _by_horizon(res: dict) -> dict:
    out = {}
    for gname, gkey in GROUPS.items():
        rows = []
        for h in LEADS:
            g = res[h].get(gname)
            if g is None:
                continue
            rows.append({
                "horizon": int(h), "n": g["n"], "n_shortfalls": g["pos"], "base_rate": g["base"],
                "n_units": g.get("units"),
                "auc_pr": {_short(m, MODELS): v["auc_pr"] for m, v in g["m"].items()},
                "brier_skill_vs_climatology": {_short(m, MODELS): v["bss"] for m, v in g["m"].items()},
                "bootstrap": {_boot_key(k, MODELS): _boot(v) for k, v in g["boot"].items()},
            })
        out[gkey] = rows
    return out


def _crises(crises: list) -> list:
    rows = []
    for c in crises:
        p = {_short(k[2:-1], MODELS): {h: c[k].get(h) for h in LEADS}
             for k in c if k.startswith("P[")}
        lead = {_short(k[5:-1], MODELS): c[k] for k in c if k.startswith("lead[")}
        rows.append({
            "crisis": c["crisis"], "unit": c["unit"], "window": c["window"], "onset_month": c.get("onset"),
            "shortfall_months": c["short_months"],
            "already_short_month_before_onset": c.get("already_short_month_before_onset"),
            "note": c.get("note"),
            "p_onset_by_lead": p,
            "lead_months_p_ge_0_4": lead,
        })
    return rows


def _brazil(focus: dict, label: str) -> list:
    rows = []
    for h in LEADS:
        g = focus["brazil_storage"][label][h]
        rows.append({
            "horizon": int(h), "n": g["n"], "n_shortfalls": g["pos"],
            "auc_pr": {_short(m, BRAZIL_MODELS): v["auc_pr"] for m, v in g["m"].items()},
            "brier_skill_vs_climatology": {_short(m, BRAZIL_MODELS): v["bss"] for m, v in g["m"].items()},
            "bootstrap": {_boot_key(k, BRAZIL_MODELS): _boot(v) for k, v in g["boot"].items()},
        })
    return rows


def main() -> None:
    res = json.loads((SRC / "v2_results.json").read_text())
    focus = json.loads((SRC / "v2_focus.json").read_text())
    prov = json.loads((SRC / "v2_provenance.json").read_text())

    allu = res["short"]["res"]
    b = {h: allu[h]["all generation units"]["boot"] for h in ("1", "3", "6")}
    bz = {h: focus["brazil_storage"]["short"][h]["boot"]["hydro + EAR/ENA vs hydro history only"] for h in LEADS}
    se = next(c for c in res["short"]["crises"] if c["unit"] == "BRA_SE")["P[signals v2 only]"]
    kar = focus["kariba"]["signals_v1_only_P_by_target_and_lead"]["2024-04"]

    def r(x):
        return round(x, 2)

    fv = "full v2 (v2 signals + hydro)"
    headline = [
        {"id": "skill_vs_climatology",
         "text": f"Best model ranks shortfall months x{r(b['1'][fv + ' vs climatology (country x calendar month)']['ratio'])} better than "
                 f"climatology at 1 month, x{r(b['3'][fv + ' vs climatology (country x calendar month)']['ratio'])} at 3 and "
                 f"x{r(b['6'][fv + ' vs climatology (country x calendar month)']['ratio'])} at 6 (AUC-PR ratio; 90% block-bootstrap intervals above 1).",
         "values": {h: _boot(b[h][fv + " vs climatology (country x calendar month)"]) for h in b}},
        {"id": "skill_vs_persistence",
         "text": "x1.14-1.26 better than persistence at 1-6 months (all 90% intervals above 1).",
         "values": {h: _boot(b[h][fv + " vs persistence (shortfall last month)"]) for h in b}},
        {"id": "water_signals_pooled",
         "text": "Pooled across 67 units, water signals add nothing beyond recent generation: full v2 / hydro history "
                 "x1.01 at 1 month, x0.98 at 3, x0.92 at 6.",
         "values": {h: _boot(b[h][fv + " vs hydro history only"]) for h in b}},
        {"id": "brazil_storage",
         "text": f"Where storage is observed (Brazil, ONS EAR/ENA, 5 units) it helps: x{r(min(v['ratio'] for v in bz.values()))}-"
                 f"x{r(max(v['ratio'] for v in bz.values()))} over hydro history at 1-6 months (intervals above 1). "
                 "Brief's label only; Brier skill negative from 3 months.",
         "values": {h: _boot(v) for h, v in bz.items()}},
        {"id": "crisis_leads",
         "text": f"Brazil SE/CO 2021 (onset 2021-07) flagged 3 months ahead by the signals-only model (P {r(se['3'])} / {r(se['2'])} / {r(se['1'])} "
                 f"at 3/2/1 months; climatology 0.19). Kariba April 2024 record-low level: P {kar['4']} / {kar['3']} at 4/3 months "
                 "from rain/soil/GRACE/ENSO alone. Missed: Sichuan 2022, Vietnam 2023, Ecuador 2024 (full model), Brazil national.",
         "values": {"brazil_se_2021_signals_v2": se, "kariba_2024_04_signals_v1_no_level": kar}},
    ]

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": ["ember_monthly", "ember_yearly", "ons", "grealm", "oni", "gpcp"],
        "sources_not_in_meta": [
            {"id": "eia_bulk", "name": "EIA Electricity bulk file (ELEC.GEN.HYC-<ST>-99.M)", "url": prov.get("eia")},
            {"id": "gpm_imerg", "name": "GPM IMERG V07 monthly (NASA)", "url": prov.get("imerg")},
            {"id": "grace_jpl", "name": "JPL GRACE/GRACE-FO RL06.3 mascons (NASA PO.DAAC)", "url": prov.get("jpl_mascons")},
            {"id": "grace_csr", "name": "CSR GRACE/GRACE-FO RL06.3 mascons", "url": prov.get("grace")},
            {"id": "grace_da", "name": "GRACE-DA root zone / groundwater percentiles (NASA)", "url": prov.get("grace_da")},
            {"id": "smap_l4", "name": "SMAP L4 root-zone soil moisture (NASA)", "url": prov.get("smap")},
            {"id": "cpc_soil", "name": "NOAA CPC soil moisture v2", "url": prov.get("cpc_soil")},
        ],
        "origin": "Future Detector hydro back-test v2 (hydro/run_v2.py, focus_v2.py), run 2026-11-14; "
                  "raw outputs copied to data/reference/fd_backtest/. Independent of the Patronus generation and Kariba models.",
        "design": "Train on target months <= 2020, test 2021-01..2025-12 (one split, no CV). Learner picked on a 2018-2020 "
                  "validation split (logistic regression won for every model). Pooled across units. Features from hand-drawn "
                  "catchment boxes. No publication-lag adjustment (month t assumed known at end of t). Uncalibrated "
                  "probabilities. Metrics: AUC-PR and Brier skill vs climatology; 300 block-bootstrap resamples over test months, "
                  "90% intervals. Crisis lead = longest lead with P >= 0.40.",
        "labels": {
            "short": "Monthly hydro value below the 20th percentile of the same calendar month over training years <= 2020 "
                     "(the 'brief's label'; main view).",
            "short_adj": "Value / median of same calendar month in the previous 5 years, shortfall when below the unit's "
                         "training 20th percentile (capacity-corrected second view; absorbs multi-year droughts).",
        },
        "units": {"n_generation_units": 67, "countries": 53, "brazil_subsystems": ["BRA_SE", "BRA_S", "BRA_NE", "BRA_N"],
                  "us_states": ["US_WA", "US_CA", "US_NY", "US_OR", "US_AL", "US_ID", "US_TN", "US_MT", "US_SD", "US_AZ"],
                  "storage_label_units": ["ZMB_KAR"],
                  "kariba_label": "G-REALM 10-day altimetry, lake 000394, monthly mean level (storage, not generation)"},
        "models": {
            "climatology": "unit x calendar-month shortfall rate in training",
            "persistence": "shortfall last month",
            "hydro_history": "logistic on recent hydro anomalies only",
            "signals_v1": "GPCP rain, CPC soil, CSR GRACE, ONI (no hydro history)",
            "signals_v2": "IMERG, JPL+CSR GRACE detrended, GRACE-DA, SMAP, reservoir storage, ONI (no hydro history)",
            "hydro_storage": "hydro history + observed reservoir storage (ONS EAR/ENA, G-REALM levels)",
            "full_v1": "hydro history + signals v1",
            "full_v2": "hydro history + signals v2",
        },
        "headline": headline,
        "by_horizon": {"short": _by_horizon(res["short"]["res"]), "short_adj": _by_horizon(res["short_adj"]["res"])},
        "brazil_storage_focus": {
            "units": ["BRA", "BRA_SE", "BRA_S", "BRA_NE", "BRA_N"],
            "short": _brazil(focus, "short"), "short_adj": _brazil(focus, "short_adj"),
            "bra_se_2021_p_by_issue": {_short(k, BRAZIL_MODELS): v for k, v in focus["brazil_storage"]["short"]["1"]["BRA_SE_2021"].items()},
        },
        "crises": {"short": _crises(res["short"]["crises"]), "short_adj": _crises(res["short_adj"]["crises"])},
        "kariba_strict": {
            "definition": "Signals-v1-only model (no lake-level input), P(level below calendar-month p20) by target month and lead. "
                          "Record-low months = below the 1993-2020 calendar-month minimum.",
            "start_of_last_p20_spell": focus["kariba"]["start_of_last_p20_spell"],
            "record_low_months_2021_on": focus["kariba"]["record_low_months_2021_on"],
            "p_by_target_and_lead": focus["kariba"]["signals_v1_only_P_by_target_and_lead"],
        },
        "comparison_with_patronus": [
            "Label: Patronus uses capacity factor >= 15% below an expanding same-month median (base rate 16%); FD uses below the "
            "training-period 20th percentile of raw generation (test base rate 29%). AUC-PR values are not comparable across the two.",
            "Split: Patronus uses blocked leave-one-year-out CV (12-month gap) plus a forward test from 2024; FD uses one split "
            "(train <= 2020, test 2021-2025).",
            "Units: Patronus = 23 Ember-monthly countries + Sichuan; FD = 53 countries + 4 Brazil ONS subsystems + 10 US states (EIA), "
            "with Ember data back to 2000 where available, so more training years.",
            "Crisis rule: Patronus alarm = P(any shortfall in next 6 months) >= 0.64 (tuned to <= 1 false alarm per country per 5 years); "
            "FD lead = P(shortfall in the onset month) >= 0.40 at each lead.",
            "Latency: Patronus applies publication lags (Ember t-2, GRACE t-3); FD does not, so FD leads are optimistic by 1-3 months.",
            "Kariba: both use G-REALM levels. Patronus forecasts usable % (warning < 20%) with a forward rolling test; FD scores a "
            "below-p20 level label, which was already true from 2022-03, so FD's 6-month Kariba 'lead' is persistence.",
        ],
        "limitations": [
            "Probabilities are uncalibrated; Brier skill turns negative at 4-6 months on several subsets.",
            "No data-latency adjustment.",
            "22 of 67 units have < 5 training years, so thresholds are thin.",
            "Test period is drier than training (29% vs 21% shortfalls).",
            "Brazil storage result rests on 5 correlated units (SIN is the sum of the 4 subsystems) and several comparisons on one test period.",
            "China provincial (Sichuan) data could not be obtained (data.stats.gov.cn HTTP 403); CHN is national.",
            "Catchment boxes are hand-drawn.",
        ],
        "notes": [
            "Ratios are AUC-PR(model A) / AUC-PR(model B); ci90 from 300 block-bootstrap resamples over test months.",
            "Keys in by_horizon.bootstrap are '<model>__vs__<model>' with short model ids from 'models'.",
            "This file is additive; nothing else in Patronus reads it yet.",
        ],
    }
    path = OUT / "backtest_fd.json"
    path.write_text(json.dumps(_clean(out), indent=1, allow_nan=False))
    print(f"wrote {path} ({path.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
