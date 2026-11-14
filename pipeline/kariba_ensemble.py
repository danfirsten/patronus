"""'Next' model (6-18 months): ENSO-conditioned water-balance ensemble for Lake Kariba.

    S[m+1] = S[m] + Q_net[Ys, m] - R[m]      usable storage (BCM), month-end

  * Start: the latest satellite level before the issue date (15th of the issue month).
  * Q_net (inflow minus lake evaporation) of historical year Ys = observed month-end storage
    change + the release assumed for that year (kariba_cost.A: 30 BCM/yr, 16 BCM in 2024).
    This "corrects the historical storage changes for the release regime".
  * Scenario years are chosen by the ENSO outlook at issue: El Nino outlook -> rainy seasons
    with DJF ONI >= 0.5; La Nina -> DJF <= -0.5; neutral -> |DJF| < 0.5 (equal weights).
    Backtests have no archived ENSO forecasts, so the outlook is proxied by the ONI season
    ending the month before issue (in Oct-Dec an El Nino is normally already established).
  * Releases: the announced allocation when known (live: 36 BCM/yr for the rest of 2026,
    23 BCM/yr in 2027); in backtests a typical 30 BCM/yr, because historical allocations
    were not announced until late December.
  * The lake cannot release below the minimum operating level (release limited to what is
    there) and spills above full supply level.
Only scenario years whose whole sequence was observed before the issue date are used.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline import kariba_cost as C
from pipeline import kariba_data as K

MIN_POOL = 3


def monthly_qnet(levels: pd.DataFrame) -> pd.Series:
    """Net inflow (BCM/month) for every month with a month-end storage change."""
    S = C.storage_month_end(levels)
    dS = S.diff()
    rel = pd.Series([C.A["historical_release_overrides_bcm"].get(str(i.year), C.A["historical_release_bcm_per_yr"]) / 12
                     for i in dS.index], index=dS.index)
    return (dS + rel).dropna()


def season_year(t: pd.Timestamp) -> int:
    """Rainy season label = year of its Jan-Mar (issues from July onward look at next year's season)."""
    return t.year + 1 if t.month >= 7 else t.year


def outlook_phase(oni_value: float) -> str:
    if np.isnan(oni_value):
        return "neutral"
    return "el_nino" if oni_value >= 0.5 else ("la_nina" if oni_value <= -0.5 else "neutral")


def pick_pool(phase: str, candidates: list[int], djf: pd.Series):
    def cls(y):
        v = djf.get(y, np.nan)
        return outlook_phase(v)
    pool = [y for y in candidates if cls(y) == phase]
    if len(pool) < MIN_POOL:
        return candidates, f"only {len(pool)} {phase} analog years available; used all {len(candidates)} years"
    return pool, None


def run_ensemble(issue: pd.Timestamp, levels: pd.DataFrame, qnet: pd.Series, horizon: int,
                 release_bcm_per_yr, phase: str | None = None, oni_value: float | None = None,
                 pool_override: list[int] | None = None):
    """Ensemble forecast of month-end usable % for months issue+1 .. issue+horizon.

    release_bcm_per_yr: callable(month Timestamp) -> annual release rate for that month.
    Returns dict with months, member paths (by scenario year) and the pool used.
    """
    issue_day = issue + pd.Timedelta(days=14)
    obs = levels[levels["date"] <= issue_day]
    d0, l0 = obs["date"].iloc[-1], obs["level_m"].iloc[-1]
    s0 = float(K.pct_to_bcm(K.level_to_pct(l0)))
    last_obs_month = (d0.to_period("M") - 1).to_timestamp()   # last complete month-end before d0
    djf = K.oni_djf()
    if phase is None:
        phase = outlook_phase(oni_value)
    ys_issue = season_year(issue)
    months = [issue + pd.DateOffset(months=h) for h in range(0, horizon + 1)]  # month 0 = rest of issue month
    candidates = []
    for Ys in range(1994, ys_issue):
        off = ys_issue - Ys
        need = [m - pd.DateOffset(years=off) for m in months]
        if need[-1] <= last_obs_month and all(n in qnet.index for n in need):
            candidates.append(Ys)
    if pool_override is not None:
        pool, note = [y for y in pool_override if y in candidates], None
    else:
        pool, note = pick_pool(phase, candidates, djf)
    frac0 = max((months[0] + pd.offsets.MonthEnd(0) - d0).days, 0) / months[0].days_in_month
    cap = K.USABLE_CAPACITY_BCM
    paths = {}
    for Ys in pool:
        off = ys_issue - Ys
        S = s0
        path = []
        for i, m in enumerate(months):
            q = qnet[m - pd.DateOffset(years=off)]
            r = release_bcm_per_yr(m) / 12
            if i == 0:
                q, r = q * frac0, r * frac0
            rel = min(r, max(S + q, 0.0))
            S = min(S + q - rel, cap)          # spill above full supply level
            if i > 0:
                path.append(float(K.bcm_to_pct(S)))
        paths[Ys] = path
    return {"issue": issue, "obs_date": d0, "level0": l0, "s0_bcm": s0, "phase": phase, "pool": pool,
            "pool_note": note, "candidates": candidates,
            "months": [m.strftime("%Y-%m") for m in months[1:]], "paths": paths}


def summarize_paths(res):
    P = np.array([res["paths"][y] for y in res["pool"]])  # members x months
    out = []
    for j, m in enumerate(res["months"]):
        v = P[:, j]
        out.append({"month": m, "usable_p10": float(np.quantile(v, .1)), "usable_p50": float(np.quantile(v, .5)),
                    "usable_p90": float(np.quantile(v, .9)),
                    "p_below_warning": float(np.mean(v < K.WARNING_PCT)),
                    "p_below_danger": float(np.mean(v < K.DANGER_PCT)),
                    "n_members": int(len(v))})
    return out


# --------------------------------------------------------------------------------------
# Backtest: Oct/Nov/Dec issues of every year, events judged on Apr-Dec of the next year
# --------------------------------------------------------------------------------------
def backtest(levels, mon, X):
    qnet = monthly_qnet(levels)
    djf = K.oni_djf()
    rows = []
    for Y0 in range(1995, 2026):
        for mth in (10, 11, 12):
            t = pd.Timestamp(Y0, mth, 1)
            H = 12 + (12 - mth)          # through Dec of Y0+1
            oni_t = float(X.loc[t, "oni"]) if t in X.index else np.nan
            res = run_ensemble(t, levels, qnet, H, lambda m: C.A["historical_release_bcm_per_yr"], oni_value=oni_t)
            summ = summarize_paths(res)
            win = [s for s in summ if f"{Y0+1}-04" <= s["month"] <= f"{Y0+1}-12"]
            obs = mon.loc[f"{Y0+1}-04-01":f"{Y0+1}-12-01", "usable_pct"]
            obs = obs[obs.index <= pd.Timestamp("2026-10-01")]
            rows.append({"issue": t.strftime("%Y-%m"), "season": Y0 + 1, "oni_at_issue": oni_t,
                         "outlook": res["phase"], "djf_oni_observed": float(djf.get(Y0 + 1, np.nan)),
                         "n_members": len(res["pool"]), "pool_note": res["pool_note"],
                         "usable_now_pct": float(K.level_to_pct(res["level0"])),
                         "p_warning": max(s["p_below_warning"] for s in win),
                         "p_danger": max(s["p_below_danger"] for s in win),
                         "p50_min_apr_dec": min(s["usable_p50"] for s in win),
                         "obs_min_apr_dec": float(obs.min()) if len(obs) else None,
                         "obs_complete": len(obs) == 9})
    return pd.DataFrame(rows)


def score(bt: pd.DataFrame, ml_preds: pd.DataFrame | None = None):
    """Per-season hit / miss / false alarm for the warning and danger events (alarm = any of
    the Oct-Dec issues with p > 0.5), split by observed El Nino seasons (DJF ONI >= 0.5)."""
    out = {}
    seasons = []
    for s, g in bt.groupby("season"):
        g = g.sort_values("issue")
        if g["obs_min_apr_dec"].isna().all() or not g["obs_complete"].iloc[0]:
            continue
        rec = {"season": int(s), "el_nino": bool(g["djf_oni_observed"].iloc[0] >= 0.5),
               "obs_min_apr_dec_pct": g["obs_min_apr_dec"].iloc[0]}
        for ev, col, thr in (("warning", "p_warning", K.WARNING_PCT), ("danger", "p_danger", K.DANGER_PCT)):
            alarm = bool((g[col] > 0.5).any())
            first = g.loc[g[col] > 0.5, "issue"].min() if alarm else None
            event = bool(rec["obs_min_apr_dec_pct"] < thr)
            rec[f"{ev}_ensemble_p_oct_nov_dec"] = [round(float(v), 2) for v in g[col]]
            rec[f"{ev}_ensemble_alarm"] = alarm
            rec[f"{ev}_ensemble_first_alarm"] = first
            rec[f"{ev}_event"] = event
            rec[f"{ev}_ensemble_outcome"] = ("hit" if alarm and event else "miss" if event else
                                             "false_alarm" if alarm else "correct_quiet")
            if ml_preds is not None and s >= 2006:
                m = ml_preds[(ml_preds["issue"] >= f"{s-1}-10-01") & (ml_preds["issue"] <= f"{s-1}-12-01") &
                             (ml_preds["target_month"] >= f"{s}-04-01") & (ml_preds["target_month"] <= f"{s}-12-01")]
                mc = "m_pw" if ev == "warning" else "m_pd"
                if len(m):
                    pm = m.groupby("issue")[mc].max()
                    a = bool((pm > 0.5).any())
                    rec[f"{ev}_ml_p_oct_nov_dec"] = [round(float(v), 2) for v in pm.values]
                    rec[f"{ev}_ml_outcome"] = ("hit" if a and event else "miss" if event else
                                               "false_alarm" if a else "correct_quiet")
        seasons.append(rec)
    df = pd.DataFrame(seasons)

    def tally(sub, col):
        vc = sub[col].value_counts().to_dict() if col in sub else {}
        return {k: int(vc.get(k, 0)) for k in ("hit", "miss", "false_alarm", "correct_quiet")}
    for ev in ("warning", "danger"):
        out[ev] = {}
        for name, sub in (("el_nino_seasons", df[df["el_nino"]]), ("other_seasons", df[~df["el_nino"]]), ("all", df)):
            out[ev][name] = {"ensemble": tally(sub, f"{ev}_ensemble_outcome")}
            if f"{ev}_ml_outcome" in sub:
                s2 = sub[sub[f"{ev}_ml_outcome"].notna()]
                out[ev][name]["ml_2006_onward"] = tally(s2, f"{ev}_ml_outcome")
                out[ev][name]["ensemble_2006_onward"] = tally(s2, f"{ev}_ensemble_outcome")
        # Brier on the season-level event (max p over Oct-Dec issues vs event)
    out["seasons"] = df.to_dict("records")
    return out


def crisis_2024(levels, X):
    """Ensemble alarm series for the 2024 crisis, issued monthly Oct 2023 .. Mar 2024."""
    qnet = monthly_qnet(levels)
    rows = []
    for t in pd.date_range("2023-07-01", "2024-03-01", freq="MS"):
        H = months_to = (2024 - t.year) * 12 + (12 - t.month)
        oni_t = float(X.loc[t, "oni"])
        res = run_ensemble(t, levels, qnet, H, lambda m: C.A["historical_release_bcm_per_yr"], oni_value=oni_t)
        summ = summarize_paths(res)
        win = [s for s in summ if "2024-04" <= s["month"] <= "2024-12"]
        rows.append({"issue": t.strftime("%Y-%m"), "oni_at_issue": oni_t, "outlook": res["phase"],
                     "analog_years": res["pool"],
                     "p_warning": max(s["p_below_warning"] for s in win),
                     "p_danger": max(s["p_below_danger"] for s in win),
                     "p50_min_apr_dec_2024": min(s["usable_p50"] for s in win),
                     "usable_now_pct": float(K.level_to_pct(res["level0"]))})
    zra, ls = pd.Timestamp("2023-12-28"), pd.Timestamp("2024-03-11")

    def first(col):
        hit = [r for r in rows if r[col] > 0.5]
        if not hit:
            return None, None, None
        t = pd.Timestamp(hit[0]["issue"] + "-15")
        mb = lambda a, b: (b.year - a.year) * 12 + (b.month - a.month)
        return hit[0]["issue"], mb(t, zra), mb(t, ls)
    fw, lzw, llw = first("p_warning")
    fd, lzd, lld = first("p_danger")
    return {"model": "next: ENSO-conditioned water-balance ensemble",
            "definition": ("Issued on the 15th of each month Jul 2023-Mar 2024 with the ONI then known as the outlook, "
                           "the storage then, and a 30 BCM/yr release; alarm probability = max over Apr-Dec 2024 "
                           "month-ends of P(usable < threshold); first = first issue with p > 0.5."),
            "first_warning_p_gt_0_5": fw, "first_danger_p_gt_0_5": fd,
            "zra_allocation_cut": "2023-12-28", "load_shedding_start": "2024-03-11",
            "lead_months_vs_zra": lzw, "lead_months_vs_load_shedding": llw,
            "danger_lead_months_vs_zra": lzd, "danger_lead_months_vs_load_shedding": lld,
            "series": rows}


def live(levels, issue="2026-11-01", horizon=13, pool_override=None):
    """Live 'next' forecast: El Nino outlook (NOAA: strong-to-very-strong El Nino likely
    through JFM 2027; GEOS-S2S Nino-3.4 NDJ +3.99), announced releases."""
    qnet = monthly_qnet(levels)

    def rel(m):
        return C.A["allocation_2026_bcm"] if m.year == 2026 else C.A["allocation_2027_bcm"]
    res = run_ensemble(pd.Timestamp(issue), levels, qnet, horizon, rel, phase="el_nino", pool_override=pool_override)
    return res, summarize_paths(res)
