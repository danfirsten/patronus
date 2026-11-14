"""Pre-registered robustness test (specified by the coordinator after the primary analysis, before results were seen).

Hypothesis: monthly anomalies are too noisy; a seasonal target is more predictable and closer to decisions.
Target: mean capacity-factor anomaly over a 3-month window <= -15% (all 3 months observed).
  window "next_season":       t+1..t+3  (features = the horizon-2 rows, i.e. target month = window centre)
  window "season_after":      t+4..t+6  (features = the horizon-5 rows)
Same features, folds (blocked LOYO with +/-1 year gap, forward test), baselines and logistic stacking as the
primary monthly analysis. No tuning.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline import gen_data as G
from pipeline import gen_model as M

WINDOWS = {"next_season": (2, 1, 3), "season_after": (5, 4, 6)}  # name: (feature horizon, first k, last k)


def seasonal_labels(D: pd.DataFrame, lab: pd.DataFrame) -> pd.DataFrame:
    D = D.copy()
    for name, (hf, k0, k1) in WINDOWS.items():
        D[f"y_{name}"] = np.nan
        D[f"anom_{name}"] = np.nan
    for iso, L in lab.groupby("iso3"):
        a = L.set_index("month")["anom_pct"]
        for name, (hf, k0, k1) in WINDOWS.items():
            m = (D["iso3"] == iso) & (D["horizon"] == hf)
            t = pd.PeriodIndex(D.loc[m, "issue"])
            vals = np.column_stack([a.reindex(t + k).values for k in range(k0, k1 + 1)])
            mean = np.where(np.isnan(vals).any(axis=1), np.nan, vals.mean(axis=1))
            D.loc[m, f"anom_{name}"] = mean
            D.loc[m, f"y_{name}"] = np.where(np.isnan(mean), np.nan, (mean <= G.SHORTFALL_PCT).astype(float))
    return D


def _ablate(d, ycol, full_raw, log, name):
    y = d[ycol].values.astype(float)
    nasa = (G.FEATURE_GROUPS["gravis"] + G.FEATURE_GROUPS["gpcp_precip"] + G.FEATURE_GROUPS["power_soil"]
            + G.FEATURE_GROUPS["power_temp"])
    out = []
    for gname, cols in (("gravis", G.FEATURE_GROUPS["gravis"]), ("all_nasa (gravis+gpcp+power)", nasa)):
        p = M.oof_classifier(d, [f for f in G.FEATURES if f not in cols], ycol)
        ok = ~np.isnan(p) & ~np.isnan(full_raw)
        a_full, a = M.auc_pr(full_raw[ok], y[ok]), M.auc_pr(p[ok], y[ok])

        def fn(idx, p=p, ok=ok):
            yy = y[ok][idx]
            f, g = M.auc_pr(full_raw[ok][idx], yy), M.auc_pr(p[ok][idx], yy)
            return None if f is None or g is None else g - f

        bs = M.cluster_bootstrap(d.loc[ok, "cluster"].values, fn, 500)
        out.append({"removed": gname, "window": name, "auc_pr": M._r(a), "auc_pr_full": M._r(a_full),
                    "delta_vs_full": M._r(a - a_full), "delta_ci90": M.ci90(bs)})
        log(f"    ablate {gname}: AUC-PR {a:.3f} vs full {a_full:.3f}")
    return out


def run(D: pd.DataFrame, lab: pd.DataFrame, countries: list[str], issue: pd.Period, log,
        false_alarm_fn, crisis_fn):
    feats = G.FEATURES
    DS = seasonal_labels(D, lab)
    res = {"definition": ("Pre-registered robustness test: shortfall = mean hydro capacity-factor anomaly over a 3-month "
                          "window <= -15%. next_season = months t+1..t+3, season_after = t+4..t+6 (t = issue month). "
                          "Same features (taken at the window's centre month, i.e. horizon 2 and 5 rows), same blocked "
                          "leave-one-year-out folds (fold year = centre month's year), same baselines, same logistic "
                          "stacking with climatology; no tuning."),
           "by_window": [], "forward_test": [], "ablations": [], "qualifies": {}}
    oof = {}
    live = {}
    for name, (hf, k0, k1) in WINDOWS.items():
        ycol = f"y_{name}"
        d = DS[(DS["horizon"] == hf) & DS[ycol].notna()].reset_index(drop=True)
        y = d[ycol].values.astype(float)
        raw = M.oof_classifier(d, feats, ycol)
        base = M.oof_baselines(d, ycol, countries)
        cal = M.crossfit_stack(raw, base["climatology"], y, d["tyear"].values)
        ok = ~np.isnan(cal) & np.all([~np.isnan(v) for v in base.values()], axis=0)
        mh = M.horizon_metrics(cal[ok], {k: v[ok] for k, v in base.items()}, y[ok], d.loc[ok, "cluster"].values)
        mh.update({"window": name, "months": f"t+{k0}..t+{k1}"})
        lo = (mh.get("auc_pr_minus_climatology_ci90") or [None])[0]
        res["qualifies"][name] = bool(lo is not None and lo > 0)
        res["by_window"].append(mh)
        log(f"  seasonal {name}: n={ok.sum()} base {mh['base_rate']} AUC-PR {mh['auc_pr']} (clim {mh['auc_pr_climatology']}, "
            f"diff CI {mh['auc_pr_minus_climatology_ci90']}) BSS clim {mh['bss_vs_climatology']} {mh['bss_vs_climatology_ci90']} "
            f"pers {mh['bss_vs_persistence']} enso {mh['bss_vs_enso_only']}")
        oof[name] = d.assign(p=cal, p_raw=raw, clim=base["climatology"])
        res["ablations"] += _ablate(d, ycol, raw, log, name)
        # forward test
        tr = d["target"] + (k1 - hf) <= pd.Period("2023-11", "M")  # whole window observed by a 2024-01 issue
        te = d["target"] - (hf - k0) >= pd.Period("2024-01", "M")
        dtr, dte = d[tr].reset_index(drop=True), d[te].reset_index(drop=True)
        ytr, yte = dtr[ycol].values.astype(float), dte[ycol].values.astype(float)
        m = M.fit_clf(dtr[feats], ytr)
        inner = M.oof_classifier(dtr, feats, ycol)
        inner_clim = M.oof_baselines(dtr, ycol, countries)["climatology"]
        okk = ~np.isnan(inner) & ~np.isnan(inner_clim)
        clim_te = M.Climatology().fit(dtr, ytr).predict(dte)
        p_te = M.Stacker().fit(inner[okk], inner_clim[okk], ytr[okk]).predict(m.predict_proba(dte[feats])[:, 1], clim_te)
        yb = {"climatology": clim_te, "persistence": M.Persistence().fit(dtr, ytr).predict(dte),
              "enso_only": M.EnsoOnly(countries).fit(dtr, ytr).predict(dte)}
        fm = M.horizon_metrics(p_te, yb, yte, dte["cluster"].values, n_boot=500)
        fm.update({"window": name})
        res["forward_test"].append(fm)
        log(f"    forward: n={len(yte)} AUC-PR {fm['auc_pr']} (clim {fm['auc_pr_climatology']}) BSS clim {fm['bss_vs_climatology']}")
        # final model for live use
        okc = ~np.isnan(raw) & ~np.isnan(base["climatology"])
        stk = M.Stacker().fit(raw[okc], base["climatology"][okc], y[okc])
        clf = M.fit_clf(d[feats], y)
        clim_all = M.Climatology().fit(d, y)
        q = [M.fit_qr(d[feats], d[f"anom_{name}"].values, a) for a in M.QUANTILES]
        rows = DS[(DS["horizon"] == hf) & (DS["issue"] == issue)]
        for r in rows.itertuples():
            X = rows.loc[[r.Index], feats].astype(float)
            p = float(stk.predict(clf.predict_proba(X)[:, 1], clim_all.predict(rows.loc[[r.Index]]))[0])
            qs = sorted(float(qq.predict(X)[0]) for qq in q)
            live.setdefault(r.iso3, {})[name] = {
                "months": f"{issue + k0}..{issue + k1}", "p_shortfall": round(p, 3),
                "anomaly_p10_pct": round(qs[0], 1), "anomaly_p50_pct": round(qs[1], 1), "anomaly_p90_pct": round(qs[2], 1)}

    # crisis catches with the same false-alarm rule: alarm prob = max(P next_season, P season_after) at issue t;
    # calm issue month = neither window has a seasonal shortfall
    a = oof["next_season"][["iso3", "issue", "p", "y_next_season"]].merge(
        oof["season_after"][["iso3", "issue", "p", "y_season_after"]], on=["iso3", "issue"], how="inner", suffixes=("_a", "_b"))
    a["p_any"] = a[["p_a", "p_b"]].max(axis=1)
    a["y_any6"] = ((a["y_next_season"] == 1) | (a["y_season_after"] == 1)).astype(float)
    chosen, table = false_alarm_fn(a)
    thr = chosen[0]
    leads = crisis_fn(a, thr, lab)
    for c in leads:
        c.pop("observed_anomaly_around_onset", None)
        log(f"    seasonal crisis {c['id']}: alarm {c['alarm_month']} lead {c['lead_months']}")
    res["alarm"] = {"definition": "P(alarm) = max(P next_season, P season_after) at issue t; calm issue month = no seasonal shortfall in either window; same <= 1 false alarm per country per 5 calm years rule as the primary analysis",
                    "threshold": thr, "false_alarms_per_country_5yr": M._r(chosen[4]), "calm_alarm_months": chosen[1],
                    "calm_months": chosen[2], "hit_rate": M._r(chosen[3]), "base_rate": round(float(a["y_any6"].mean()), 3)}
    res["crisis_leads"] = leads
    return res, live
