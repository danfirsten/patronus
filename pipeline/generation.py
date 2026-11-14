"""Country hydropower shortfall forecast and backtest (DESIGN.md 11.1-11.4, 11.6, 11.7).

    python3 -m pipeline.generation

Writes web/public/data/{countries,watchlist,generation_backtest}.json and web/public/data/country/{ISO3}.json.
"""
from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression

from pipeline import gen_data as G
from pipeline import gen_model as M
from pipeline.gen_points import SICHUAN_BOX, plant_centroid, points_for
from pipeline.paths import ISSUE_DATE, OUT

ISSUE = pd.Period(ISSUE_DATE[:7], "M")
REPLACEMENT_USD_KWH = 0.20
VOLL_USD_KWH = 1.00
UNSERVED_FRACTION = 0.10
ALARM_MAX_FALSE_PER_5Y = 1.0

CRISES = [
    {"id": "brazil-2021", "name": "Brazil 2021", "iso3": "BRA", "warning": "2021-05-27", "onset": "2021-05-28",
     "enso": "La Nina"},
    {"id": "sichuan-2022", "name": "Sichuan 2022", "iso3": "CHN-SC", "warning": None, "onset": "2022-08-14",
     "enso": "La Nina"},
    {"id": "vietnam-2023", "name": "Northern Vietnam 2023", "iso3": "VNM", "warning": "2023-05-10",
     "onset": "2023-05-25", "enso": "El Nino developing"},
    {"id": "ecuador-2023", "name": "Ecuador 2023 (wave 1)", "iso3": "ECU", "warning": "2023-10-24",
     "onset": "2023-10-27", "enso": "El Nino"},
    {"id": "ecuador-2024-apr", "name": "Ecuador 2024 (wave 2)", "iso3": "ECU", "warning": "2023-12",
     "onset": "2024-04-14", "enso": "El Nino decaying"},
    {"id": "ecuador-2024-sep", "name": "Ecuador 2024 (wave 3)", "iso3": "ECU", "warning": "2023-12",
     "onset": "2024-09-22", "enso": "ENSO-neutral"},
]
SANITY = [("VNM", "2023-05", "2023-06"), ("ECU", "2023-10", "2023-11"), ("ECU", "2024-09", "2024-12"),
          ("BRA", "2021-06", "2021-11"), ("CHN-SC", "2022-07", "2022-09")]

NAMES_OVERRIDE = {"CHN-SC": "Sichuan (China)"}


def _clean(o):
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if not math.isfinite(float(o)) else float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    if isinstance(o, pd.Period):
        return str(o)
    return o


def _write(name: str, obj: dict) -> None:
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_clean(obj), indent=1, allow_nan=False))


def _r(x, k=1):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) or pd.isna(x) else round(float(x), k)


def risk_level(p):
    if p is None:
        return None
    return "low" if p < 0.2 else "watch" if p < 0.4 else "warning" if p < 0.6 else "danger"


# ------------------------------------------------------------------------------------------- build dataset
def build_dataset():
    ref = G.reference()
    lab, info = G.labels()
    oni = G.load_oni()
    share = dict(zip(ref["iso3"], ref["hydro_share_pct"]))
    sc = G.sichuan_totals()
    sc_full = sc[sc["count"] == 12]
    sc_last = sc_full.index.max()
    share["CHN-SC"] = float(sc_full.loc[sc_last, "sum"] / sc_full.loc[sc_last, "total"] * 100)
    rows, bases, drivers = [], {}, {}
    for iso in info:
        L = lab[lab["iso3"] == iso]
        drv = G.driver_table(iso, oni)
        drivers[iso] = drv
        t = pd.period_range(L["month"].min(), ISSUE, freq="M")
        base = G.issue_features(drv, L.set_index("month")["anom_pct"], t)
        bases[iso] = base
        for h in M.HORIZONS:
            rows.append(G.horizon_rows(iso, base, L, h, share[iso]))
    D = pd.concat(rows, ignore_index=True)
    D["tyear"] = D["target"].map(lambda p: p.year)
    D["iyear"] = D["issue"].map(lambda p: p.year)
    D["cluster"] = D["iso3"] + "-" + D["tyear"].astype(str)
    return ref, lab, info, oni, share, D, bases, drivers


# ------------------------------------------------------------------------------------------- backtest
def run_backtest(D: pd.DataFrame, countries: list[str], log):
    feats = G.FEATURES
    res = {"by_horizon": [], "by_horizon_raw": [], "oof": {}, "forward": [], "severe": []}
    for h in M.HORIZONS:
        d = D[(D["horizon"] == h) & D["y_short"].notna()].reset_index(drop=True)
        y = d["y_short"].values.astype(float)
        raw = M.oof_classifier(d, feats, "y_short")
        cal = M.crossfit_isotonic(raw, y, d["tyear"].values)
        base = M.oof_baselines(d, "y_short", countries)
        iso_cal = cal
        cal = M.crossfit_stack(raw, base["climatology"], y, d["tyear"].values)
        q = M.oof_quantiles(d, feats)
        ys = d["y_severe"].values.astype(float)
        raw_s = M.oof_classifier(d, feats, "y_severe")
        cal_s = M.crossfit_isotonic(raw_s, ys, d["tyear"].values)
        ok = ~np.isnan(cal) & ~np.isnan(raw) & np.all([~np.isnan(v) for v in base.values()], axis=0)
        bsel = {k: v[ok] for k, v in base.items()}
        mh = M.horizon_metrics(cal[ok], bsel, y[ok], d.loc[ok, "cluster"].values)
        mr = M.horizon_metrics(raw[ok], bsel, y[ok], d.loc[ok, "cluster"].values, n_boot=300)
        cov = np.mean((d["y_anom"].values >= q[:, 0]) & (d["y_anom"].values <= q[:, 2]))
        mae50 = np.mean(np.abs(d["y_anom"].values - q[:, 1]))
        clim_mae = np.mean(np.abs(d["y_anom"].values))  # climatological median anomaly is ~0 by construction
        mi = M.horizon_metrics(iso_cal[ok], bsel, y[ok], d.loc[ok, "cluster"].values, n_boot=300)
        mi["horizon"] = h
        res.setdefault("by_horizon_isotonic", []).append(mi)
        mh.update({"horizon": h, "calibration": "logistic stack of LightGBM and climatology logits, cross-fitted on out-of-fold predictions of other (gapped) years",
                   "quantile_p10_p90_coverage": round(float(cov), 3), "p50_mae_pct": round(float(mae50), 2),
                   "zero_anomaly_mae_pct": round(float(clim_mae), 2)})
        mr["horizon"] = h
        res["by_horizon"].append(mh)
        res["by_horizon_raw"].append(mr)
        oks = ~np.isnan(cal_s)
        res["severe"].append({"horizon": h, "n": int(oks.sum()), "n_severe": int(ys[oks].sum()),
                              "brier": round(M.brier(cal_s[oks], ys[oks]), 4),
                              "auc_pr": M._r(M.auc_pr(cal_s[oks], ys[oks])), "base_rate": round(float(ys[oks].mean()), 3)})
        d = d.assign(p_iso=iso_cal, p_raw=raw, p_cal=cal, p_sev=cal_s, p_sev_raw=raw_s, q10=q[:, 0], q50=q[:, 1], q90=q[:, 2],
                     **{f"b_{k}": v for k, v in base.items()})
        res["oof"][h] = d
        log(f"  h={h}: n={ok.sum()} AUC-PR {mh['auc_pr']} (clim {mh['auc_pr_climatology']}) "
            f"BSS clim {mh['bss_vs_climatology']} pers {mh['bss_vs_persistence']} enso {mh['bss_vs_enso_only']}")
        # strictly forward test: train on targets <= 2023-11 (known by a 2024-01 issue), test targets >= 2024-01
        tr = d["target"] <= pd.Period("2023-11", "M")
        te = d["target"] >= pd.Period("2024-01", "M")
        dtr, dte = d[tr].reset_index(drop=True), d[te].reset_index(drop=True)
        m = M.fit_clf(dtr[feats], dtr["y_short"].values)
        p_raw = m.predict_proba(dte[feats])[:, 1]
        inner = M.oof_classifier(dtr, feats, "y_short")
        okk = ~np.isnan(inner)
        inner_clim = M.oof_baselines(dtr, "y_short", countries)["climatology"]
        okk &= ~np.isnan(inner_clim)
        clim_te = M.Climatology().fit(dtr, dtr["y_short"].values).predict(dte)
        p_cal = M.Stacker().fit(inner[okk], inner_clim[okk], dtr["y_short"].values[okk]).predict(p_raw, clim_te)
        yb = {"climatology": clim_te,
              "persistence": M.Persistence().fit(dtr, dtr["y_short"].values).predict(dte),
              "enso_only": M.EnsoOnly(countries).fit(dtr, dtr["y_short"].values).predict(dte)}
        yt = dte["y_short"].values.astype(float)
        fm = M.horizon_metrics(p_cal, yb, yt, dte["cluster"].values, n_boot=500)
        fm["horizon"] = h
        fm["brier_uncalibrated"] = round(M.brier(p_raw, yt), 4)
        fm["auc_pr_uncalibrated"] = M._r(M.auc_pr(p_raw, yt))
        res["forward"].append(fm)
        log(f"     forward: n={len(yt)} AUC-PR {fm['auc_pr']} (clim {fm['auc_pr_climatology']}) BSS clim {fm['bss_vs_climatology']}")
    # reliability at h=3
    d3 = res["oof"][3]
    ok = d3["p_cal"].notna()
    res["reliability"] = [
        {"horizon": 3, "calibrated": True, "bins": M.reliability_bins(d3.loc[ok, "p_cal"].values, d3.loc[ok, "y_short"].values)},
        {"horizon": 3, "calibrated": False, "bins": M.reliability_bins(d3.loc[ok, "p_raw"].values, d3.loc[ok, "y_short"].values)},
    ]
    return res


def run_ablations(D: pd.DataFrame, log, h: int = 3):
    d = D[(D["horizon"] == h) & D["y_short"].notna()].reset_index(drop=True)
    y = d["y_short"].values.astype(float)
    full = M.oof_classifier(d, G.FEATURES, "y_short")
    nasa = (G.FEATURE_GROUPS["gravis"] + G.FEATURE_GROUPS["gpcp_precip"] + G.FEATURE_GROUPS["power_soil"]
            + G.FEATURE_GROUPS["power_temp"])
    groups = {"gravis": G.FEATURE_GROUPS["gravis"], "gpcp_precip": G.FEATURE_GROUPS["gpcp_precip"],
              "power_soil": G.FEATURE_GROUPS["power_soil"], "power_temp": G.FEATURE_GROUPS["power_temp"],
              "oni": G.FEATURE_GROUPS["oni"], "ember_persistence": G.FEATURE_GROUPS["ember"],
              "grid_history": G.FEATURE_GROUPS["history"],
              "all_nasa (gravis+gpcp+power)": nasa}
    preds = {}
    for name, cols in groups.items():
        preds[name] = M.oof_classifier(d, [f for f in G.FEATURES if f not in cols], "y_short")
    # rainfall source swap: GPCP rain replaced by NASA POWER/MERRA-2 rain (same anomaly definitions)
    preds["swap: gpcp_precip -> power_merra2_precip"] = M.oof_classifier(
        d, [f for f in G.FEATURES if f not in G.FEATURE_GROUPS["gpcp_precip"]] + G.MERRA_PRECIP, "y_short")
    ok = ~np.isnan(full)
    for v in preds.values():
        ok &= ~np.isnan(v)
    a_full = M.auc_pr(full[ok], y[ok])
    out = []
    cl = d.loc[ok, "cluster"].values
    for name, p in preds.items():
        a = M.auc_pr(p[ok], y[ok])

        def fn(idx, p=p):
            yy = y[ok][idx]
            f, g = M.auc_pr(full[ok][idx], yy), M.auc_pr(p[ok][idx], yy)
            return None if f is None or g is None else g - f

        bs = M.cluster_bootstrap(cl, fn, 500)
        out.append({"removed": name, "horizon": h, "auc_pr": M._r(a), "auc_pr_full": M._r(a_full),
                    "delta_vs_full": M._r(a - a_full), "delta_ci90": M.ci90(bs),
                    "brier": round(M.brier(p[ok], y[ok]), 4), "brier_full": round(M.brier(full[ok], y[ok]), 4)})
        log(f"  ablate {name}: AUC-PR {a:.3f} vs full {a_full:.3f}")
    return out


# ------------------------------------------------------------------------------------------- alarm + crises
def alarm_model(D: pd.DataFrame, log):
    """P(any shortfall in t+1..t+6) at issue t, out-of-fold by issue year with a +/-1 year gap."""
    d = D[(D["horizon"] == 1) & D["y_any6"].notna()].reset_index(drop=True)
    y = d["y_any6"].values.astype(float)
    raw = M.oof_classifier(d, G.FEATURES, "y_any6", year_col="iyear")
    clim = M.oof_baselines(d, "y_any6", sorted(d["iso3"].unique()), year_col="iyear")["climatology"]
    cal = M.crossfit_stack(raw, clim, y, d["iyear"].values)
    d = d.assign(p_any_raw=raw, p_any=cal, p_any_clim=clim)
    ok = d["p_any"].notna()
    log(f"  alarm model: n={ok.sum()} AUC-PR {M.auc_pr(cal[ok], y[ok]):.3f} vs clim {M.auc_pr(clim[ok], y[ok]):.3f}")
    stats = {"n": int(ok.sum()), "base_rate": round(float(y[ok].mean()), 3),
             "auc_pr": M._r(M.auc_pr(cal[ok], y[ok])), "auc_pr_climatology": M._r(M.auc_pr(clim[ok], y[ok])),
             "brier": round(M.brier(cal[ok], y[ok]), 4), "bss_vs_climatology": M._r(M.bss(cal[ok], clim[ok], y[ok]))}
    return d, stats


def false_alarm_rate(d: pd.DataFrame, thr: float):
    """False-alarm rate in calm periods. A calm issue month has no shortfall in t+1..t+6. One alarm covers a
    6-month window, so 6 alarm-months in calm periods count as one false alarm. Rate = false alarms per 5 calm
    country-years = (calm alarm-months / 6) / (calm months / 60)."""
    calm = d["y_any6"] == 0
    n_calm = int(calm.sum())
    fa_months = int(((d["p_any"] >= thr) & calm).sum())
    hits = int(((d["p_any"] >= thr) & (d["y_any6"] == 1)).sum())
    pos = int((d["y_any6"] == 1).sum())
    rate = (fa_months / 6) / (n_calm / 60) if n_calm else np.nan
    return fa_months, n_calm, hits / pos if pos else np.nan, rate


def choose_threshold(d):
    d = d[d["p_any"].notna()]
    grid = np.round(np.arange(0.05, 0.96, 0.01), 2)
    table, chosen = [], None
    for thr in grid:
        fa, nc, hit_rate, rate = false_alarm_rate(d, thr)
        table.append((thr, fa, nc, hit_rate, rate))
        if chosen is None and rate <= ALARM_MAX_FALSE_PER_5Y:
            chosen = (thr, fa, nc, hit_rate, rate)
    return chosen, table


def crisis_leads(d: pd.DataFrame, thr: float, lab: pd.DataFrame):
    out = []
    for c in CRISES:
        onset = pd.Period(c["onset"][:7], "M")
        warn = pd.Period(c["warning"][:7], "M") if c["warning"] else None
        g = d[d["iso3"] == c["iso3"]].set_index("issue").sort_index()
        win = pd.period_range(onset - 6, onset, freq="M")
        series = [{"issue": str(m), "p_any_shortfall_6m": _r(g["p_any"].get(m), 3)} for m in win]
        alarm = None
        for m in win:
            p = g["p_any"].get(m)
            if p is not None and not pd.isna(p) and p >= thr:
                alarm = m
                break
        L = lab[(lab["iso3"] == c["iso3"])].set_index("month")
        obs = [{"month": str(m), "cf_anom_pct": _r(L["anom_pct"].get(m))} for m in pd.period_range(onset - 1, onset + 3, freq="M")]
        row = {"id": c["id"], "name": c["name"], "iso3": c["iso3"], "official_warning": c["warning"], "onset": c["onset"],
               "enso": c["enso"], "alarm_month": str(alarm) if alarm else None,
               "lead_months": (onset - alarm).n if alarm else None,
               "lead_vs_official_months": ((warn - alarm).n if (alarm and warn) else None),
               "caught": alarm is not None, "status": "caught" if alarm else "missed",
               "p_series": series, "observed_anomaly_around_onset": obs}
        out.append(row)
    return out


# ------------------------------------------------------------------------------------------- final models + live
def fit_final(D: pd.DataFrame, oof: dict):
    feats = G.FEATURES
    models = {}
    for h in M.HORIZONS:
        d = D[(D["horizon"] == h) & D["y_short"].notna()]
        o = oof[h]
        ok = o["p_raw"].notna()
        okc = ok & o["b_climatology"].notna()
        iso = M.Stacker().fit(o.loc[okc, "p_raw"].values, o.loc[okc, "b_climatology"].values, o.loc[okc, "y_short"].values)
        clim_all = M.Climatology().fit(d, d["y_short"].values)
        clf = M.fit_clf(d[feats], d["y_short"].values)
        sev = M.fit_clf(d[feats], d["y_severe"].values)
        raw_s = o["p_sev_raw"].values
        okS = ~np.isnan(raw_s)
        iso_s = IsotonicRegression(y_min=0.002, y_max=0.995, out_of_bounds="clip").fit(raw_s[okS], o["y_severe"].values[okS])
        qs = [M.fit_qr(d[feats], d["y_anom"].values, a) for a in M.QUANTILES]
        models[h] = {"clf": clf, "iso": iso, "clim": clim_all, "sev": sev, "iso_s": iso_s, "qr": qs}
    return models


def feature_importance(models):
    tot = pd.Series(0.0, index=G.FEATURES)
    for h, m in models.items():
        g = pd.Series(m["clf"].booster_.feature_importance("gain"), index=G.FEATURES)
        tot += g / g.sum()
    tot /= len(models)
    grp = {f: k for k, v in G.FEATURE_GROUPS.items() for f in v}
    by_group = tot.groupby(tot.index.map(grp)).sum().sort_values(ascending=False)
    feats = [{"feature": f, "group": grp[f], "gain_share": round(float(v), 4)} for f, v in tot.sort_values(ascending=False).items()]
    groups = [{"group": k, "gain_share": round(float(v), 4)} for k, v in by_group.items()]
    return feats, groups


def drivers_text(row: pd.Series, info: dict, iso3: str, lab: pd.DataFrame, enso_row: dict | None) -> list[str]:
    cand = []
    p3 = row.get("precip_3m_anom_pct")
    if pd.notna(p3) and abs(p3) >= 15:
        cand.append((abs(p3) / 15, f"Rain (GPCP) near the hydro plants {abs(p3):.0f}% {'below' if p3 < 0 else 'above'} normal for the last 3 months"))
    p12 = row.get("precip_12m_anom_pct")
    if pd.notna(p12) and abs(p12) >= 10:
        cand.append((abs(p12) / 10, f"12-month rainfall {abs(p12):.0f}% {'below' if p12 < 0 else 'above'} normal"))
    tz = row.get("tws_anom_sd")
    if pd.notna(tz) and abs(tz) >= 0.75:
        cand.append((abs(tz) / 0.75, f"Basin water storage (GRACE-FO, {str(ISSUE - 3)}) {abs(tz):.1f} SD {'below' if tz < 0 else 'above'} normal"))
    sr = row.get("soil_root_anom_sd")
    if pd.notna(sr) and abs(sr) >= 0.75:
        cand.append((abs(sr) / 0.75, f"Root-zone soil {'drier' if sr < 0 else 'wetter'} than normal ({sr:+.1f} SD)"))
    t2 = row.get("t2m_3m_anom_sd")
    if pd.notna(t2) and t2 >= 1.0:
        cand.append((t2 / 1.0, f"Unusually hot over the basins ({t2:+.1f} SD, 3-month mean)"))
    pa = row.get("persist_anom_pct")
    if pd.notna(pa) and abs(pa) >= 10:
        cand.append((abs(pa) / 10, f"Hydro output {abs(pa):.0f}% {'below' if pa < 0 else 'above'} normal in the latest Ember month used ({row.get('persist_month', str(ISSUE - 2))})"))
    oni = row.get("oni")
    if pd.notna(oni) and abs(oni) >= 0.5:
        phase = "El Nino" if oni > 0 else "La Nina"
        txt = f"{phase} conditions (ONI {oni:+.1f})"
        score = abs(oni) / 2.5  # the same global signal for every grid; ranked below local anomalies by default
        if enso_row:
            key = "el_nino_effect_pct" if oni > 0 else "la_nina_effect_pct"
            eff = enso_row.get(key)
            if eff is not None and abs(eff) >= 5:
                txt += f": this grid's {enso_row.get('variable', 'hydro').replace('_', ' ')} has historically changed {eff:+.0f}% in this phase"
                if eff <= -5:
                    score = abs(oni) / 0.75
        cand.append((score, txt))
    cand.sort(key=lambda x: -x[0])
    return [t for _, t in cand[:4]]


def analogs(bases: dict, D_any: pd.DataFrame, iso3: str, k: int = 5):
    cols = ["persist_anom_pct", "persist_3m_anom_pct", "tws_anom_sd", "tws_change_3m_sd", "precip_3m_anom_pct",
            "precip_6m_anom_pct", "precip_12m_anom_pct", "soil_root_anom_sd", "t2m_3m_anom_sd", "oni",
            "issue_month_sin", "issue_month_cos"]
    pool = D_any[["iso3", "issue", "y_any6"] + cols].dropna(subset=["y_any6"]).reset_index(drop=True)
    mu = pool[cols].mean()
    sd = pool[cols].std().replace(0, 1)
    now = bases[iso3].loc[ISSUE, cols]
    Z = (pool[cols] - mu) / sd
    z0 = (now - mu) / sd
    diff = (Z - z0) ** 2
    n = diff.notna().sum(axis=1)
    dist = np.sqrt(diff.sum(axis=1, min_count=1) / n)
    dist[n < 6] = np.nan
    pool = pool.assign(dist=dist).dropna(subset=["dist"])
    pool = pool[~((pool["iso3"] == iso3) & (pool["issue"] > ISSUE - 24))]
    top = pool.nsmallest(k, "dist")
    return [{"month": str(r.issue), "iso3": r.iso3, "similarity": round(1 / (1 + r.dist), 3),
             "shortfall_next_6m": bool(r.y_any6), "n_features_compared": int(n[r.Index])} for r in top.itertuples()]


def live_forecast(iso3, D, models, lab, info):
    L = lab[lab["iso3"] == iso3].set_index("month")
    rows = []
    for h in M.HORIZONS:
        tgt = ISSUE + h
        row = D[(D["iso3"] == iso3) & (D["issue"] == ISSUE) & (D["horizon"] == h)]
        X = row[G.FEATURES].astype(float)
        m = models[h]
        p = float(m["iso"].predict(m["clf"].predict_proba(X)[:, 1], m["clim"].predict(row))[0])
        ps = float(m["iso_s"].predict(m["sev"].predict_proba(X)[:, 1])[0])
        ps = min(ps, p)
        q = sorted(float(r.predict(X)[0]) for r in m["qr"])
        # normal generation for the target month: median of that calendar month's metric, at the latest capacity
        same = L[L.index.month == tgt.month].dropna(subset=["metric"])
        normal_metric = float(np.median(same["metric"].values)) if len(same) >= 2 else np.nan
        hours = tgt.days_in_month * 24.0
        if info[iso3]["basis"] == "capacity_factor":
            gw = float(L["gw"].dropna().iloc[-1])
            normal_twh = normal_metric * gw * hours / 1000.0
        else:
            normal_twh = normal_metric * tgt.days_in_month
        rows.append({"month": str(tgt), "horizon": h, "p_shortfall": round(p, 3), "p_severe": round(ps, 3),
                     "anomaly_p10_pct": round(q[0], 1), "anomaly_p50_pct": round(q[1], 1), "anomaly_p90_pct": round(q[2], 1),
                     "normal_twh": _r(normal_twh, 3), "risk_level": risk_level(p)})
    return rows


def costs(months):
    unit = REPLACEMENT_USD_KWH * (1 - UNSERVED_FRACTION) + VOLL_USD_KWH * UNSERVED_FRACTION
    out = {}
    for lab_, key in (("p10", "anomaly_p90_pct"), ("p50", "anomaly_p50_pct"), ("p90", "anomaly_p10_pct")):
        tot = 0.0
        for m in months:
            if m["normal_twh"] is None:
                return None, unit
            deficit_twh = max(0.0, -m[key] / 100.0) * m["normal_twh"]
            tot += m["p_shortfall"] * deficit_twh * 1e9 * unit / 1e6
        out[lab_] = round(tot, 1)
    return out, unit


# ------------------------------------------------------------------------------------------- main
def main():
    t0 = time.time()
    log = lambda s: print(f"[{time.time() - t0:6.1f}s] {s}", flush=True)
    gen_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    ref, lab, info, oni, share, D, bases, drivers = build_dataset()
    countries = sorted(info)
    log(f"dataset: {len(countries)} areas, {D['y_short'].notna().sum()} labelled rows over 6 horizons")
    notes, limitations = [], []

    # target sanity check
    sanity = []
    for iso, a, b in SANITY:
        L = lab[(lab["iso3"] == iso)].set_index("month")
        ms = pd.period_range(a, b, freq="M")
        vals = [{"month": str(m), "cf_anom_pct": _r(L["anom_pct"].get(m)), "shortfall": None if pd.isna(L["anom_pct"].get(m)) else bool(L["anom_pct"].get(m) <= G.SHORTFALL_PCT)} for m in ms]
        n_hit = sum(1 for v in vals if v["shortfall"])
        sanity.append({"iso3": iso, "period": f"{a}..{b}", "months": vals, "n_shortfall": n_hit, "n_months": len(ms)})
        log(f"sanity {iso} {a}..{b}: " + " ".join(f"{v['month']}:{v['cf_anom_pct']}" for v in vals))

    log("backtest (LOYO)...")
    bt = run_backtest(D, countries, log)
    log("ablations...")
    abl = run_ablations(D, log)
    log("alarm model...")
    dA, alarm_stats = alarm_model(D, log)
    chosen, table = choose_threshold(dA)
    thr = chosen[0]
    log(f"alarm threshold {thr}: {chosen[1]} alarm-months in {chosen[2]} calm months -> {chosen[4]:.2f}/5y; hit rate {chosen[3]:.2f}")
    leads = crisis_leads(dA, thr, lab)
    for c in leads:
        log(f"  {c['id']}: alarm {c['alarm_month']} lead {c['lead_months']} vs official {c['lead_vs_official_months']}")

    log("final models...")
    models = fit_final(D, bt["oof"])
    fi, fig = feature_importance(models)
    # alarm model on all data for live P(any shortfall within 6 months)
    dAll = D[(D["horizon"] == 1) & D["y_any6"].notna()]
    alarm_clf = M.fit_clf(dAll[G.FEATURES], dAll["y_any6"].values)
    okA = dA["p_any_raw"].notna() & dA["p_any_clim"].notna()
    alarm_iso = M.Stacker().fit(dA.loc[okA, "p_any_raw"].values, dA.loc[okA, "p_any_clim"].values, dA.loc[okA, "y_any6"].values)
    alarm_clim = M.Climatology().fit(dAll, dAll["y_any6"].values)

    enso = {}
    try:
        ej = json.loads((OUT / "enso.json").read_text())
        enso = {c["iso3"]: c for c in ej.get("countries", [])}
    except Exception:
        notes.append("enso.json not available when this ran; enso_exposure is null in the watchlist.")

    names = dict(zip(ref["iso3"], ref["name"])) | NAMES_OVERRIDE
    watch = []
    D1 = D[D["horizon"] == 1]
    for iso in countries:
        base_row = bases[iso].loc[ISSUE].copy()
        Lp = lab[lab["iso3"] == iso].set_index("month")["anom_pct"]
        base_row["persist_month"] = str(ISSUE - 2) if pd.notna(Lp.get(ISSUE - 2)) else str(ISSUE - 3)
        months = live_forecast(iso, D, models, lab, info)
        ra = D1[(D1["iso3"] == iso) & (D1["issue"] == ISSUE)]
        p_any = float(alarm_iso.predict(alarm_clf.predict_proba(ra[G.FEATURES])[:, 1], alarm_clim.predict(ra))[0])
        last = info[iso]["last"]
        stale = pd.Period(last, "M") < ISSUE - 2
        maxp = max(m["p_shortfall"] for m in months)
        drv = drivers_text(base_row, info, iso, lab, enso.get(iso))
        cst, unit = costs(months)
        L = lab[lab["iso3"] == iso].set_index("month")
        gap = [str(m) for m in pd.period_range(pd.Period(last, "M") + 1, ISSUE, freq="M")]
        w = {"iso3": iso, "name": names.get(iso, iso), "tier": 1, "risk_level": risk_level(maxp),
             "max_p_shortfall": round(maxp, 3), "p_any_shortfall_6m": round(p_any, 3),
             "alarm": bool(p_any >= thr), "alarm_threshold": thr,
             "first_month": months[0]["month"], "last_observed_month": last,
             "unforecast_gap_months": gap,
             "gap_note": (f"Ember data ends {last}. Months {gap[0]}..{gap[-1]} have no published data yet and are not forecast; "
                          f"the forecast covers {months[0]['month']}..{months[-1]['month']} (horizons 1-6 from the {ISSUE} issue month)."
                          + (" Ember data is older than the 2-month lag the model was trained with, so the persistence input is missing and the forecast leans on NASA water and ENSO inputs." if stale else "")) if gap else None,
             "latest_cf_anom_pct": _r(L["anom_pct"].dropna().iloc[-1]) if L["anom_pct"].notna().any() else None,
             "months": [{k: v for k, v in m.items() if k not in ("normal_twh",)} for m in months],
             "drivers": drv, "enso_exposure": enso.get(iso, {}).get("exposure"),
             "expected_cost_next_6m_musd": cst, "label_basis": info[iso]["basis"]}
        watch.append(w)

        # country page
        hist = [{"month": str(m), "hydro_twh": _r(r.twh, 3), "cf_anom_pct": _r(r.anom_pct),
                 "capacity_gw": _r(r.gw, 2), "shortfall": None if pd.isna(r.anom_pct) else bool(r.anom_pct <= G.SHORTFALL_PCT),
                 "severe": None if pd.isna(r.anom_pct) else bool(r.anom_pct <= G.SEVERE_PCT)} for m, r in L.iterrows()]
        btrows = []
        for h in M.HORIZONS:
            o = bt["oof"][h]
            o = o[(o["iso3"] == iso) & o["p_cal"].notna()]
            for r in o.itertuples():
                btrows.append({"issue": str(r.issue), "target": str(r.target), "horizon": h, "p_shortfall": round(r.p_cal, 3),
                               "p_climatology": round(r.b_climatology, 3), "anomaly_p10_pct": _r(r.q10), "anomaly_p50_pct": _r(r.q50),
                               "anomaly_p90_pct": _r(r.q90), "observed_anom_pct": _r(r.y_anom), "observed_shortfall": bool(r.y_short)})
        alarm_hist = [{"issue": str(r.issue), "p_any_shortfall_6m": round(r.p_any, 3), "observed_any_shortfall_6m": bool(r.y_any6)}
                      for r in dA[(dA["iso3"] == iso) & dA["p_any"].notna()].itertuples()]
        dn = {"tws_anom_sd": _r(base_row["tws_anom_sd"], 2), "tws_month": str(ISSUE - 3),
              "precip_source": "GPCP v2.3", "precip_1m_anom_pct": _r(base_row["precip_1m_anom_pct"]), "precip_3m_anom_pct": _r(base_row["precip_3m_anom_pct"]),
              "precip_6m_anom_pct": _r(base_row["precip_6m_anom_pct"]), "precip_12m_anom_pct": _r(base_row["precip_12m_anom_pct"]),
              "soil_root_anom_sd": _r(base_row["soil_root_anom_sd"], 2), "soil_top_anom_sd": _r(base_row["soil_top_anom_sd"], 2),
              "t2m_3m_anom_sd": _r(base_row["t2m_3m_anom_sd"], 2), "power_month": str(ISSUE - 1),
              "oni": _r(base_row["oni"], 2), "oni_season": "ASO " + str((ISSUE - 1).year),
              "persist_anom_pct": _r(base_row["persist_anom_pct"]), "persist_month": base_row["persist_month"]}
        pts = points_for(iso)
        page = {"generated_at": gen_at, "sources": ["ember_monthly", "ember_yearly"] + (["ember_china"] if iso == "CHN-SC" else [])
                + ["gravis", "gpcp", "power", "oni", "gppd"],
                "iso3": iso, "name": names.get(iso, iso), "tier": 1,
                "label_basis": info[iso]["basis"], "monthly_from": info[iso]["first"], "monthly_to": last,
                "history": hist, "drivers_now": dn, "drivers": drv,
                "sampling_points": [{"lon": x, "lat": y, "weight": round(wt, 3)} for x, y, wt in pts],
                "backtest": btrows, "alarm_history": alarm_hist, "alarm_threshold": thr,
                "forecast": {"issued": ISSUE_DATE, "issue_month": str(ISSUE), "first_month": months[0]["month"],
                             "last_observed_month": last, "p_any_shortfall_6m": round(p_any, 3), "months": months},
                "analogs": analogs(bases, D1, iso),
                "costs": {"replacement_usd_per_kwh": REPLACEMENT_USD_KWH, "voll_usd_per_kwh": VOLL_USD_KWH,
                          "unserved_fraction": UNSERVED_FRACTION, "blended_usd_per_kwh": round(unit, 3),
                          "expected_cost_next_6m_musd": cst,
                          "method": ("Estimate only. For each forecast month: P(shortfall) x deficit x blended cost. Deficit = "
                                     "max(0, -anomaly quantile) x normal hydro generation (median of that calendar month's "
                                     "observed output, at the latest capacity). Blended cost assumes 90% of the deficit is replaced "
                                     "at 20 c/kWh and 10% goes unserved at a value of lost load of $1.00/kWh. p10/p50/p90 use the "
                                     "P90/P50/P10 anomaly quantiles. Ignores imports, reservoir re-optimisation and demand response; "
                                     "large exporters (Norway, Canada, Sweden) mostly lose export revenue, not supply.")},
                "notes": ([f"Ember data ends {last}; forecast months start {months[0]['month']}."]
                          + (["Sichuan: no provincial capacity series, so the anomaly is generation vs the same calendar month in earlier years rescaled by the last full year's total output. Sampling box lon 97.3-108.6, lat 26.0-34.4 also catches some Yunnan, Tibet, Gansu and Chongqing plants."] if iso == "CHN-SC" else []))}
        _write(f"country/{iso}.json", page)

    watch.sort(key=lambda w: -w["max_p_shortfall"])
    _write("watchlist.json", {
        "generated_at": gen_at, "sources": ["ember_monthly", "ember_yearly", "ember_china", "gravis", "gpcp", "power", "oni", "gppd"],
        "issued": ISSUE_DATE, "issue_month": str(ISSUE),
        "method": ("Pooled LightGBM per horizon (1-6 months after the issue month), isotonic-calibrated on out-of-fold predictions. "
                   "Inputs available on the issue date: Ember hydro anomaly at t-2, GRACE-FO TWS at t-3, GPCP rain and NASA POWER soil/temperature at t-1, ONI at t-1. "
                   "Shortfall = hydro capacity factor >= 15% below that calendar month's normal; severe = >= 30% below."),
        "alarm_definition": f"alarm = P(any shortfall in the next 6 months) >= {thr} (threshold set for <= 1 false alarm per country per 5 calm years in the backtest)",
        "countries": watch, "notes": notes})

    # countries.json
    y = G.ember_yearly()
    clist = []
    for r in ref.itertuples():
        iso = r.iso3
        tier = 1 if r.has_monthly else 2 if iso in ("ZMB", "ZWE") else 3
        gw = r.hydro_capacity_GW if pd.notna(r.hydro_capacity_GW) else None
        gw_note = None
        if gw is None:
            yy = y[(y["iso3"] == iso) & y["gw"].notna()].sort_values("year")
            if len(yy):
                gw = float(yy["gw"].iloc[-1])
                gw_note = f"Ember capacity for {int(yy['year'].iloc[-1])} (latest year with capacity)"
        lat, lon, gppd_gw = plant_centroid(iso)
        clist.append({"iso3": iso, "name": r.name, "continent": r.Continent, "tier": tier,
                      "hydro_share_pct": _r(r.hydro_share_pct), "hydro_twh": _r(r.hydro_TWh, 2), "hydro_gw": _r(gw, 2),
                      "hydro_gw_note": gw_note, "latest_year": int(r.latest_year), "lat": _r(lat, 2), "lon": _r(lon, 2),
                      "gppd_hydro_gw": _r(gppd_gw, 2),
                      "monthly_from": info[iso]["first"] if iso in info else None,
                      "monthly_to": info[iso]["last"] if iso in info else None,
                      "has_country_page": iso in info})
    sc = G.sichuan_totals()
    scf = sc[sc["count"] == 12]
    ly = int(scf.index.max())
    lat, lon, gppd_gw = plant_centroid("CHN-SC")
    clist.append({"iso3": "CHN-SC", "name": "Sichuan (China)", "continent": "Asia", "tier": 1,
                  "hydro_share_pct": _r(scf.loc[ly, "sum"] / scf.loc[ly, "total"] * 100), "hydro_twh": _r(scf.loc[ly, "sum"], 2),
                  "hydro_gw": None, "hydro_gw_note": "No provincial capacity in Ember; GPPD (2021) plants in the sampling box sum to "
                  f"{gppd_gw:.1f} GW but the box also includes some Yunnan/Tibet/Chongqing plants",
                  "latest_year": ly, "lat": _r(lat, 2), "lon": _r(lon, 2), "gppd_hydro_gw": _r(gppd_gw, 2),
                  "monthly_from": info["CHN-SC"]["first"], "monthly_to": info["CHN-SC"]["last"], "has_country_page": True})
    _write("countries.json", {"generated_at": gen_at, "sources": ["ember_yearly", "ember_monthly", "ember_china", "gppd"],
                              "countries": clist,
                              "notes": ["Tier 1 = Ember monthly generation forecast (23 countries + Sichuan); tier 2 = reservoir forecast (Zambia, Zimbabwe via Lake Kariba, see kariba.json); tier 3 = trend and ENSO exposure only.",
                                        "lat/lon = capacity-weighted centroid of WRI GPPD v1.3 hydro plants (2021; newer plants missing).",
                                        "has_country_page is true only where country/{ISO3}.json exists (tier 1)."]})

    limitations = [
        "Ember monthly records mostly start in 2015-2019 (2000 for Iceland, 2010 for Canada, Georgia, New Zealand), and the anomaly needs 2 earlier years of the same calendar month, so most countries have labels only from 2021: few independent drought events, and wide confidence intervals.",
        "Hydro capacity is yearly (Ember), treated as a mid-year value and interpolated; capacity for the latest year is carried forward (Viet Nam, Sri Lanka, Iceland, Kyrgyzstan, El Salvador lack 2025 capacity). Capacity revisions (e.g. Kyrgyzstan 3.67 -> 2.78 GW in 2021) show up as jumps in capacity factor.",
        "Hydro output partly reflects operator decisions (reservoir management, exports, curtailment, market prices) and demand, not just water. Small run-of-river systems (Bosnia, Croatia, Latvia, Montenegro) swing a lot month to month and dominate the shortfall count.",
        "The normal is an expanding median of only earlier years; in short records it is set by 2-4 years. Brazil's 2021 normal comes from 2018-2020, which were themselves dry, so the 2021 anomaly is understated.",
        "Sichuan has no provincial capacity series; its anomaly uses generation rescaled by the previous year's total. The monthly data does not show the two-week August 2022 crisis (Aug 2022 is near normal; Sep 2022 about -13%). The sampling box for Sichuan also covers some Yunnan/Tibet/Chongqing plants.",
        "Climate inputs are sampled at up to 8 capacity-weighted 1-degree cells near the plants (GPPD 2021; newer plants such as Coca Codo Sinclair missing), not over full upstream catchments. GRACE (~300 km) is too coarse for small Andean or Balkan basins.",
        "Rainfall: NASA POWER (MERRA-2) point rainfall has artificial breaks at plant points (Colombia annual rain ~30% of GPCP in 2008 and 2021; Viet Nam's POWER/GPCP ratio jumps from ~0.6 to ~1.1 in 2016-17), so the rain features use GPCP v2.3 (NASA GSFC/GEWEX satellite-gauge merge, 2.5 deg, anomalies vs 1981-2010). A swap ablation reports the model with POWER rain instead. GPCP's 2.5 deg cells are coarse for Andean and Balkan basins.",
        "NASA POWER root-zone/surface wetness and temperature inherit the same MERRA-2 breaks (e.g. Colombia 2021 root-zone -2.4 SD, Viet Nam +2 SD from 2017). They are standardized against a trailing 10-year same-month baseline, which absorbs step changes after a few years but not one-off artefacts like Colombia 2021. They stand in for SMAP, which needs an Earthdata login.",
        "Blocked leave-one-year-out CV trains on years after the test year too; expanding normals for those later years include the test year's labels (mild leakage). The strictly forward 2024+ test avoids this but is small.",
        "The alarm threshold and crisis lead times are chosen and measured on the same out-of-fold predictions, so they are optimistic. The five crises are illustrations; the skill table is the main test.",
        "Ember's publication lag varies by country (some are 1 month behind, some 3+). The backtest assumes a 2-month lag (falling back to 3 when t-2 is unpublished, as for Brazil, Canada, Ecuador and Nigeria now); Kyrgyzstan, Sri Lanka, El Salvador and Switzerland have older data, so their live forecasts have no persistence input.",
        "Cost estimates are rough and labelled as such: fixed 20 c/kWh replacement, VoLL $1.00/kWh on 10% of the deficit, no import or demand response modelling.",
    ]
    thr_table = [{"threshold": t, "calm_alarm_months": f, "calm_months": nc, "hit_rate_any6": _r(hr, 3),
                  "false_alarms_per_country_5yr": _r(rt, 3)} for t, f, nc, hr, rt in table if t in (0.2, 0.3, 0.4, 0.5, 0.6, 0.7, thr)]
    bh = bt["by_horizon"]
    labelled = D[(D["horizon"] == 1) & D["y_short"].notna()]
    _write("generation_backtest.json", {
        "generated_at": gen_at, "sources": ["ember_monthly", "ember_yearly", "ember_china", "gravis", "gpcp", "power", "oni", "gppd"],
        "design": ("Blocked leave-one-year-out CV with a 12-month gap on each side (test year Y; train on target months outside "
                   "[Y-1, Y+1]); pooled LightGBM across tier-1 grids (23 countries + Sichuan); one classifier and three "
                   "quantile regressors per horizon; isotonic calibration cross-fitted on out-of-fold predictions; features "
                   "respect publication lags (Ember t-2, GRACE t-3, GPCP rain and POWER soil/temperature t-1, ONI t-1); grid-history features (shortfall rate, anomaly spread) use only labels observed by t-2. Plus a strictly forward test "
                   "(train on targets <= 2023-11, test targets 2024-01 onward)."),
        "target": {"definition": "monthly hydro capacity factor (TWh / (Ember yearly GW interpolated x hours)) vs the median of the same calendar month in earlier years only (>= 2 years)",
                   "shortfall_pct": G.SHORTFALL_PCT, "severe_pct": G.SEVERE_PCT,
                   "threshold_check": sanity,
                   "threshold_decision": "Kept -15% / -30%. Vietnam May-Jun 2023 and Ecuador Sep-Dec 2024 register clearly; Ecuador late 2023 and Brazil mid-2021 register in part (Brazil's normal is set by already-dry 2018-2020); Sichuan Aug 2022 does not register in monthly data (a two-week event plus heat-driven demand). Loosening to -10% would roughly double the base rate to catch two borderline months, so we kept the design thresholds and report the misses."},
        "n_countries": len(countries), "countries": countries,
        "n_country_months": int(len(labelled)), "base_rate_shortfall": round(float(labelled["y_short"].mean()), 3),
        "base_rate_severe": round(float(labelled["y_severe"].mean()), 3),
        "by_horizon": bh,
        "by_horizon_uncalibrated": bt["by_horizon_raw"],
        "by_horizon_isotonic": bt["by_horizon_isotonic"],
        "calibration_note": "Primary probabilities (by_horizon) blend the LightGBM probability with the climatology prior in a logistic stack, cross-fitted on out-of-fold predictions. We added this after a first run showed LightGBM alone (isotonic-calibrated) ranked shortfalls slightly worse than climatology beyond 1 month; both versions are reported.",
        "severe_by_horizon": bt["severe"],
        "forward_test": {"train": "targets <= 2023-11", "test": "targets >= 2024-01", "by_horizon": bt["forward"]},
        "reliability": bt["reliability"],
        "ablations": abl,
        "ablation_note": "Each NASA input group is removed in turn and the h=3 classifier is refit in the same blocked CV (uncalibrated probabilities). Negative delta = the input helps. CI from 500 country-year bootstrap resamples.",
        "feature_importance": fi, "feature_importance_by_group": fig,
        "feature_importance_note": "Gain share in the final (all-data) shortfall classifiers, averaged over horizons 1-6.",
        "alarm": {"definition": "P(any shortfall in t+1..t+6), separate LightGBM classifier, out-of-fold by issue year with a +/-1 year gap, blended with the country x month climatology prior by a cross-fitted logistic stack. Note the event is common (base rate ~45%), because monthly anomalies are noisy and 6 chances to cross -15% is a lot",
                  "threshold": thr,
                  "threshold_rule": f"Lowest threshold (grid 0.05-0.95) giving <= {ALARM_MAX_FALSE_PER_5Y:g} false alarm per country per 5 calm years. Calm issue months have no observed shortfall in the next 6 months. An alarm covers a 6-month window, so 6 alarm-months in calm periods count as one false alarm: rate = (calm alarm-months / 6) / (calm months / 60). Equivalent to a false-positive rate of <= 10% on calm months.",
                  "false_alarms_per_country_5yr": _r(chosen[4], 3), "calm_alarm_months": chosen[1], "calm_months": chosen[2],
                  "hit_rate_any6": _r(chosen[3], 3), "threshold_table": thr_table, **alarm_stats},
        "crisis_leads": leads,
        "limitations": limitations, "notes": notes,
        "runtime_s": round(time.time() - t0, 1),
    })
    log("done")


if __name__ == "__main__":
    main()
