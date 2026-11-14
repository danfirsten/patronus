"""Inputs for the in-browser Kariba release simulator -> web/public/data/kariba_sim.json

Run from the repo root:   python3 -m pipeline.kariba_sim

The browser replays the 'next' model's water balance (pipeline/kariba_ensemble.py) month by
month, Nov 2026 (remainder) .. Dec 2027:

    S[m+1] = min(S[m] + Q[Y, m] - R[m], capacity),   R[m] = min(target[m], max(S[m] + Q[Y, m], 0))

with Q[Y, m] the net inflow (inflow minus lake evaporation) of historical analog year Y
(kariba_ensemble.monthly_qnet: observed month-end storage change + the release assumed for
that year), target[m] = the announced allocation (36 BCM/yr in 2026, 23 BCM in 2027) times
(1 - cut) from the chosen month, and the first month pro-rated for the days left after the
latest satellite pass. Energy and cost follow pipeline/kariba_cost.py.

This file exports everything that maths needs, and checks that a pure-Python copy of the
browser maths (`browser_sim`, written exactly as KaribaSim.tsx does it) reproduces the
ensemble's end-2027 numbers in kariba.json with default settings.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from pipeline import kariba_cost as C
from pipeline import kariba_data as K
from pipeline import kariba_ensemble as E
from pipeline.paths import OUT

ISSUE = pd.Timestamp("2026-11-01")     # same issue month as kariba_ensemble.live()
HORIZON = 13                           # Dec 2026 .. Dec 2027 after the Nov remainder
CUT_START_MONTHS = ["2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"]


def phase_of(v: float) -> str:
    return E.outlook_phase(v)


def browser_sim(s0, frac0, q, plan, cap, cut=0.0, start_idx=None):
    """Exactly the arithmetic in KaribaSim.tsx (simulateYear). q, plan: 14 monthly values (BCM),
    index 0 = rest of Nov 2026 (both pro-rated by frac0 here). Returns month-end storage (BCM)
    for indices 1..13 (Dec 2026 .. Dec 2027) and the releases."""
    S = s0
    path, rel = [], []
    for i in range(len(q)):
        qi, pi = q[i], plan[i]
        if i == 0:
            qi, pi = qi * frac0, pi * frac0
        target = pi * (1 - cut) if (start_idx is not None and i >= start_idx) else pi
        r = min(target, max(S + qi, 0.0))
        S = min(S + qi - r, cap)
        rel.append(r)
        if i > 0:
            path.append(S)
    return path, rel


def main():
    lv = K.load_levels()
    qnet = E.monthly_qnet(lv)
    djf = K.oni_djf()

    # Reference: the ensemble exactly as kariba.py runs it
    res, summ = E.live(lv)
    candidates = res["candidates"]
    s0 = res["s0_bcm"]
    d0 = res["obs_date"]
    months = [ISSUE + pd.DateOffset(months=h) for h in range(HORIZON + 1)]
    frac0 = max((months[0] + pd.offsets.MonthEnd(0) - d0).days, 0) / months[0].days_in_month
    ys_issue = E.season_year(ISSUE)
    cap = float(K.USABLE_CAPACITY_BCM)
    plan_yr = [C.A["allocation_2026_bcm"] if m.year == 2026 else C.A["allocation_2027_bcm"] for m in months]
    plan = [p / 12 for p in plan_yr]

    years = []
    for Y in candidates:
        off = ys_issue - Y
        q = [float(qnet[m - pd.DateOffset(years=off)]) for m in months]
        oni = float(djf.get(Y, np.nan))
        years.append({"year": int(Y), "season": f"Nov {Y-1} – Dec {Y}", "oni_djf": round(oni, 2),
                      "phase": phase_of(oni), "qnet_bcm": [round(v, 5) for v in q],
                      "qnet_total_bcm": round(sum(q[1:]), 2)})
    pools = {
        "el_nino": [y["year"] for y in years if y["phase"] == "el_nino"],
        "la_nina": [y["year"] for y in years if y["phase"] == "la_nina"],
        "all": [y["year"] for y in years],
    }
    assert pools["el_nino"] == res["pool"], (pools["el_nino"], res["pool"])

    # ---------------- validation: browser maths vs the ensemble and vs kariba.json
    kj = json.loads((OUT / "kariba.json").read_text())
    nm = kj["forecast"]["next_model"]
    ref_members = {int(k): v for k, v in nm["members_dec_2027_pct"].items()}
    ref_dec = [m for m in nm["months"] if m["month"] == "2027-12"][0]
    ymap = {y["year"]: y for y in years}
    sim_end = {}
    sim_paths = {}
    for Y in pools["el_nino"]:
        p, _ = browser_sim(s0, frac0, ymap[Y]["qnet_bcm"], plan, cap)
        sim_paths[Y] = [v / cap * 100 for v in p]
        sim_end[Y] = sim_paths[Y][-1]
    ends = np.array(list(sim_end.values()))
    n_below = int(np.sum(ends < K.DANGER_PCT))
    n_ever = int(sum(1 for p in sim_paths.values() if min(p) < K.DANGER_PCT))
    max_diff_members = max(abs(sim_end[Y] - ref_members[Y]) for Y in sim_end)
    max_diff_paths = max(abs(a - b) for Y in sim_end for a, b in zip(sim_paths[Y], res["paths"][Y]))
    median_end = float(np.median(ends))
    ok = (n_below == round(ref_dec["p_below_danger"] * len(ends)) and abs(median_end - ref_dec["usable_p50"]) < 0.05
          and max_diff_members < 0.05)
    validation = {
        "passed": bool(ok),
        "settings": "El Niño analog years, no release cut, 36 BCM/yr for the rest of 2026, 23 BCM in 2027",
        "reference": "kariba.json -> forecast.next_model (months 2027-12 and members_dec_2027_pct)",
        "n_years": len(ends),
        "sim_median_dec_2027_pct": round(median_end, 2),
        "ref_median_dec_2027_pct": round(ref_dec["usable_p50"], 2),
        "sim_n_below_10_dec_2027": n_below,
        "ref_p_below_10_dec_2027": round(ref_dec["p_below_danger"], 4),
        "ref_n_below_10_dec_2027": int(round(ref_dec["p_below_danger"] * len(ends))),
        "sim_n_below_10_any_month_to_dec_2027": n_ever,
        "sim_n_below_20_dec_2027": int(np.sum(ends < K.WARNING_PCT)),
        "ref_p_below_20_dec_2027": round(ref_dec["p_below_warning"], 4),
        "max_abs_diff_member_dec_2027_pct_vs_kariba_json": round(max_diff_members, 4),
        "max_abs_diff_any_month_pct_vs_ensemble_rerun": round(max_diff_paths, 6),
        "sim_members_dec_2027_pct": {str(Y): round(v, 2) for Y, v in sim_end.items()},
    }
    print(f"[kariba_sim] validation: median {median_end:.2f}% (ref {ref_dec['usable_p50']:.2f}), "
          f"below 10% {n_below}/{len(ends)} (ref p={ref_dec['p_below_danger']:.4f}), "
          f"max member diff {max_diff_members:.4f} pp -> {'PASS' if ok else 'FAIL'}")

    # example outputs (cuts from January) for the report
    examples = {}
    jan = [m.strftime("%Y-%m") for m in months].index("2027-01")
    k_twh = C.A["energy_twh_per_bcm"]
    for cut in (0.0, 0.15, 0.30):
        ends_c, gen = [], []
        for Y in pools["el_nino"]:
            p, r = browser_sim(s0, frac0, ymap[Y]["qnet_bcm"], plan, cap, cut, jan)
            ends_c.append(p[-1] / cap * 100)
            gen.append(sum(r[1:]) * k_twh)
        ends_c = np.array(ends_c)
        examples[f"cut_{int(cut*100)}pct_from_2027_01"] = {
            "n_below_10_dec_2027": int(np.sum(ends_c < K.DANGER_PCT)), "n_years": len(ends_c),
            "median_dec_2027_pct": round(float(np.median(ends_c)), 1),
            "mean_generation_dec26_dec27_twh": round(float(np.mean(gen)), 2)}
    print(f"[kariba_sim] examples: {json.dumps(examples)}")

    curve_pts = K.storage_curve_points()
    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "about": ("Inputs for the Kariba release simulator. The browser replays each analog year's net inflow "
                  "through the same monthly water balance as the 'next' (El Niño) model and lets the user cut "
                  "releases. Illustrative, not an operating plan."),
        "model": __doc__.strip(),
        "issue_date": "2026-11-15",
        "start": {"date": d0.strftime("%Y-%m-%d"), "level_m": round(float(res["level0"]), 2),
                  "usable_bcm": round(s0, 4), "usable_pct": round(s0 / cap * 100, 2),
                  "first_month_fraction": round(frac0, 6),
                  "note": (f"Latest G-REALM satellite level {res['level0']:.2f} m on {d0:%d %b %Y}; the first step covers "
                           f"the remaining {round(frac0 * months[0].days_in_month)} days of November, pro-rated.")},
        "months": [m.strftime("%Y-%m") for m in months],
        "months_note": "Index 0 = rest of Nov 2026 (pro-rated by first_month_fraction); 1..13 = Dec 2026 .. Dec 2027.",
        "capacity_bcm": round(cap, 4),
        "storage_curve": {"a": round(K.CURVE_A, 6), "b": round(K.CURVE_B, 6), "min_operating_m": K.MIN_OP_M,
                          "max_operating_m": K.MAX_OP_M, "usable_capacity_bcm": round(cap, 4),
                          "formula": "usable_pct = a*x + b*x^2, x = level_m - min_operating_m; usable_bcm = usable_pct/100 * capacity",
                          "points": curve_pts},
        "thresholds": {"warning_usable_pct": K.WARNING_PCT, "danger_usable_pct": K.DANGER_PCT,
                       "warning_level_m": round(float(K.pct_to_level(K.WARNING_PCT)), 2),
                       "danger_level_m": round(float(K.pct_to_level(K.DANGER_PCT)), 2)},
        "releases": {"allocation_2026_bcm": C.A["allocation_2026_bcm"], "allocation_2027_bcm": C.A["allocation_2027_bcm"],
                     "remaining_2026_bcm": round(C.A["allocation_2026_bcm"] / 12 * (frac0 + 1), 3),
                     "monthly_plan_bcm": [round(p, 5) for p in plan],
                     "spread": "Evenly by month (ZRA publishes annual allocations, not monthly schedules).",
                     "source": "ZRA allocation for 2027: 23 BCM (11.5 BCM each for ZESCO and ZPC), cut from 36 BCM in 2026",
                     "source_url": "https://www.greenbuildingafrica.co.za/zambezi-river-authority-cuts-kariba-water-allocation-for-2027-power-generation/"},
        "cut": {"min_pct": 0, "max_pct": 40, "step_pct": 5, "start_months": CUT_START_MONTHS, "default_start": "2027-01"},
        "years": years,
        "pools": pools,
        "pool_labels": {"el_nino": "El Niño years (forecast)", "all": "All years", "la_nina": "La Niña years"},
        "pool_rule": "Rainy season tagged by its DJF ONI: El Niño >= +0.5, La Niña <= -0.5, otherwise neutral (NOAA CPC).",
        "enso_outlook": kj.get("enso_outlook"),
        "energy": {"twh_per_bcm": C.A["energy_twh_per_bcm"], "twh_per_bcm_range": C.A["energy_twh_per_bcm_range"],
                   "note": C.A["energy_conversion_note"]},
        "costs": {"contracted_usd_per_kwh": C.A["replacement_contracted_usd_per_kwh"],
                  "emergency_usd_per_kwh": C.A["replacement_emergency_usd_per_kwh"],
                  "voll_usd_per_kwh": C.A["voll_usd_per_kwh"], "voll_range_usd_per_kwh": C.A["voll_range_usd_per_kwh"],
                  "emergency_cap_gwh_per_month": C.A["emergency_cap_gwh_per_month"],
                  "rules": ("Energy deliberately cut is replaced by imports contracted in advance (contracted price) if the "
                            "imports toggle is on, otherwise bought as emergency power up to the monthly cap; energy lost "
                            "because the lake hits the minimum operating level is bought as emergency power within whatever "
                            "cap is left; anything beyond the cap is unserved and priced at the value of lost load."),
                  "source": C.A["source"], "cap_note": C.A["emergency_cap_note"]},
        "sources": [
            {"what": "Lake level", "text": "G-REALM satellite altimetry (NASA/USDA), 10-day Kariba series, 1992-2026"},
            {"what": "Storage curve", "text": "Quadratic fitted to ZRA level/storage pairs", "url": "https://www.zambezira.org/hydrology/lake-levels"},
            {"what": "ENSO", "text": "NOAA CPC Oceanic Niño Index (DJF)", "url": "https://origin.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php"},
            {"what": "Releases", "text": "ZRA 2027 allocation (23 BCM)", "url": "https://www.greenbuildingafrica.co.za/zambezi-river-authority-cuts-kariba-water-allocation-for-2027-power-generation/"},
            {"what": "Prices", "text": "ZESCO ERB tariff application, Jul 2024; VoLL from developing-country literature",
             "url": "https://www.erb.org.zm/wp-content/uploads/files/ZESCO-Tarrif-Application-Submission.pdf"},
        ],
        "honesty": [
            "Analog years are history: each line replays the net inflow of a real past year, not a forecast of the exact rain in 2027.",
            "Past releases are not published monthly; inflows are backed out assuming 30 BCM/yr (16 BCM in 2024).",
            "Cutting releases means less hydropower now; the simulator shows that trade-off in TWh and in illustrative dollars.",
            "Illustrative, not an operating plan. ZRA and the utilities decide releases with information we do not have.",
        ],
        "validation": validation,
        "examples": examples,
    }
    path = OUT / "kariba_sim.json"
    path.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(f"[kariba_sim] wrote {path} ({path.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()
