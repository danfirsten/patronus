"""Cost of waiting at Lake Kariba: a deliberately simple monthly water balance.

    S[m+1] = S[m] + Q_net[m] - R[m]          (usable storage, BCM; floor 0 = 475.5 m)

Q_net (inflow minus lake evaporation) scenarios come from real historical years:
    Q_net[Y, m] = dS_observed[Y, m] + R_hist[Y] / 12
where dS_observed is the change in month-end usable storage from G-REALM levels through the
fitted storage curve and R_hist is the turbine release assumed for that historical year.

Policies compared (all start from the latest satellite level, 2026-11-09):
  * act_m      : from month m, cut releases to the conservation rate and replace the energy
                 with imports contracted in advance (17 c/kWh)
  * wait_warn  : run the plan until month-end storage falls below 20 %, then cut releases and
                 replace the energy at emergency prices (26 c/kWh)
  * no_action  : run the plan; only the floor stops it
Whenever the lake hits the minimum operating level, releases are limited to what flows in;
the lost energy is bought at emergency prices up to the emergency-procurement cap, and the
rest is unserved and priced at VoLL. Water left in the lake at the end of 2027 relative to
`no_action` is credited at the contracted import price (it displaces 2028 imports).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline import kariba_data as K

A = {
    "replacement_contracted_usd_per_kwh": 0.17,   # Eskom imports, ZESCO ERB filing Jul 2024
    "replacement_emergency_usd_per_kwh": 0.26,    # inland diesel rental, same filing
    "replacement_blended_usd_per_kwh": 0.2323,    # same filing, for reference
    "voll_usd_per_kwh": 1.0, "voll_range_usd_per_kwh": [0.5, 1.5],
    "source": "ZESCO ERB tariff application Jul 2024 (https://www.erb.org.zm/wp-content/uploads/files/ZESCO-Tarrif-Application-Submission.pdf); VoLL from developing-country literature (Vietnam 2023 implies $1.56/kWh)",
    "energy_twh_per_bcm": 0.22,
    "energy_twh_per_bcm_range": [0.19, 0.25],
    "energy_conversion_note": ("Physics: E = rho*g*H*eta*V = 2.45 GWh per BCM per metre of head at eta=0.9; "
                               "Kariba's net head is roughly 80-100 m depending on lake level -> 0.19-0.25 TWh/BCM, "
                               "central 0.22. Cross-check: ~10 TWh/yr reported for both stations at the "
                               "pre-drought allocations of ~45 BCM gives ~0.22 TWh/BCM. We could not source the "
                               "0.4-0.5 TWh/BCM figure and it is physically implausible at Kariba's head, so it is not used. "
                               "Both banks combined; head loss as the lake falls is ignored."),
    "allocation_2026_bcm": 36.0, "allocation_2027_bcm": 23.0,
    "conservation_release_bcm_per_yr": 16.0,
    "conservation_note": "Conservation rate = ZRA's crisis allocation for 2024 (16 BCM/yr, cut on 28 Dec 2023).",
    "historical_release_bcm_per_yr": 30.0,
    "historical_release_overrides_bcm": {"2024": 16.0},
    "historical_release_note": ("Releases in scenario years are not published as a monthly series; we assume 30 BCM/yr "
                                "spread evenly (a typical recent ZRA allocation: 2024 pre-cut and 2026 initial), and 16 BCM "
                                "for 2024. Where true releases were lower (drought years), this overstates the inflow, so "
                                "costs are if anything understated."),
    "emergency_cap_gwh_per_month": 218.0,
    "emergency_cap_note": "Emergency procurement capped at 300 MW (218 GWh/month), the replacement block costed in ZESCO's 2024 filing ($51M/month).",
    "terminal_credit": "Storage left at end-2027 above the no-action path is credited at the contracted price (it displaces 2028 imports).",
    "start": "Latest G-REALM level 479.92 m on 2026-11-09; scenario Nov change is pro-rated for the remaining 21 days.",
    "scenario_years": "Hydrological years Dec(Y-1)..Dec(Y) with DJF ONI >= 0.5 (El Nino); 'all years' shown for comparison.",
    "scope": "Both utilities (ZESCO and ZPC) and both banks; prices are Zambian (ZESCO) and are applied to both.",
}

MONTHS = pd.period_range("2026-12", "2027-12", freq="M")


def storage_month_end(levels):
    me = K.month_end_level(levels)
    return pd.Series(K.pct_to_bcm(K.level_to_pct(me)), index=me.index)


def scenario_inflows(levels, years, r_hist=None):
    """Monthly Q_net (BCM) for the window Nov(Y-1) .. Dec(Y): 14 values per year."""
    r_hist = r_hist or A["historical_release_bcm_per_yr"]
    S = storage_month_end(levels)
    dS = S.diff()
    out = {}
    for Y in years:
        idx = pd.date_range(f"{Y-1}-11-01", f"{Y}-12-01", freq="MS")
        if not all(i in dS.index and not np.isnan(dS[i]) for i in idx):
            continue
        rel = {}
        for i in idx:
            r = A["historical_release_overrides_bcm"].get(str(i.year), r_hist)
            rel[i] = r / 12.0
        out[Y] = np.array([dS[i] + rel[i] for i in idx])
    return out


def simulate(q, policy, act_idx=None, s0=None, k=None, voll=None, c_con=None, c_em=None):
    """One scenario, one policy. q: 14 monthly Q_net values (Nov-remainder, Dec 2026, Jan..Dec 2027).
    Returns dict with cost (USD M) components and the storage path."""
    k = k or A["energy_twh_per_bcm"]
    voll = A["voll_usd_per_kwh"] if voll is None else voll
    c_con = c_con or A["replacement_contracted_usd_per_kwh"]
    c_em = c_em or A["replacement_emergency_usd_per_kwh"]
    gwh_per_bcm = k * 1000
    cap = A["emergency_cap_gwh_per_month"]
    S = s0
    frac0 = 21 / 30
    plan = [A["allocation_2026_bcm"] / 12 * frac0, A["allocation_2026_bcm"] / 12] + [A["allocation_2027_bcm"] / 12] * 12
    q = np.array(q, dtype=float).copy()
    q[0] *= frac0
    cons = A["conservation_release_bcm_per_yr"] / 12
    path, cost_con, cost_em, cost_unserved, unserved_gwh = [], 0.0, 0.0, 0.0, 0.0
    triggered = policy == "act" and act_idx == 0
    for i in range(14):
        # month index i: 0 = rest of Nov 2026, 1 = Dec 2026, 2.. = Jan..Dec 2027
        if policy == "act" and act_idx is not None and i >= act_idx:
            target, price = min(cons * (frac0 if i == 0 else 1), plan[i]), c_con
        elif policy == "wait" and triggered:
            target, price = min(cons, plan[i]), c_em
        else:
            target, price = plan[i], None
        planned_cut = plan[i] - target
        release = min(target, max(S + q[i], 0.0))
        forced_cut = target - release
        S = S + q[i] - release
        # planned cut: replaced at the policy's price (contracted, or emergency once waiting triggered)
        e_plan = planned_cut * gwh_per_bcm
        e_forced = forced_cut * gwh_per_bcm
        if price is not None:
            if price == c_con:
                cost_con += e_plan * c_con
                room = cap
            else:
                cost_em += min(e_plan, cap) * c_em
                cost_unserved += max(e_plan - cap, 0) * voll
                unserved_gwh += max(e_plan - cap, 0)
                room = max(cap - e_plan, 0)
        else:
            room = cap
        em = min(e_forced, room)
        cost_em += em * c_em
        cost_unserved += (e_forced - em) * voll
        unserved_gwh += e_forced - em
        path.append(S)
        if policy == "wait" and not triggered and i >= 1 and K.bcm_to_pct(S) < K.WARNING_PCT:
            triggered = True
    # GWh * $/kWh = $M
    return {"cost_contracted": cost_con, "cost_emergency": cost_em, "cost_unserved": cost_unserved,
            "unserved_gwh": unserved_gwh, "s_end": S, "path": path}


def run(levels, enso_years, all_years, voll=None, k=None, r_hist=None):
    lv0 = levels.iloc[-1]
    s0 = float(K.pct_to_bcm(K.level_to_pct(lv0["level_m"])))
    k = k or A["energy_twh_per_bcm"]
    sets = {"el_nino": scenario_inflows(levels, enso_years, r_hist),
            "all_years": scenario_inflows(levels, all_years, r_hist)}
    gwh = k * 1000
    out = {}
    for name, sc in sets.items():
        years = sorted(sc)
        base = {Y: simulate(sc[Y], "none", s0=s0, k=k, voll=voll) for Y in years}

        def total(r, Y):
            credit = (r["s_end"] - base[Y]["s_end"]) * gwh * A["replacement_contracted_usd_per_kwh"]
            return r["cost_contracted"] + r["cost_emergency"] + r["cost_unserved"] - credit

        pol = {}
        for j, mth in enumerate(MONTHS):
            pol[str(mth)] = {Y: total(simulate(sc[Y], "act", act_idx=j + 1, s0=s0, k=k, voll=voll), Y) for Y in years}
        pol["wait_warning"] = {Y: total(simulate(sc[Y], "wait", s0=s0, k=k, voll=voll), Y) for Y in years}
        pol["no_action"] = {Y: total(base[Y], Y) for Y in years}
        out[name] = {"years": years, "costs": pol, "base": base,
                     "end_pct_no_action": {Y: float(K.bcm_to_pct(base[Y]["s_end"])) for Y in years},
                     "s0_bcm": s0}
    return out


def summarize(res):
    def q(vals):
        v = np.array(list(vals))
        return (round(float(np.quantile(v, .1)), 1), round(float(np.quantile(v, .5)), 1),
                round(float(np.quantile(v, .9)), 1), round(float(v.mean()), 1))
    curve = []
    for key, vals in res["costs"].items():
        p10, p50, p90, mean = q(vals.values())
        curve.append({"action_month": key if key[0].isdigit() else None, "policy": key if not key[0].isdigit() else "act_in_month",
                      "expected_cost_musd_p10": p10, "expected_cost_musd_p50": p50, "expected_cost_musd_p90": p90,
                      "expected_cost_musd_mean": mean,
                      "by_year_musd": {str(Y): round(float(v), 1) for Y, v in vals.items()}})
    return curve
