"""Lake Kariba forecast for Patronus -> web/public/data/kariba.json

Run from the repo root:   python3 -m pipeline.kariba

Steps
  1. G-REALM satellite levels -> usable storage % via a quadratic curve fitted to ZRA pairs
  2. Feature table at each monthly issue date, respecting publication lags
  3. Strictly forward rolling-origin backtest 2005-2026 (retrained every January) for
     h = 1..18, against climatology, persistence and ENSO-only baselines;
     ablation without GRACE (and the no-GRACE model tested back to 1998)
  4. 2024 crisis check, ENSO statistics, nearest analogs to Nov 2026
  5. Live forecast issued 2026-11-15 for Dec 2026 .. Dec 2027
  6. Cost of waiting (simple water balance), other G-REALM reservoirs
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from pipeline import kariba_cost as C
from pipeline import kariba_data as K
from pipeline import kariba_model as M
from pipeline.paths import ISSUE_DATE, OUT

ZRA_URL = "https://www.zambezira.org/hydrology/lake-levels"
ZRA_2027_URL = ("https://www.greenbuildingafrica.co.za/zambezi-river-authority-cuts-kariba-water-allocation-"
                "for-2027-power-generation/")
ZRA_2023_URL = ("https://www.zambezira.org/sites/default/files/Press%20Statement%20-%20Water%20allocation%20at%20"
                "Kariba%20Dam_28%20December%202023_Final.pdf")
IMF_URL = "https://www.imf.org/en/news/articles/2024/11/11/pr-24413-zambia-imf-reaches-agreement-on-4th-review-of-ecf"
ERB_URL = "https://www.erb.org.zm/wp-content/uploads/files/ZESCO-Tarrif-Application-Submission.pdf"

NOTES: list[str] = []


def clean(o):
    """Recursively convert numpy types, round floats, and turn NaN into None."""
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if not np.isfinite(o) else round(float(o), 4)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, pd.Timestamp):
        return o.strftime("%Y-%m-%d")
    return o


def months_between(a: pd.Timestamp, b: pd.Timestamp) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month)


# --------------------------------------------------------------------------------------
def crisis_2024(P: pd.DataFrame, label: str):
    """Alarm series for the 2024 crisis.

    At each issue month t (2023-01 .. 2024-09) the alarm probability is the highest forecast
    P(usable < threshold) over target months Apr-Dec 2024 within 12 months of t. Apr-Dec is
    the period after the rainy season when the lake normally recovers; the question is
    whether the model saw that the recovery would fail.
    """
    rows = []
    for t in pd.date_range("2023-01-01", "2024-09-01", freq="MS"):
        g = P[(P["issue"] == t) & (P["h"] <= 12) & (P["target_month"] >= "2024-04-01") &
              (P["target_month"] <= "2024-12-01")]
        if g.empty:
            continue
        rows.append({"issue": t.strftime("%Y-%m"), "p_warning": float(g["m_pw"].max()),
                     "p_danger": float(g["m_pd"].max()),
                     "usable_now_pct": float(g["usable_now"].iloc[0]),
                     "p50_min_pct": float(g["m_p50"].min())})
    s = pd.DataFrame(rows)
    zra, ls = pd.Timestamp("2023-12-28"), pd.Timestamp("2024-03-11")

    def first(col):
        hit = s[s[col] > 0.5]
        if hit.empty:
            return None, None, None
        t = pd.Timestamp(hit["issue"].iloc[0] + "-15")
        return hit["issue"].iloc[0], months_between(t, zra), months_between(t, ls)

    fw, lzw, llw = first("p_warning")
    fd, lzd, lld = first("p_danger")
    return {
        "model": label,
        "definition": ("Forecast issued on the 15th of each month; alarm probability = max P(usable < threshold) over "
                       "target months Apr-Dec 2024 within 12 months of issue. 'First' = first issue month with p > 0.5."),
        "first_warning_p_gt_0_5": fw, "first_danger_p_gt_0_5": fd,
        "zra_allocation_cut": "2023-12-28", "load_shedding_start": "2024-03-11",
        "lead_months_vs_zra": lzw, "lead_months_vs_load_shedding": llw,
        "danger_lead_months_vs_zra": lzd, "danger_lead_months_vs_load_shedding": lld,
        "observed": "Lake fell to 475.91 m (2.89 % usable) on 11 Dec 2024 (ZRA); Kariba North generation halted ~14 Sep 2024",
        "series": rows,
    }


def alarm_years(P: pd.DataFrame, thr_col="m_pw", thr=K.WARNING_PCT):
    """Year-level hit / miss / false-alarm table for 'will the lake be below threshold after the
    rainy season (Apr-Dec of year Y)?', using issues from Oct(Y-1) to Mar(Y)."""
    out = []
    for Y in range(2006, 2027):
        g = P[(P["issue"] >= f"{Y-1}-10-01") & (P["issue"] <= f"{Y}-03-01") & (P["h"] <= 12) &
              (P["target_month"] >= f"{Y}-04-01") & (P["target_month"] <= f"{Y}-12-01")]
        obs = P[(P["target_month"] >= f"{Y}-04-01") & (P["target_month"] <= f"{Y}-12-01")]
        obs = obs.drop_duplicates("target_month")["obs_pct"].dropna()
        if g.empty or obs.empty:
            continue
        mx = g.groupby("issue")[thr_col].max()
        alarm = bool((mx > 0.5).any())
        first = mx[mx > 0.5].index.min()
        event = bool((obs < thr).any())
        out.append({"year": Y, "alarm": alarm, "event": event,
                    "first_alarm_issue": None if pd.isna(first) else first.strftime("%Y-%m"),
                    "outcome": "hit" if alarm and event else ("miss" if event else ("false_alarm" if alarm else "correct_quiet"))})
    return out


# --------------------------------------------------------------------------------------
def enso_stats(mon: pd.DataFrame, n_perm=20000, seed=1):
    """Level change over the rainy season, Oct(Y-1) -> Jun(Y), El Nino (DJF ONI >= 0.5) vs other."""
    djf = K.oni_djf()
    rows = []
    for Y in range(1994, 2027):
        a, b = pd.Timestamp(Y - 1, 10, 1), pd.Timestamp(Y, 6, 1)
        if a in mon.index and b in mon.index and b <= pd.Timestamp("2026-10-01"):
            rows.append({"year": Y, "oni_djf": float(djf.get(Y, np.nan)),
                         "dlevel_m": float(mon.loc[b, "level_m"] - mon.loc[a, "level_m"]),
                         "dusable_pct": float(mon.loc[b, "usable_pct"] - mon.loc[a, "usable_pct"])})
    d = pd.DataFrame(rows)
    rng = np.random.default_rng(seed)

    def perm(mask):
        x = d["dlevel_m"].values
        obs = x[mask].mean() - x[~mask].mean()
        cnt = 0
        for _ in range(n_perm):
            p = rng.permutation(mask)
            if abs(x[p].mean() - x[~p].mean()) >= abs(obs) - 1e-12:
                cnt += 1
        return obs, (cnt + 1) / (n_perm + 1)

    nino = (d["oni_djf"] >= 0.5).values
    nina = (d["oni_djf"] <= -0.5).values
    dn, pn = perm(nino)
    dl, pl = perm(nina)
    strong = (d["oni_djf"] >= 1.5).values
    return {
        "definition": "Change in monthly-mean G-REALM level from October to the following June; El Nino = DJF ONI >= 0.5; two-sided permutation test (20,000 shuffles) of the difference in means",
        "el_nino_years": [int(y) for y in d.loc[nino, "year"]],
        "la_nina_years": [int(y) for y in d.loc[nina, "year"]],
        "mean_level_change_el_nino_m": d.loc[nino, "dlevel_m"].mean(),
        "mean_level_change_other_m": d.loc[~nino, "dlevel_m"].mean(),
        "difference_m": dn, "p": pn,
        "mean_level_change_la_nina_m": d.loc[nina, "dlevel_m"].mean(),
        "la_nina_difference_vs_other_m": dl, "la_nina_p": pl,
        "mean_level_change_strong_el_nino_m": d.loc[strong, "dlevel_m"].mean(),
        "strong_el_nino_years": [int(y) for y in d.loc[strong, "year"]],
        "mean_usable_change_el_nino_pct": d.loc[nino, "dusable_pct"].mean(),
        "mean_usable_change_other_pct": d.loc[~nino, "dusable_pct"].mean(),
        "n_years": int(len(d)),
        "by_year": d.round(3).to_dict("records"),
    }


# --------------------------------------------------------------------------------------
ANALOG_FEATURES = ["usable_now", "d3", "precip_std_anom", "precip_6m_anom", "root_anom_z", "oni", "oni_d3"]


def analogs(X: pd.DataFrame, mon: pd.DataFrame, issue="2026-11-01", k=5):
    """Nearest past issue-month states (Oct-Dec issues, one per year) by Euclidean distance on
    standardized features; similarity = 1 / (1 + distance / sqrt(n_features))."""
    t = pd.Timestamp(issue)
    F = X[ANALOG_FEATURES].copy()
    mu, sd = F.mean(), F.std()
    Z = (F - mu) / sd
    z0 = Z.loc[t]
    cand = Z[(Z.index < t - pd.DateOffset(months=12)) & Z.index.month.isin([10, 11, 12])].dropna()
    dist = np.sqrt(((cand - z0) ** 2).sum(axis=1))
    df = pd.DataFrame({"dist": dist})
    df["hy"] = [i.year if i.month >= 10 else i.year - 1 for i in df.index]
    best = df.sort_values("dist").groupby("hy").head(1).sort_values("dist").head(k)
    out = []
    for d0, r in best.iterrows():
        fut = mon.loc[d0 + pd.DateOffset(months=1): d0 + pd.DateOffset(months=12), "usable_pct"]
        fut = fut[fut.index <= pd.Timestamp("2026-10-01")]
        u0 = X.loc[d0, "usable_now"]
        imin = fut.idxmin()
        txt = (f"From {u0:.0f}% usable, the lake bottomed at {max(fut.min(), 0):.0f}% in {imin.strftime('%b %Y')} "
               f"and stood at {max(fut.iloc[-1], 0):.0f}% twelve months later" if len(fut) == 12 else
               f"From {u0:.0f}% usable, minimum {max(fut.min(), 0):.0f}% in the following {len(fut)} months")
        out.append({"date": d0.strftime("%Y-%m"), "similarity": 1 / (1 + r["dist"] / np.sqrt(len(ANALOG_FEATURES))),
                    "distance": r["dist"],
                    "state": {f: X.loc[d0, f] for f in ANALOG_FEATURES},
                    "usable_after_6m_pct": fut.iloc[5] if len(fut) >= 6 else None,
                    "usable_after_12m_pct": fut.iloc[11] if len(fut) >= 12 else None,
                    "usable_min_next_12m_pct": fut.min(), "min_month": imin.strftime("%Y-%m"),
                    "fell_below_warning": bool((fut < K.WARNING_PCT).any()),
                    "fell_below_danger": bool((fut < K.DANGER_PCT).any()),
                    "what_happened": txt})
    return {"features": ANALOG_FEATURES, "issue": t.strftime("%Y-%m"),
            "state_now": {f: X.loc[t, f] for f in ANALOG_FEATURES}, "list": out}


# --------------------------------------------------------------------------------------
def main():
    t0 = time.time()
    lv = K.load_levels()
    X, mon = M.build_table()
    S = M.make_samples(X, mon)
    print(f"[kariba] features built: {len(X)} issue months, {S['dlevel'].notna().sum()} samples ({time.time()-t0:.0f}s)")

    # ---------------- backtests
    P_full = M.backtest(S, mon, M.FEATURES_ALL, 2005, 2026)
    print(f"[kariba] full backtest done ({time.time()-t0:.0f}s)")
    P_ng = M.backtest(S, mon, M.FEATURES_NO_GRACE, 2005, 2026, with_baselines=False)
    print(f"[kariba] no-GRACE backtest done ({time.time()-t0:.0f}s)")
    P_ng98 = M.backtest(S, mon, M.FEATURES_NO_GRACE, 1998, 2026)
    print(f"[kariba] no-GRACE 1998+ backtest done ({time.time()-t0:.0f}s)")

    bh = M.metrics_by_horizon(P_full)
    bh_ng = M.metrics_by_horizon(P_ng, with_baselines=False)
    bh_ng98 = M.metrics_by_horizon(P_ng98)
    abl = []
    for a, b in zip(bh, bh_ng):
        abl.append({"horizon": a["horizon"], "removed": "gravis",
                    "brier_warning_full": a["warning"]["brier"], "brier_warning_no_grace": b["warning"]["brier"],
                    "auc_pr_warning_full": a["warning"].get("auc_pr"), "auc_pr_warning_no_grace": b["warning"].get("auc_pr"),
                    "delta_auc_pr_warning": (b["warning"].get("auc_pr") or np.nan) - (a["warning"].get("auc_pr") or np.nan),
                    "brier_danger_full": a["danger"]["brier"], "brier_danger_no_grace": b["danger"]["brier"],
                    "pinball_pct_full": a["pinball_pct"], "pinball_pct_no_grace": b["pinball_pct"]})
    P_full.to_csv(K.CACHE / "kariba_backtest_predictions.csv", index=False)

    # horizon up to which the model beats every baseline on the warning event
    skill_h = [r["horizon"] for r in bh if all((r["warning"].get(f"bss_vs_{b}") or -1) > 0
                                              for b in ("climatology", "persistence", "enso_only"))]
    max_skill_h = 0
    for h in M.HORIZONS:
        if h in skill_h:
            max_skill_h = h
        else:
            break

    crisis = crisis_2024(P_full, "full (with GRACE)")
    crisis_ng = crisis_2024(P_ng, "no GRACE")

    # ---------------- live forecast
    fc, imp = M.live_forecast(S, X, M.FEATURES_ALL)
    fc_ng, _ = M.live_forecast(S, X, M.FEATURES_NO_GRACE)
    fc_en, _ = M.live_forecast(S, X, M.FEATURES_ALL, res_by_phase=True)
    print(f"[kariba] live forecast done ({time.time()-t0:.0f}s)")
    for f in fc + fc_ng + fc_en:
        f.pop("_ens", None)
    dec27 = [f for f in fc if f["month"] == "2027-12"][0]

    # ---------------- ENSO stats, analogs
    enso = enso_stats(mon)
    an = analogs(X, mon)

    # ---------------- cost of waiting
    djf = K.oni_djf()
    nino_years = [y for y in range(1994, 2026) if djf.get(y, 0) >= 0.5]
    all_years = list(range(1994, 2026))
    cres = C.run(lv, nino_years, all_years)
    curve = C.summarize(cres["el_nino"])
    curve_all = C.summarize(cres["all_years"])
    sens = {}
    for name, kw in {"voll_0.5": {"voll": 0.5}, "voll_1.5": {"voll": 1.5},
                     "energy_0.19_twh_per_bcm": {"k": 0.19}, "energy_0.25_twh_per_bcm": {"k": 0.25},
                     "hist_release_23_bcm": {"r_hist": 23.0}, "hist_release_36_bcm": {"r_hist": 36.0},
                     "no_terminal_credit": {"credit": False}}.items():
        r = C.run(lv, nino_years, all_years, **kw)["el_nino"]
        cv = {c["action_month"] or c["policy"]: c["expected_cost_musd_mean"] for c in C.summarize(r)}
        sens[name] = {"act_2026_12": cv["2026-12"], "act_2027_04": cv["2027-04"],
                      "wait_warning": cv["wait_warning"], "no_action": cv["no_action"]}
    # strong El Nino only
    strong_years = [y for y in nino_years if djf.get(y, 0) >= 1.0]
    rs = C.run(lv, strong_years, all_years)["el_nino"]
    cv_s = {c["action_month"] or c["policy"]: c["expected_cost_musd_mean"] for c in C.summarize(rs)}
    sens["strong_el_nino_only"] = {"years": strong_years, "act_2026_12": cv_s["2026-12"],
                                   "act_2027_04": cv_s["2027-04"], "wait_warning": cv_s["wait_warning"],
                                   "no_action": cv_s["no_action"]}
    cmap = {c["action_month"] or c["policy"]: c for c in curve}
    dec, apr = cmap["2026-12"]["expected_cost_musd_mean"], cmap["2027-04"]["expected_cost_musd_mean"]
    ww, na = cmap["wait_warning"]["expected_cost_musd_mean"], cmap["no_action"]["expected_cost_musd_mean"]
    end_pcts = cres["el_nino"]["end_pct_no_action"]
    n_floor = sum(1 for v in end_pcts.values() if v < 1.0)
    headline = (f"In El Nino inflow years, waiting from December to April adds about ${apr - dec:.0f}M in expected "
                f"costs, and waiting until the lake crosses 20% adds about ${ww - dec:.0f}M "
                f"(${dec:.0f}M if conservation starts in Dec 2026 vs ${ww:.0f}M; ${na:.0f}M with no action).")
    print(f"[kariba] cost of waiting done ({time.time()-t0:.0f}s)")

    # ---------------- other reservoirs
    try:
        from pipeline.kariba_reservoirs import other_reservoirs
        others = other_reservoirs()
    except Exception as e:  # optional
        others = None
        NOTES.append(f"other_reservoirs failed: {e}")

    # ---------------- assemble
    latest = lv.iloc[-1]
    hist = [{"date": r.date.strftime("%Y-%m-%d"), "level_m": r.level_m, "usable_pct": round(float(r.usable_pct), 2),
             "mission": r.mission, "err_m": r.err_m} for r in lv.itertuples()]
    hist_m = [{"month": i.strftime("%Y-%m"), "level_m": round(float(r.level_m), 3),
               "usable_pct": round(float(r.usable_pct), 2), "n_obs": int(r.n_obs), "gap": bool(r.gap)}
              for i, r in mon.iterrows()]
    poly, area = K.catchment_polygon()

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": ["grealm", "gravis", "power", "oni", "hydrobasins", "zra", "zesco_erb", "imf", "cpc_enso", "news"],
        "issue_date": ISSUE_DATE,
        "thresholds": {"min_operating_m": K.MIN_OP_M, "max_operating_m": K.MAX_OP_M,
                       "warning_usable_pct": K.WARNING_PCT, "danger_usable_pct": K.DANGER_PCT,
                       "warning_level_m": float(K.pct_to_level(K.WARNING_PCT)),
                       "danger_level_m": float(K.pct_to_level(K.DANGER_PCT)),
                       "record_low": {"date": "2022-12-30", "level_m": 475.60, "source": ZRA_URL},
                       "source": ZRA_URL},
        "storage_curve": {
            "method": (f"usable_pct = {K.CURVE_A:.4f}*x + {K.CURVE_B:.5f}*x^2, x = level_m - 475.5. Quadratic forced "
                       "through 0 % at 475.5 m and 100 % at 488.5 m (ZRA operating band); the curvature is fitted by "
                       "least squares to ZRA level/storage pairs (475.91 m = 2.89 %, 479.98 m = 31.7 %, 480.65 m = "
                       "36.68 %). Convex because lake area grows with level. Usable capacity 64.8 BCM "
                       "(23.77 BCM = 36.68 % on 14 Oct 2026)."),
            "a": K.CURVE_A, "b": K.CURVE_B, "usable_capacity_bcm": K.USABLE_CAPACITY_BCM,
            "zra_points": [dict(p, fitted_pct=float(K.level_to_pct(p["level_m"]))) for p in K.ZRA_POINTS],
            "points": K.storage_curve_points()},
        "history": hist,
        "history_monthly": hist_m,
        "latest": {"date": latest.date.strftime("%Y-%m-%d"), "level_m": latest.level_m,
                   "usable_pct": round(float(latest.usable_pct), 2),
                   "usable_bcm": round(float(K.pct_to_bcm(latest.usable_pct)), 2),
                   "mission": latest.mission,
                   "zra_gauge": {"date": "2026-11-10", "level_m": 479.98, "usable_pct": 31.7, "source": ZRA_URL},
                   "altimetry_minus_gauge_m": round(latest.level_m - 479.98, 2)},
        "drivers_now": {k: X.loc["2026-11-01", k] for k in M.FEATURES_ALL},
        "drivers_now_units": {"usable_now": "%", "level_now": "m", "d1": "m change over 1 month", "d3": "m, 3 months",
                              "d6": "m, 6 months", "precip_1m_anom": "mm vs trailing 15-year mean of the same month (Oct 2026)",
                              "precip_3m_anom": "mm, Aug-Oct 2026", "precip_6m_anom": "mm, May-Oct 2026",
                              "precip_std_anom": "mm, rainy season to date (Oct 2026)",
                              "root_anom_z": "SD, POWER root-zone wetness, Sep 2026",
                              "oni": "ONI ASO 2026", "oni_d3": "ONI change over 3 seasons",
                              "tws_cm": "GRACE-FO TWS anomaly, Aug 2026, catchment mean", "tws_d3": "cm change over 3 months"},
        "catchment": {"method": "HydroBASINS level-5 basins upstream of Kariba dam (28.76E, 16.52S)",
                      "area_km2": round(area), "power_points": [list(p) for p in K.catchment_points()],
                      "bbox": [round(v, 2) for v in poly.bounds]},
        "backtest": {
            "design": ("Strictly forward rolling origin: for each test year 2005-2026 the model is retrained on samples "
                       "whose target month ended before 1 Jan of that year, then issues a forecast on the 15th of every "
                       "month for h = 1..18. Target: monthly-mean usable % at t+h. Model: LightGBM (L2) on the level "
                       "change, predictive distribution = median + out-of-fold residuals (leave-years-out inside the "
                       "training window, same issue season); quantiles and event probabilities are read from that "
                       "ensemble. Baselines refitted on the same training window: climatology (target calendar month), "
                       "persistence (no change, deterministic) and ENSO-only (target-month composite for the issue-time "
                       "ONI phase). Features respect publication lags (G-REALM latest pass, GRACE t-3, POWER "
                       "precipitation complete months to t-1 from the daily API as anomalies vs a trailing 15-year mean, root-zone wetness t-2, ONI season "
                       "ending t-1)."),
            "test_period": "2005-01..2026-10 (targets)", "n_test_issues": int(P_full["issue"].nunique()),
            "events": {"warning": "usable < 20 %", "danger": "usable < 10 %"},
            "by_horizon": bh,
            "skillful_through_horizon": max_skill_h,
            "skill_note": f"The full model beats climatology, persistence and ENSO-only on Brier score for the warning event at every horizon from 1 to {max_skill_h} months.",
            "ablation_no_grace": abl,
            "no_grace_1998_2026": {"design": "Same model without GRACE features, tested 1998-2026 (training from 1993)",
                                   "by_horizon": bh_ng98},
            "reliability": [{"horizon": h, "event": "warning", "bins": M.reliability(P_full, h)} for h in (1, 3, 6, 9, 12)],
            "alarm_years_warning": alarm_years(P_full, "m_pw", K.WARNING_PCT),
            "alarm_years_danger": alarm_years(P_full, "m_pd", K.DANGER_PCT),
            "crisis_2024": crisis,
            "crisis_2024_no_grace": crisis_ng,
        },
        "feature_importance": [{"feature": f, "gain_share": v} for f, v in imp.items()],
        "forecast": {"issued": ISSUE_DATE, "model": "full (with GRACE)",
                     "state": {"date": latest.date.strftime("%Y-%m-%d"), "level_m": latest.level_m,
                               "usable_pct": round(float(latest.usable_pct), 2)},
                     "months": [{k: v for k, v in f.items() if k != "n_train"} for f in fc],
                     "months_no_grace": [{k: v for k, v in f.items() if k != "n_train"} for f in fc_ng],
                     "months_el_nino_spread": [{k: v for k, v in f.items() if k != "n_train"} for f in fc_en],
                     "el_nino_spread_note": ("Sensitivity: same median model, but the uncertainty is drawn only from past "
                                             "forecast errors made when ONI was >= 0.5. In the backtest this variant scored "
                                             "about the same as the default (not better), so it is shown as a sensitivity, "
                                             "not the headline."),
                     "max_p_below_warning": max(f["p_below_warning"] for f in fc),
                     "max_p_below_danger": max(f["p_below_danger"] for f in fc),
                     "skill_caveat": f"Backtest skill over all baselines holds to about {max_skill_h} months; later months lean on climatology of the residuals."},
        "zra_projection": {"end_2027_usable_pct": 9, "end_2027_level_m": 476.80, "end_2027_usable_bcm": 5.83,
                           "allocation_2027_bcm": 23, "allocation_2026_bcm": 36, "cut_pct": 36,
                           "split": "11.5 BCM each for ZESCO and ZPC",
                           "source_url": ZRA_2027_URL,
                           "patronus_dec_2027": {"usable_p10": dec27["usable_p10"], "usable_p50": dec27["usable_p50"],
                                                 "usable_p90": dec27["usable_p90"],
                                                 "p_below_9pct_approx": None},
                           "comparison": None},
        "enso": enso,
        "enso_outlook": {"oni_latest": {"season": "ASO 2026", "value": 2.46},
                         "geos_nino34_forecast": [{"season": "NDJ", "value": 3.99}, {"season": "DJF", "value": 3.97}],
                         "noaa": "Strong-to-very-strong El Nino likely through JFM 2027",
                         "sarcof": "Below-normal rain Jan-Mar 2027 for Zambia and Zimbabwe"},
        "analogs": an["list"], "analogs_meta": {k: v for k, v in an.items() if k != "list"},
        "cost_of_waiting": {
            "assumptions": C.A,
            "method": C.__doc__.strip(),
            "scenario_years": cres["el_nino"]["years"],
            "start_usable_bcm": cres["el_nino"]["s0_bcm"],
            "end_2027_usable_pct_no_action_by_year": end_pcts,
            "n_scenarios_hitting_floor_no_action": n_floor,
            "curve": [c for c in curve if c["action_month"]],
            "policies": [c for c in curve if not c["action_month"]],
            "curve_all_years": [c for c in curve_all if c["action_month"]],
            "policies_all_years": [c for c in curve_all if not c["action_month"]],
            "sensitivity_mean_musd": sens,
            "headline": headline,
            "headline_note": "Expected cost = mean over the historical El Nino inflow scenarios; P10/P50/P90 are across scenarios. Costs are relative to the no-action storage path (end-2027 water credited at 17 c/kWh). The ranking depends on that credit: if water saved in 2027 is assumed worth nothing in 2028, acting in December costs more than waiting (see sensitivity_mean_musd.no_terminal_credit).",
            "calibration_context": {"zambia_2024_imf_growth_cut": "4.7% -> 1.2% (IMF, Nov 2024)", "imf_url": IMF_URL,
                                    "zesco_2024_replacement": "300 MW = 218 GWh/month = $51M/month; 2024 deficit 825 MW vs 2,300 MW demand",
                                    "erb_url": ERB_URL},
        },
        "crisis_2024_facts": {"zra_cut": {"date": "2023-12-28", "text": "ZRA cut the 2024 allocation to 16 BCM (from 30)", "url": ZRA_2023_URL},
                              "load_shedding_8h": "2024-03-11", "load_shedding_12h": "2024-05-20",
                              "kariba_north_halted": "2024-09-14 (approx.)",
                              "low_point": {"date": "2024-12-11", "level_m": 475.91, "usable_pct": 2.89},
                              "oni_peak": {"season": "NDJ 2023/24", "value": 1.99},
                              "imf": {"text": "IMF cut Zambia's 2024 growth forecast from 4.7% to 1.2%", "url": IMF_URL}},
        "other_reservoirs": others,
        "limitations": [
            "Levels are G-REALM satellite altimetry (m above the EGM2008 geoid), not ZRA's gauge datum. They agree within ~0.06 m on 10 Nov 2026 (479.92 vs 479.98 m) but at the 2024 low the altimetry read ~0.2-0.4 m below the gauge (475.46-475.73 m vs 475.91 m), so near the floor usable % can be understated by a few points.",
            "Usable storage comes from a quadratic level-storage curve fitted to five ZRA points; it is an approximation of ZRA's bathymetric table (fit error < 0.12 points at the ZRA pairs).",
            "Satellite passes are every ~10 days with gaps of up to 60 days (marked in history_monthly as gap); monthly means use linear interpolation between passes.",
            "The backtest uses today's versions of POWER, GRACE and ONI, not the values as first published (no vintage archive), so real-time skill may be somewhat lower.",
            ("Rainfall source: NASA POWER (MERRA-2) catchment precipitation from 15 points inside the HydroBASINS catchment. "
             "We checked it against GPCP v2.3 over the same catchment (hydrological-year totals 1981-2025). POWER drifts "
             "relative to GPCP (POWER/GPCP ratio ~1.1-1.4 in the 1980s, ~0.75 in 2002-2006, ~1.0 after 2008), but GPCP shows "
             "an implausible drop from 2020 (e.g. 2020/21 and 2021/22 as dry as the 2023/24 drought while the lake rose 3.2 m "
             "in 2020/21). Nov-Mar POWER rain correlates better with the Oct-Jun lake rise (Spearman 0.54 vs 0.37), so we keep "
             "POWER and express anomalies against a trailing 15-year same-month mean (prior years only), which removes slow "
             "drift without look-ahead. In the backtest this was as good or slightly better than a fixed 1981-2000 baseline."),
            "POWER root-zone wetness shows a step change on 1 Oct 2026 (near-real-time stream); the model uses it with a 2-month lag, so the live forecast uses September 2026.",
            "GRACE features are missing before mid-2002 and during the 2017-18 GRACE/GRACE-FO gap; LightGBM treats them as missing.",
            "About 34 years and ~10 El Nino events: the danger event (< 10 %) is rare, so its skill estimates have wide intervals.",
            "Releases are a policy decision; the model learns historical operating behaviour and cannot anticipate a new allocation rule (e.g. the 2027 cut to 23 BCM) except through the lake's own trajectory.",
            "Probabilities beyond the skillful horizon mostly reflect the spread of historical outcomes for the same season.",
            "The cost model is a transparent one-reservoir water balance: constant energy per BCM (no head effect), assumed historical releases (30 BCM/yr) to back out inflows, no spill, Zambian prices applied to both utilities.",
            "GEOS-S2S seasonal precipitation was not used (no time to backtest it); the El Nino signal enters through ONI and the El Nino inflow scenarios.",
        ],
        "notes": NOTES,
    }
    # ZRA comparison
    zr = 9.0
    cmp_txt = (f"Patronus median for Dec 2027 is {dec27['usable_p50']:.0f}% usable (P10 {max(dec27['usable_p10'],0):.0f}%, "
               f"P90 {dec27['usable_p90']:.0f}%) vs ZRA's 9% if the full 23 BCM is used. ")
    if dec27["usable_p10"] <= zr <= dec27["usable_p90"]:
        cmp_txt += "ZRA's projection lies inside our P10-P90 range."
    elif zr < dec27["usable_p10"]:
        cmp_txt += "ZRA's projection is drier than our P10."
    else:
        cmp_txt += "ZRA's projection is wetter than our P90."
    cmp_txt += (" Note that our statistical model learns historical release behaviour, while ZRA's figure assumes the "
                "full 2027 allocation is drawn.")
    out["zra_projection"]["comparison"] = cmp_txt
    out["zra_projection"]["patronus_dec_2027"]["p_below_warning"] = dec27["p_below_warning"]
    out["zra_projection"]["patronus_dec_2027"]["p_below_danger"] = dec27["p_below_danger"]
    out["zra_projection"]["patronus_dec_2027"].pop("p_below_9pct_approx")
    out["zra_projection"]["water_balance_end_2027_pct_el_nino"] = {
        "p10": float(np.quantile(list(end_pcts.values()), .1)), "p50": float(np.quantile(list(end_pcts.values()), .5)),
        "p90": float(np.quantile(list(end_pcts.values()), .9)),
        "note": "Water-balance check: 23 BCM release in 2027 with historical El Nino-year net inflows (cost model, no action)."}

    out = clean(out)
    f = OUT / "kariba.json"
    f.write_text(json.dumps(out, indent=1, allow_nan=False))
    print(f"[kariba] wrote {f} ({f.stat().st_size/1e3:.0f} kB) in {time.time()-t0:.0f}s")
    print("headline:", headline)


if __name__ == "__main__":
    main()
