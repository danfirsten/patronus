"""Features, models, baselines and the strictly-forward backtest for Lake Kariba.

Unit: one forecast issued on the 15th of every month t. Target: monthly-mean usable storage
(% of 64.8 BCM) in month t+h, h = 1..18. Events: usable < 20 % (warning) and < 10 % (danger).

Information available at issue (15th of month t), respecting publication lags:
  * G-REALM level: last satellite pass on or before the 15th (G-REALM is a few days behind)
  * GRACE/GRACE-FO TWS: month t-3 (GravIS runs ~3 months behind)
  * NASA POWER precipitation: complete months up to t-1, aggregated from the daily API
    (daily runs ~3 days behind); root-zone wetness at t-2 (monthly lag 2)
  * ONI: the 3-month season ending in t-1
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.metrics import average_precision_score

from pipeline import kariba_data as K

HORIZONS = list(range(1, 19))
QS = (0.1, 0.5, 0.9)
CLIM_BASE = ("1981-01-01", "2000-12-01")  # anomaly baseline, entirely before the first test year
PRECIP_BASELINE = "trailing"  # "fixed" (1981-2000) or "trailing" (prior 15 years)
import os
RES_BY_PHASE = os.environ.get("KARIBA_RES_BY_PHASE", "0") == "1"  # condition the residual pool on the issue-time ONI phase

FEATURES_ALL = ["usable_now", "level_now", "d1", "d3", "d6", "obs_age_days",
                "precip_1m_anom", "precip_3m_anom", "precip_6m_anom", "precip_std_anom",
                "root_anom_z", "oni", "oni_d3", "month_sin", "month_cos",
                "tws_cm", "tws_d3"]
GRACE_FEATURES = ["tws_cm", "tws_d3"]
FEATURES_NO_GRACE = [f for f in FEATURES_ALL if f not in GRACE_FEATURES]


# --------------------------------------------------------------------------------------
# Feature table
# --------------------------------------------------------------------------------------
def build_table():
    """Returns (features by issue month, monthly lake table)."""
    lv = K.load_levels()
    dl = K.daily_level(lv)
    mon = K.monthly_levels(lv)
    pw = K.power_monthly_catchment()
    tws = K.grace_catchment()
    oni = K.load_oni()

    # --- precipitation anomalies (mm) against the 1981-2000 calendar-month mean
    p = pw["precip_mm"]
    if PRECIP_BASELINE == "trailing":
        # trailing 15-year mean of the same calendar month (prior years only): removes slow
        # drift / breaks in the reanalysis precipitation and never looks ahead
        pclim_t = p.groupby(p.index.month).transform(
            lambda x: x.shift(1).rolling(15, min_periods=8).mean())
        panom = p - pclim_t
    else:
        base = p.loc[CLIM_BASE[0]:CLIM_BASE[1]]
        pclim = base.groupby(base.index.month).mean()
        panom = p - pclim.reindex(p.index.month).values
    r = pw["GWETROOT"]
    rb = r.loc[CLIM_BASE[0]:CLIM_BASE[1]]
    rz = (r - rb.groupby(rb.index.month).mean().reindex(r.index.month).values) / \
        rb.groupby(rb.index.month).std().reindex(r.index.month).values

    obs = lv.set_index("date")["level_m"]
    issues = pd.date_range("1993-02-01", "2026-11-01", freq="MS")
    rows = []
    for t in issues:
        issue_day = t + pd.Timedelta(days=14)
        o = obs.loc[:issue_day]
        if o.empty:
            continue
        d0, l0 = o.index[-1], o.iloc[-1]

        def lvl_at(days):
            ts = d0 - pd.Timedelta(days=days)
            return dl.get(ts, np.nan)
        m1 = t - pd.DateOffset(months=1)
        # rainy-season-to-date: from 1 Oct of the current hydrological year up to t-1
        hy_start = pd.Timestamp(t.year if t.month >= 11 else t.year - 1, 10, 1)
        if t.month == 10:
            std = np.nan  # nothing accumulated yet
        else:
            std = panom.loc[hy_start:m1].sum(min_count=1)
        # GRACE month t-3; if that month is missing, use the latest available up to t-3
        g = tws.loc[:t - pd.DateOffset(months=3)]
        g_ok = (not g.empty) and (g.index[-1] >= t - pd.DateOffset(months=5))
        tws_now = g.iloc[-1] if g_ok else np.nan
        g_prev = tws.loc[:g.index[-1] - pd.DateOffset(months=3)] if g_ok else pd.Series(dtype=float)
        tws_d3 = (tws_now - g_prev.iloc[-1]) if (g_ok and not g_prev.empty and
                                                  g_prev.index[-1] >= g.index[-1] - pd.DateOffset(months=5)) else np.nan
        on = oni.get(m1, np.nan)
        on3 = oni.get(m1 - pd.DateOffset(months=3), np.nan)
        rows.append({
            "issue": t, "obs_date": d0, "obs_age_days": (issue_day - d0).days,
            "level_now": l0, "usable_now": float(K.level_to_pct(l0)),
            "d1": l0 - lvl_at(30), "d3": l0 - lvl_at(91), "d6": l0 - lvl_at(182),
            "precip_1m_anom": panom.get(m1, np.nan),
            "precip_3m_anom": panom.loc[t - pd.DateOffset(months=3):m1].sum(min_count=3),
            "precip_6m_anom": panom.loc[t - pd.DateOffset(months=6):m1].sum(min_count=6),
            "precip_std_anom": std,
            "root_anom_z": rz.get(t - pd.DateOffset(months=2), np.nan),
            "oni": on, "oni_d3": on - on3,
            "tws_cm": tws_now, "tws_d3": tws_d3,
            "month": t.month,
            "month_sin": np.sin(2 * np.pi * t.month / 12), "month_cos": np.cos(2 * np.pi * t.month / 12),
        })
    X = pd.DataFrame(rows).set_index("issue")
    return X, mon


def make_samples(X: pd.DataFrame, mon: pd.DataFrame, horizons=HORIZONS):
    """Long table of (issue, horizon) samples with the observed target where it exists.
    Targets in months with no satellite pass are interpolated (flagged by target_gap)."""
    out = []
    last_complete = pd.Timestamp("2026-10-01")  # Nov 2026 is not complete at issue time
    for h in horizons:
        s = X.copy()
        s["h"] = h
        s["target_month"] = s.index + pd.DateOffset(months=h)
        tm = s["target_month"]
        s["target_level"] = mon["level_m"].reindex(tm).values
        s.loc[tm > last_complete, "target_level"] = np.nan
        s["target_pct"] = K.level_to_pct(s["target_level"])
        s["target_gap"] = mon["gap"].reindex(tm).values
        s["dlevel"] = s["target_level"] - s["level_now"]
        s["target_cal"] = tm.dt.month.values
        out.append(s.reset_index())
    return pd.concat(out, ignore_index=True)


# --------------------------------------------------------------------------------------
# Model: LightGBM median of the level change + empirical out-of-fold residuals
# --------------------------------------------------------------------------------------
LGB_PARAMS = dict(objective="l2", learning_rate=0.03, n_estimators=300, num_leaves=7,
                  min_child_samples=15, subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
                  reg_lambda=1.0, verbose=-1, random_state=0, n_jobs=1)


def _fit(train, feats):
    m = lgb.LGBMRegressor(**LGB_PARAMS)
    m.fit(train[feats], train["dlevel"])
    return m


def _oof_residuals(train, feats, n_folds=5):
    """Residuals from leave-years-out folds inside the training window, so the spread
    reflects genuine out-of-sample error rather than in-sample fit."""
    years = train["issue"].dt.year.values
    uy = np.unique(years)
    folds = np.array_split(uy, n_folds)
    res = np.full(len(train), np.nan)
    for fy in folds:
        te = np.isin(years, fy)
        if te.sum() == 0 or (~te).sum() < 30:
            continue
        m = _fit(train[~te], feats)
        res[te] = train["dlevel"].values[te] - m.predict(train.loc[te, feats])
    return res


def predictive_ensemble(med_level, res_pool):
    """Level ensemble -> usable % ensemble (clipped below the dead-storage floor at -5 %)."""
    lv = med_level + res_pool
    lv = np.clip(lv, 474.5, K.MAX_OP_M + 0.5)
    return np.clip(K.level_to_pct(lv), -5, 102)


def _res_pool(train_h, res, issue_month, min_n=40, oni=None):
    """Residuals from training issues within +-1 calendar month of the test issue month
    (uncertainty is strongly seasonal); widen to +-2 if too few. With RES_BY_PHASE, first try
    residuals from issues in the same ONI phase."""
    if RES_BY_PHASE and oni is not None:
        ph = np.array([oni_phase(v) for v in train_h["oni"].values])
        for w in (1, 2):
            dm = np.abs(((train_h["month"].values - issue_month + 6) % 12) - 6)
            sel = (dm <= w) & ~np.isnan(res) & (ph == oni_phase(oni))
            if sel.sum() >= 25:
                return res[sel]
    for w in (1, 2, 3, 6):
        dm = np.abs(((train_h["month"].values - issue_month + 6) % 12) - 6)
        sel = (dm <= w) & ~np.isnan(res)
        if sel.sum() >= min_n:
            return res[sel]
    return res[~np.isnan(res)]


def summarize(ens):
    q = np.quantile(ens, QS)
    return {"p10": q[0], "p50": q[1], "p90": q[2],
            "p_warn": float(np.mean(ens < K.WARNING_PCT)), "p_danger": float(np.mean(ens < K.DANGER_PCT))}


# --------------------------------------------------------------------------------------
# Baselines (fitted only on training-window data)
# --------------------------------------------------------------------------------------
def oni_phase(v):
    if np.isnan(v):
        return "neutral"
    return "nino" if v >= 0.5 else ("nina" if v <= -0.5 else "neutral")


def baseline_preds(train_h, mon_train, row):
    """Climatology, persistence and ENSO-only predictions for one test sample."""
    tc = row["target_cal"]
    clim = mon_train["usable_pct"][mon_train.index.month == tc].values
    out = {}
    out["clim"] = {"q": np.quantile(clim, QS), "p_warn": np.mean(clim < K.WARNING_PCT),
                   "p_danger": np.mean(clim < K.DANGER_PCT)}
    u = row["usable_now"]
    out["pers"] = {"q": np.array([u, u, u]), "p_warn": float(u < K.WARNING_PCT),
                   "p_danger": float(u < K.DANGER_PCT)}
    ph = oni_phase(row["oni"])
    tr = train_h[(train_h["target_cal"] == tc)]
    tr = tr[tr["oni"].apply(oni_phase) == ph]["target_pct"].dropna().values
    if len(tr) < 5:
        out["enso"] = out["clim"]
    else:
        out["enso"] = {"q": np.quantile(tr, QS), "p_warn": np.mean(tr < K.WARNING_PCT),
                       "p_danger": np.mean(tr < K.DANGER_PCT)}
    return out


# --------------------------------------------------------------------------------------
# Strictly forward rolling-origin backtest
# --------------------------------------------------------------------------------------
def _backtest_year(S, mon, feats, Y, horizons, with_baselines):
    preds = []
    cutoff = pd.Timestamp(Y - 1, 12, 1)
    mon_train = mon[(mon.index <= cutoff) & (mon.index >= pd.Timestamp("1993-01-01"))]
    for h in horizons:
        Sh = S[S["h"] == h]
        train = Sh[(Sh["target_month"] <= cutoff) & Sh["dlevel"].notna()].reset_index(drop=True)
        test = Sh[Sh["issue"].dt.year == Y].reset_index(drop=True)
        if len(test) == 0 or len(train) < 60:
            continue
        m = _fit(train, feats)
        res = _oof_residuals(train, feats)
        med = test["level_now"].values + m.predict(test[feats])
        for i, row in test.iterrows():
            ens = predictive_ensemble(med[i], _res_pool(train, res, row["month"], oni=row["oni"]))
            sm = summarize(ens)
            rec = {"issue": row["issue"], "h": h, "target_month": row["target_month"],
                   "obs_pct": row["target_pct"], "usable_now": row["usable_now"],
                   "m_p10": sm["p10"], "m_p50": sm["p50"], "m_p90": sm["p90"],
                   "m_pw": sm["p_warn"], "m_pd": sm["p_danger"]}
            if with_baselines:
                b = baseline_preds(train, mon_train, row)
                for k, v in b.items():
                    rec.update({f"{k}_p10": v["q"][0], f"{k}_p50": v["q"][1], f"{k}_p90": v["q"][2],
                                f"{k}_pw": v["p_warn"], f"{k}_pd": v["p_danger"]})
            preds.append(rec)
    return preds


def backtest(S, mon, feats, first_test_year=2005, last_test_year=2026, train_start="1993-01-01",
             horizons=HORIZONS, with_baselines=True, n_jobs=4):
    """Each test year Y: train on samples whose target month is <= Dec(Y-1) (i.e. data that
    existed on 15 Jan of Y), then forecast every issue month of Y at every horizon.
    Years are independent, so they run in parallel."""
    from joblib import Parallel, delayed
    S = S[S["issue"] >= pd.Timestamp(train_start)]
    out = Parallel(n_jobs=n_jobs)(delayed(_backtest_year)(S, mon, feats, Y, horizons, with_baselines)
                                  for Y in range(first_test_year, last_test_year + 1))
    return pd.DataFrame([r for yr in out for r in yr])


def pinball(y, q10, q50, q90):
    def pl(q, tau):
        d = y - q
        return np.maximum(tau * d, (tau - 1) * d)
    return float(np.mean((pl(q10, .1) + pl(q50, .5) + pl(q90, .9)) / 3))


def _auc_ci(y, p, years, n_boot=500, seed=0):
    """90 % CI of AUC-PR by resampling whole years (keeps within-year autocorrelation)."""
    rng = np.random.default_rng(seed)
    uy = np.unique(years)
    vals = []
    for _ in range(n_boot):
        pick = rng.choice(uy, len(uy), replace=True)
        idx = np.concatenate([np.where(years == u)[0] for u in pick])
        if y[idx].sum() == 0 or y[idx].sum() == len(idx):
            continue
        vals.append(average_precision_score(y[idx], p[idx]))
    return [round(float(np.quantile(vals, .05)), 3), round(float(np.quantile(vals, .95)), 3)] if vals else None


def metrics_by_horizon(P, with_baselines=True):
    out = []
    P = P[P["obs_pct"].notna()]
    for h, g in P.groupby("h"):
        y = g["obs_pct"].values
        row = {"horizon": int(h), "n": int(len(g))}
        for ev, thr, col in (("warning", K.WARNING_PCT, "pw"), ("danger", K.DANGER_PCT, "pd")):
            yb = (y < thr).astype(int)
            bm = float(np.mean((g[f"m_{col}"] - yb) ** 2))
            r = {"base_rate": round(float(yb.mean()), 3), "brier": round(bm, 4)}
            if yb.sum() > 0:
                r["auc_pr"] = round(float(average_precision_score(yb, g[f"m_{col}"])), 3)
                r["auc_pr_ci90"] = _auc_ci(yb, g[f"m_{col}"].values, g["issue"].dt.year.values)
            if with_baselines:
                for b in ("clim", "pers", "enso"):
                    bb = float(np.mean((g[f"{b}_{col}"] - yb) ** 2))
                    name = {"clim": "climatology", "pers": "persistence", "enso": "enso_only"}[b]
                    r[f"brier_{name}"] = round(bb, 4)
                    r[f"bss_vs_{name}"] = round(1 - bm / bb, 3) if bb > 0 else None
                if yb.sum() > 0:
                    r["auc_pr_climatology"] = round(float(average_precision_score(yb, g[f"clim_{col}"])), 3)
                    r["auc_pr_enso_only"] = round(float(average_precision_score(yb, g[f"enso_{col}"])), 3)
            row[ev] = r
        row["pinball_pct"] = round(pinball(y, g["m_p10"], g["m_p50"], g["m_p90"]), 3)
        if with_baselines:
            for b, name in (("clim", "climatology"), ("pers", "persistence"), ("enso", "enso_only")):
                row[f"pinball_pct_{name}"] = round(pinball(y, g[f"{b}_p10"], g[f"{b}_p50"], g[f"{b}_p90"]), 3)
        # coverage of the P10-P90 band (should be ~0.8 if calibrated)
        row["coverage_p10_p90"] = round(float(np.mean((y >= g["m_p10"]) & (y <= g["m_p90"]))), 3)
        out.append(row)
    return out


def reliability(P, h, col="m_pw", thr=K.WARNING_PCT, bins=(0, .1, .3, .5, .7, .9, 1.0001)):
    g = P[(P["h"] == h) & P["obs_pct"].notna()]
    y = (g["obs_pct"] < thr).astype(int)
    out = []
    for lo, hi in zip(bins[:-1], bins[1:]):
        s = (g[col] >= lo) & (g[col] < hi)
        if s.sum():
            out.append({"p_mean": round(float(g.loc[s, col].mean()), 3),
                        "observed_rate": round(float(y[s].mean()), 3), "n": int(s.sum())})
    return out


# --------------------------------------------------------------------------------------
# Live forecast
# --------------------------------------------------------------------------------------
def live_forecast(S, X, feats, issue="2026-11-01", horizons=range(1, 14), res_by_phase=None):
    """res_by_phase overrides RES_BY_PHASE (residual pool from issues in the same ONI phase)."""
    global RES_BY_PHASE
    saved = RES_BY_PHASE
    if res_by_phase is not None:
        RES_BY_PHASE = res_by_phase
    t = pd.Timestamp(issue)
    row = X.loc[t]
    out, imps = [], []
    for h in horizons:
        Sh = S[S["h"] == h]
        train = Sh[Sh["dlevel"].notna() & (Sh["issue"] < t)].reset_index(drop=True)
        m = _fit(train, feats)
        res = _oof_residuals(train, feats)
        med = row["level_now"] + m.predict(row[feats].to_frame().T.astype(float))[0]
        ens = predictive_ensemble(med, _res_pool(train, res, t.month, oni=row["oni"]))
        sm = summarize(ens)
        out.append({"month": (t + pd.DateOffset(months=h)).strftime("%Y-%m"), "horizon": h,
                    "usable_p10": sm["p10"], "usable_p50": sm["p50"], "usable_p90": sm["p90"],
                    "level_p50_m": float(K.pct_to_level(max(sm["p50"], 0))),
                    "p_below_warning": sm["p_warn"], "p_below_danger": sm["p_danger"],
                    "n_train": int(len(train)), "_ens": ens})
        imps.append(pd.Series(m.booster_.feature_importance("gain"), index=feats))
    RES_BY_PHASE = saved
    imp = pd.concat(imps, axis=1).mean(axis=1)
    return out, (imp / imp.sum()).sort_values(ascending=False)
