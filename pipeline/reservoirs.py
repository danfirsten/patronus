"""Global reservoir watch: the Kariba 'next' method applied to every major hydro reservoir in G-REALM.

    python3 -m pipeline.reservoirs        -> web/public/data/reservoirs.json

Method (fixed before any crisis was scored; see docs/RESERVOIRS.md):
  1. Monthly satellite lake level (NASA/USDA G-REALM 10-day altimetry).
  2. Target: the level against its own same-calendar-month history from earlier years only.
     warning = below the 20th percentile, danger = below the 10th percentile.
  3. ENSO sensitivity: wet-season level change (lake's own low month -> high month) in El Nino vs
     other seasons and La Nina vs other seasons (mean ONI over the wet-season months), two-sided
     permutation tests.
  4. Forecast: analog ensemble of historical 12-month level changes added to the current level
     (capped at the highest level seen). Analogs are phase-conditioned (by the ONI known at issue)
     only when step 3, computed from past seasons only, gives p < 0.1 for that phase; otherwise
     all past years (climatology analogs).
  5. Strictly forward backtest, issued monthly, horizons 1-12; scores from Jan 2000.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score

from pipeline import kariba_data as K
from pipeline import reservoir_model as M
from pipeline.paths import OUT, RAW
from pipeline.reservoir_catalog import LAKES, VALID_FROM, match_plants
from pipeline.reservoir_crises import CRISES, NOT_SCORABLE

ISSUE = pd.Timestamp("2026-11-01")     # live forecast issued 2026-11-15, data through Oct 2026
SCORE_FROM = pd.Timestamp("2000-01-01")
BT_FROM = pd.Timestamp("1998-01-01")
H = 12


def r(x, n=2):
    if x is None:
        return None
    try:
        if np.isnan(x):
            return None
    except TypeError:
        return x
    return round(float(x), n)


def mstr(t):
    return None if t is None else pd.Timestamp(t).strftime("%Y-%m")


def months_between(a, b):
    a, b = pd.Timestamp(a), pd.Timestamp(b)
    return (b.year - a.year) * 12 + (b.month - a.month)


# --------------------------------------------------------------------------------------
# Per-lake backtest
# --------------------------------------------------------------------------------------
def run_lake(L: pd.Series, oni: pd.Series):
    """Monthly issues from BT_FROM to ISSUE. The wet season and the ENSO gate are recomputed each
    January from data before that January (strictly forward)."""
    rows, fc_by_issue = [], {}
    cache = {}
    last_obs = L.dropna().index.max()
    for t in pd.date_range(BT_FROM, ISSUE, freq="MS"):
        yr = t.year
        if yr not in cache:
            past = L[L.index < pd.Timestamp(yr, 1, 1)]
            lo, hi, _, _ = M.seasonal_cycle(past)
            if lo is None or past.dropna().size < 36:
                cache[yr] = None
            else:
                sens, _ = M.enso_sensitivity(past, oni, lo, hi, n_perm=2000, seed=yr)
                cache[yr] = (M.wet_months(lo, hi), M.gate(sens))
        if cache[yr] is None:
            continue
        wet, gates = cache[yr]
        f = M.forecast(L, t, oni, wet, gates, H)
        if f is None:
            continue
        f["gates"] = gates
        fc_by_issue[t] = f
        for j, m in enumerate(f["targets"]):
            obs = L.get(m, np.nan) if m <= last_obs else np.nan
            ev = (float(obs < f["q20"][j]) if not np.isnan(obs) and not np.isnan(f["q20"][j]) else np.nan)
            evd = (float(obs < f["q10"][j]) if not np.isnan(obs) and not np.isnan(f["q10"][j]) else np.nan)
            rows.append({"issue": t, "h": j + 1, "target": m, "p_warn": f["p_warn"][j], "p_danger": f["p_danger"][j],
                         "clim": f["clim"][j], "persist": f["persist"], "persist_danger": f["persist_danger"],
                         "obs": ev, "obs_danger": evd, "pool_type": f["pool_type"]})
    return pd.DataFrame(rows), fc_by_issue


def brier_block(d: pd.DataFrame):
    d = d.dropna(subset=["p_warn", "obs", "clim", "persist"])
    if len(d) < 20:
        return None
    y = d["obs"].values
    b = np.mean((d["p_warn"] - y) ** 2)
    bc = np.mean((d["clim"] - y) ** 2)
    bp = np.mean((d["persist"] - y) ** 2)
    out = {"n": int(len(d)), "base_rate": r(y.mean(), 3), "brier": r(b, 4), "brier_climatology": r(bc, 4),
           "brier_persistence": r(bp, 4), "bss_vs_climatology": r(1 - b / bc, 3) if bc > 0 else None,
           "bss_vs_persistence": r(1 - b / bp, 3) if bp > 0 else None, "auc_pr": None, "auc_pr_climatology": r(y.mean(), 3)}
    if 0 < y.sum() < len(y):
        out["auc_pr"] = r(average_precision_score(y, d["p_warn"].values), 3)
    return out


def by_horizon(bt: pd.DataFrame):
    bt = bt[bt["issue"] >= SCORE_FROM]
    out = []
    for h in range(1, H + 1):
        b = brier_block(bt[bt["h"] == h])
        if b:
            out.append({"horizon": h, **b})
    return out


def issue_alarms(fc: dict):
    """Alarm at issue t = max over the next 12 months of P(below warning) > 0.5 (Kariba's rule)."""
    s = {t: float(np.nanmax(f["p_warn"])) if np.isfinite(f["p_warn"]).any() else np.nan for t, f in fc.items()}
    return pd.Series(s).sort_index()


def warning_status(L: pd.Series):
    pc = M.expanding_percentile(L)
    below = (L < pc["q20"]).where(pc["q20"].notna() & L.notna())
    return pc, below


def episodes(L, below: pd.Series, alarm_p: pd.Series):
    """Observed warning episodes (onset = first month below warning after >= 3 months not below)
    and false-alarm runs, from SCORE_FROM."""
    b = below.dropna()
    onsets = []
    prev = []
    for t, v in b.items():
        if v == 1 and len(prev) >= 3 and all(x == 0 for x in prev[-3:]):
            onsets.append(t)
        prev.append(v)
    alarm = (alarm_p > 0.5)
    res = []
    for o in onsets:
        if o < SCORE_FROM:
            continue
        win = alarm[(alarm.index >= o - pd.DateOffset(months=12)) & (alarm.index <= o - pd.DateOffset(months=1))]
        avail = alarm_p[(alarm_p.index >= o - pd.DateOffset(months=12)) & (alarm_p.index <= o - pd.DateOffset(months=1))].notna().sum()
        if avail == 0:
            res.append({"onset": mstr(o), "outcome": "not_scorable", "lead_months": None})
            continue
        first = win[win].index.min() if win.any() else None
        res.append({"onset": mstr(o), "outcome": "hit" if first is not None else "miss",
                    "lead_months": months_between(first, o) if first is not None else None,
                    "first_alarm": mstr(first)})
    # false-alarm runs: consecutive alarm issues that start when the lake is not already below
    # warning, with no observed month below warning from the run start to 11 months after its end
    fa, runs = 0, []
    a = alarm[alarm.index >= SCORE_FROM]
    run = []
    last_obs = b.index.max()
    for t, v in list(a.items()) + [(None, False)]:
        if v:
            run.append(t)
            continue
        if run:
            st, en = run[0], run[-1]
            cur = below.get(st - pd.DateOffset(months=1), np.nan)
            wend = en + pd.DateOffset(months=11)
            if cur != 1 and wend <= last_obs:
                hit = b[(b.index >= st) & (b.index <= wend)]
                if (hit == 1).sum() == 0:
                    fa += 1
                    runs.append({"from": mstr(st), "to": mstr(en)})
            run = []
    return res, fa, runs


def seasons(L, fc: dict, below: pd.Series, oni: pd.Series, lo: int):
    """Season tiles (Kariba vocabulary): season Y = 9 months ending at the lake's climatological low
    month in Y; issues 11, 10 and 9 months before that low month; alarm if any issue's max P(warning)
    over the season months > 0.5; event if any observed season month is below warning."""
    out = []
    last_obs = below.dropna().index.max()
    for Y in range(2000, 2027):
        lowm = pd.Timestamp(Y, lo, 1)
        win = pd.date_range(lowm - pd.DateOffset(months=8), lowm, freq="MS")
        if win[-1] > last_obs:
            continue
        issues = [lowm - pd.DateOffset(months=k) for k in (11, 10, 9)]
        ps = []
        for t in issues:
            f = fc.get(t)
            if f is None:
                continue
            idx = [j for j, m in enumerate(f["targets"]) if m in win]
            v = f["p_warn"][idx]
            if np.isfinite(v).any():
                ps.append(float(np.nanmax(v)))
        obs = below.reindex(win).dropna()
        if not ps or len(obs) < 6:
            continue
        alarm, event = max(ps) > 0.5, bool((obs == 1).any())
        ov = oni.reindex(pd.date_range(lowm - pd.DateOffset(months=11), lowm, freq="MS")).values
        enso = M.oni_class(float(np.nanmean(ov)) if np.isfinite(ov).any() else np.nan)
        out.append({"season": Y, "window": f"{mstr(win[0])}..{mstr(win[-1])}", "enso": enso,
                    "p_max": r(max(ps), 2), "event": event,
                    "outcome": "hit" if alarm and event else "miss" if event else "false_alarm" if alarm else "correct_quiet"})
    return out


# --------------------------------------------------------------------------------------
# Live forecast
# --------------------------------------------------------------------------------------
def live_block(L, f, lake_id):
    months = []
    for j, m in enumerate(f["targets"]):
        v = f["members"][:, j]
        row = {"month": mstr(m), "horizon": j + 1, "p_warning": r(f["p_warn"][j], 3), "p_danger": r(f["p_danger"][j], 3),
               "level_p10": r(np.quantile(v, .1)), "level_p50": r(np.quantile(v, .5)), "level_p90": r(np.quantile(v, .9)),
               "warning_level_m": r(f["q20"][j]), "danger_level_m": r(f["q10"][j]),
               "percentile_p50": r(M.member_percentile(float(np.quantile(v, .5)), f["base"][m.month]), 0)}
        if lake_id == "kariba":
            for q in ("p10", "p50", "p90"):
                row[f"usable_{q}_pct"] = r(float(K.level_to_pct(row[f"level_{q}"])), 1)
        months.append(row)
    members = []
    endm = f["targets"][-1]
    for c, path in zip(f["pool"], f["members"]):
        e = float(path[-1])
        members.append({"year": c["year"], "analog_start": mstr(c["base"] + pd.DateOffset(months=1)), "enso": c["enso"],
                        "end_month": mstr(endm), "end_value_level_m": r(e),
                        "end_percentile": r(M.member_percentile(e, f["base"][endm.month]), 0),
                        "below_warning": bool(e < f["q20"][-1]) if np.isfinite(f["q20"][-1]) else None,
                        "below_danger": bool(e < f["q10"][-1]) if np.isfinite(f["q10"][-1]) else None,
                        "below_warning_any_month": bool(np.any(path < f["q20"])),
                        "below_danger_any_month": bool(np.any(path < f["q10"]))})
    pw = np.nan_to_num(f["p_warn"], nan=0)
    pdg = np.nan_to_num(f["p_danger"], nan=0)
    pmax = float(pw.max())
    level = "low" if pmax < 0.2 else "watch" if pmax < 0.4 else "warning" if pmax < 0.6 else "danger"
    return {"issued": "2026-11-15", "data_through": mstr(f["s0"]), "start_level_m": r(f["level0"]),
            "enso_at_issue": {"oni": r(f["oni_at_issue"]), "class": f["phase"], "season": "ASO 2026"},
            "analogs": f["pool_type"], "analog_note": f["pool_note"], "n_members": len(f["pool"]),
            "n_candidate_years": f["n_candidates"],
            "max_p_warning": r(pmax, 3), "max_p_danger": r(float(pdg.max()), 3),
            "p_warning_any_month": r(float(np.mean([m["below_warning_any_month"] for m in members])), 3),
            "p_danger_any_month": r(float(np.mean([m["below_danger_any_month"] for m in members])), 3),
            "risk_level": level, "months": months, "members": members}


# --------------------------------------------------------------------------------------
def crisis_rows(lake_ctx):
    rows = []
    for c in CRISES:
        o = pd.Timestamp(c["onset"]).to_period("M").to_timestamp()
        ow = pd.Timestamp(c["official_warning"]).to_period("M").to_timestamp() if c["official_warning"] else None

        def score(lid):
            ctx = lake_ctx.get(lid)
            if ctx is None:
                return {"reservoir_id": lid, "caught": None, "note": "reservoir not in the watch"}
            ap = ctx["alarm_p"]
            win = ap[(ap.index >= o - pd.DateOffset(months=12)) & (ap.index <= o)]
            pct = ctx["pct"]["pct"]
            pct_onset = pct.get(o, np.nan)
            mn = pct[(pct.index >= o - pd.DateOffset(months=3)) & (pct.index <= o + pd.DateOffset(months=6))]
            info = {"reservoir_id": lid, "percentile_at_onset": r(pct_onset, 0),
                    "min_percentile_onset_minus3_to_plus6": r(mn.min(), 0) if mn.notna().any() else None,
                    "max_p_warning_12m_before_onset": r(win.max(), 2) if win.notna().any() else None}
            if win.notna().sum() == 0:
                return {**info, "caught": None, "alarm": None, "lead_months": None, "note": "no forecasts in the 12 months before onset (data gap)"}
            al = win[win > 0.5]
            first = al.index.min() if len(al) else None
            # baseline for comparison: persistence alarm = lake already below warning in the month before issue
            bl = ctx["below"]
            pers = [t for t in win.index if bl.get(t - pd.DateOffset(months=1), np.nan) == 1]
            pf = pers[0] if pers else None
            info["persistence_alarm"] = mstr(pf)
            info["persistence_lead_months"] = months_between(pf, o) if pf is not None else None
            info["persistence_caught"] = bool(pf is not None and months_between(pf, o) >= 1)
            if first is not None:
                # walk back: is the alarm part of a run already in force before the 12-month window?
                st = first
                while (st - pd.DateOffset(months=1)) in ap.index and ap[st - pd.DateOffset(months=1)] > 0.5:
                    st = st - pd.DateOffset(months=1)
                info["alarm_in_force_since"] = mstr(st)
                b0 = ctx["below"].get(first - pd.DateOffset(months=1), np.nan)
                info["lake_below_warning_when_alarm_issued"] = None if np.isnan(b0) else bool(b0)
            lead = months_between(first, o) if first is not None else None
            caught = bool(first is not None and lead >= 1)
            return {**info, "caught": caught, "alarm": mstr(first), "lead_months": lead,
                    "lead_vs_official_months": months_between(first, ow) if (first is not None and ow is not None) else None}
        main = score(c["reservoir_id"])
        also = [score(x) for x in c["also"]]
        rows.append({"id": c["id"], "name": c["name"], "reservoir_id": c["reservoir_id"], "countries": c["countries"],
                     "enso": c["enso"], "official_warning": c["official_warning"], "official_warning_what": c["official_warning_what"],
                     "onset": c["onset"], "onset_what": c["onset_what"], "date_precision": c["date_precision"],
                     "alarm": main.get("alarm"), "model": "next: ENSO-gated analog ensemble of lake-level changes",
                     "lead_months": main.get("lead_months"), "lead_vs_official_months": main.get("lead_vs_official_months"),
                     "caught": main.get("caught"),
                     "outcome": ("not_scorable" if main.get("caught") is None else "caught" if main["caught"]
                                 else "late" if main.get("alarm") else "missed"),
                     "lake_signal": {k: main.get(k) for k in ("percentile_at_onset", "min_percentile_onset_minus3_to_plus6",
                                                              "max_p_warning_12m_before_onset", "alarm_in_force_since",
                                                              "lake_below_warning_when_alarm_issued")},
                     "alarm_type": (None if not main.get("alarm") else "state: lake already below warning" if main.get("lake_below_warning_when_alarm_issued")
                                    else "forecast: lake not yet below warning"),
                     "persistence_baseline": {k: main.get(k) for k in ("persistence_alarm", "persistence_lead_months", "persistence_caught")},
                     "note": main.get("note"), "other_reservoirs": also, "sources": c["sources"]})
    return rows


def main():
    t0 = time.time()
    oni = K.load_oni()
    notes = []
    lakes_out, lake_ctx, all_bt = [], {}, []
    for lid, gid, name, countries, dams, cascade, note in LAKES:
        vf = VALID_FROM.get(lid)
        df, info = M.lake_monthly(gid, vf[0] if vf else None)
        L = df["level_m"]
        pc, below = warning_status(L)
        lo, hi, amp, cyc = M.seasonal_cycle(L)
        sens, st = M.enso_sensitivity(L, oni, lo, hi, n_perm=20000, seed=1)
        g = M.gate(sens)
        bt, fc = run_lake(L, oni)
        alarm_p = issue_alarms(fc)
        eps, n_fa, fa_runs = episodes(L, below, alarm_p)
        seas = seasons(L, fc, below, oni, lo)
        lake_ctx[lid] = {"alarm_p": alarm_p, "pct": pc, "below": below}
        bt["lake"] = lid
        all_bt.append(bt)
        dam_p, miss1 = match_plants(dams)
        cas_p, miss2 = match_plants(cascade)
        if miss1 or miss2:
            notes.append(f"{lid}: GPPD plants not found: {miss1 + miss2}")
        mw = sum(p["mw"] for p in dam_p) if dam_p else None
        lat, lon = None, None
        txt = (RAW / "grealm" / f"lake{gid}.10d.2.txt").read_text(errors="ignore").splitlines()
        try:
            lat, lon = (float(x) for x in txt[2].split()[:2])
        except Exception:
            pass
        # latest
        Lv = L.dropna()
        lm = Lv.index.max()
        past_same = Lv[(Lv.index.month == lm.month) & (Lv.index < lm)]
        latest = {"date": info["last_pass"], "level_m": info["last_pass_level_m"], "month": mstr(lm),
                  "month_level_m": r(Lv[lm]), "n_passes_in_month": int(df.loc[lm, "n_obs"]),
                  "percentile_same_month": r(pc.loc[lm, "pct"], 0),
                  "anomaly_m": r(Lv[lm] - past_same.median()) if len(past_same) >= M.MIN_BASE else None,
                  "below_warning": None if np.isnan(below.get(lm, np.nan)) else bool(below[lm]),
                  "n_years_baseline": int(len(past_same))}
        if lid == "kariba":
            latest["usable_pct"] = r(float(K.level_to_pct(Lv[lm])), 1)
        allm = Lv[Lv.index.month == lm.month]
        track = {"month": lm.month, "years": f"{allm.index.min().year}-{allm.index.max().year}", "n_years": int(len(allm)),
                 "min_level_m": r(allm.min()), "max_level_m": r(allm.max()),
                 "p10_level_m": r(np.quantile(past_same, .1)) if len(past_same) >= M.MIN_BASE else None,
                 "p20_level_m": r(np.quantile(past_same, .2)) if len(past_same) >= M.MIN_BASE else None,
                 "by_month": [{"month": cm, "min_level_m": r(Lv[Lv.index.month == cm].min()),
                               "p10_level_m": r(np.quantile(Lv[Lv.index.month == cm], .1)),
                               "p20_level_m": r(np.quantile(Lv[Lv.index.month == cm], .2)),
                               "median_level_m": r(Lv[Lv.index.month == cm].median()),
                               "max_level_m": r(Lv[Lv.index.month == cm].max())} for cm in range(1, 13)],
                 "note": "p10/p20 for the current month use earlier years only; by_month uses the whole record (display only)"}
        live = live_block(L, fc[ISSUE], lid) if ISSUE in fc else None
        if live is None:
            notes.append(f"{lid}: no live forecast (no level in the last 3 months or no complete analog years)")
        hist = []
        for t, v in L.items():
            if np.isnan(v):
                continue
            row = {"month": mstr(t), "level_m": r(v), "percentile": r(pc.loc[t, "pct"], 0)}
            if df.loc[t, "interp"]:
                row["interp"] = True
            if lid == "kariba":
                row["usable_pct"] = r(float(K.level_to_pct(v)), 1)
            hist.append(row)
        b_h = by_horizon(bt)
        nh = sum(e["outcome"] == "hit" for e in eps)
        nm = sum(e["outcome"] == "miss" for e in eps)
        lakes_out.append({
            "id": lid, "name": name, "grealm_id": gid, "iso3": countries[0], "countries": countries,
            "dams": dam_p, "cascade": cas_p, "mw": r(mw, 1), "cascade_mw": r(sum(p["mw"] for p in cas_p), 1) if cas_p else None,
            "lat": lat, "lon": lon, "note": note,
            "record": {"start": info["first_pass"], "end": info["last_pass"], "n_passes": info["n_passes"],
                       "n_months": info["n_months_with_data"], "spikes_removed": info["n_spikes_removed"],
                       "gaps_over_2_months": info["gaps"], "used_from": vf[0] if vf else None,
                       "used_from_reason": vf[1] if vf else None,
                       "datum": "m above EGM2008 geoid (satellite altimetry, not the operator's gauge datum; percentiles make the datum irrelevant)"},
            "seasonal_cycle": {"low_month": lo, "high_month": hi, "amplitude_m": r(amp), "mean_anomaly_by_month_m": cyc},
            "latest": latest, "history_percentile_track": track,
            "enso": {"definition": "Level change from the lake's mean low month to its mean high month (its own wet season); season class by the DJF ONI of the winter whose January is nearest the season midpoint (>= 0.5 El Nino, <= -0.5 La Nina), as in Kariba's enso block; two-sided permutation tests (20,000 shuffles) of El Nino vs other seasons and La Nina vs other seasons",
                     "wet_season_months": M.wet_months(lo, hi),
                     **{k: (r(v, 3) if isinstance(v, float) else v) for k, v in sens.items()},
                     "el_nino_years": [int(y) for y in st.loc[st["enso"] == "el_nino", "year"]] if len(st) else [],
                     "la_nina_years": [int(y) for y in st.loc[st["enso"] == "la_nina", "year"]] if len(st) else [],
                     "sensitive_el_nino": g["el_nino"], "sensitive_la_nina": g["la_nina"],
                     "class": ("both" if g["el_nino"] and g["la_nina"] else "el_nino_sensitive" if g["el_nino"]
                               else "la_nina_sensitive" if g["la_nina"] else "not_sensitive"),
                     "by_season": [{"year": int(x.year), "dlevel_m": r(x.dlevel_m), "djf_year": int(x.djf_year), "oni_djf": r(x.oni_djf), "enso": x.enso}
                                   for x in st.itertuples()] if len(st) else []},
            "backtest": {"n_issues": int(bt["issue"].nunique()), "first_issue": mstr(bt["issue"].min()) if len(bt) else None,
                         "by_horizon": b_h,
                         "share_issues_phase_analogs": r(float((bt.drop_duplicates("issue")["pool_type"] != "climatology").mean()), 3) if len(bt) else None,
                         "episodes": eps, "episodes_hit": nh, "episodes_missed": nm, "false_alarm_runs": n_fa,
                         "false_alarm_list": fa_runs, "seasons": seas,
                         "season_tally": {k: sum(s["outcome"] == k for s in seas) for k in ("hit", "miss", "false_alarm", "correct_quiet")}},
            "forecast": live,
            "history": hist,
        })
        print(f"{lid:14s} issues={bt['issue'].nunique():4d} eps hit/miss={nh}/{nm} fa={n_fa} "
              f"gate={g} live={live and live['max_p_warning']} [{time.time()-t0:.0f}s]", flush=True)

    BT = pd.concat(all_bt, ignore_index=True)
    pooled = by_horizon(BT)
    cr = crisis_rows(lake_ctx)
    scored = [c for c in cr if c["caught"] is not None]
    caught = [c for c in scored if c["caught"]]
    mw_total = sum(l["mw"] or 0 for l in lakes_out)
    cmw_total = sum(l["cascade_mw"] or 0 for l in lakes_out)
    ep_hit = sum(l["backtest"]["episodes_hit"] for l in lakes_out)
    ep_miss = sum(l["backtest"]["episodes_missed"] for l in lakes_out)
    ep_fa = sum(l["backtest"]["false_alarm_runs"] for l in lakes_out)
    p6 = next((p for p in pooled if p["horizon"] == 6), None)
    p3 = next((p for p in pooled if p["horizon"] == 3), None)
    p12 = next((p for p in pooled if p["horizon"] == 12), None)
    risky = sorted([l for l in lakes_out if l["forecast"]], key=lambda l: -l["forecast"]["max_p_warning"])
    top = [f"{l['name']} {round(100*l['forecast']['max_p_warning'])}%" for l in risky[:5]]
    leads = [c["lead_months"] for c in caught]
    n_fc = sum(1 for c in caught if c["alarm_type"].startswith("forecast"))
    n_pers = sum(1 for c in scored if c["persistence_baseline"]["persistence_caught"])
    hmax = 0
    for p in pooled:
        if (p["bss_vs_climatology"] or 0) > 0 and (p["bss_vs_persistence"] or 0) > 0:
            hmax = p["horizon"]
        else:
            break
    headline = (f"{len(lakes_out)} hydro reservoirs ({mw_total/1000:.0f} GW at the dams, {cmw_total/1000:.0f} GW more downstream) "
                f"watched from space. In a strictly forward backtest the method flagged {len(caught)} of {len(scored)} documented "
                f"crises before onset (median lead {int(np.median(leads)) if leads else 0} months, capped at 12); {n_fc} of those alarms came "
                f"before the lake had dropped below its warning level (a simple 'lake already low' rule flags {n_pers}). "
                f"Missed: {', '.join(c['name'] for c in scored if not c['caught'])}. "
                f"It beats climatology and persistence at 1-{hmax} months ahead.")
    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "issue_date": "2026-11-15",
        "sources": ["grealm", "oni", "gppd", "news"],
        "method": {
            "summary": __doc__.strip(),
            "target": "warning = monthly level below the 20th percentile of the same calendar month in earlier years; danger = below the 10th percentile. Percentiles use the lake's own satellite record, so the altimetry datum (EGM2008) cancels and no storage curve is needed.",
            "forecast": "Analog ensemble: current level + each past year's 12-month level change from the same calendar month, capped at the highest level seen. Phase-conditioned analogs (El Nino / La Nina / neutral seasons, by the ONI season ending the month before issue) only when the lake's wet-season ENSO test, recomputed each January from past seasons only, has p < 0.1 for that phase and at least 8 seasons; otherwise all past years. At least 3 analogs per phase pool, else all years.",
            "issue_convention": "Issue month t uses levels through month t-1 and the ONI season ending in t-1. Horizon h targets month t+h-1.",
            "baselines": "Climatology = share of earlier same-month levels below the threshold (about 0.2). Persistence = 1 if the latest month is below its own warning threshold, else 0.",
            "alarm_rule": "Alarm at an issue = P(below warning) > 0.5 in any of the next 12 months (Kariba's rule).",
            "episode_rule": "Observed warning episode onset = first month below warning after at least 3 months not below. Hit = an alarm issued 1-12 months before onset. False-alarm run = consecutive alarm issues starting while the lake is not below warning, with no month below warning from the run start to 11 months after its end.",
            "backtest": f"Strictly forward, issued monthly {mstr(BT_FROM)}..{mstr(ISSUE)}, scored on issues from {mstr(SCORE_FROM)} and observed targets only. Wet season, ENSO gate, thresholds and analogs all come from data before each issue.",
            "crisis_rule": "Crisis caught = first alarm in the 12 issues up to the onset month was issued before the onset month; lead = onset month - alarm month. Rule fixed before scoring; not tuned per crisis.",
        },
        "summary": {
            "n_reservoirs": len(lakes_out), "mw_at_dams": r(mw_total, 0), "mw_downstream_cascade": r(cmw_total, 0),
            "n_crises_scored": len(scored), "n_crises_caught": len(caught),
            "n_crises_missed": sum(1 for c in scored if not c["caught"]),
            "n_crises_not_scorable": len(cr) - len(scored) + len(NOT_SCORABLE),
            "n_crises_caught_by_forecast": sum(1 for c in caught if c["alarm_type"].startswith("forecast")),
            "n_crises_caught_while_already_low": sum(1 for c in caught if c["alarm_type"].startswith("state")),
            "n_crises_caught_by_persistence_baseline": sum(1 for c in scored if c["persistence_baseline"]["persistence_caught"]),
            "lead_note": "Leads are capped at 12 months by the scoring window.",
            "crisis_leads_months": {c["id"]: c["lead_months"] for c in caught},
            "median_lead_months": int(np.median(leads)) if leads else None,
            "episodes": {"hit": ep_hit, "missed": ep_miss, "false_alarm_runs": ep_fa},
            "pooled_skill": {"h3": p3, "h6": p6, "h12": p12},
            "most_at_risk": [{"id": l["id"], "name": l["name"], "max_p_warning": l["forecast"]["max_p_warning"],
                              "max_p_danger": l["forecast"]["max_p_danger"], "risk_level": l["forecast"]["risk_level"],
                              "current_percentile": l["latest"]["percentile_same_month"], "analogs": l["forecast"]["analogs"]}
                             for l in risky[:8]],
            "headline": headline,
            "headline_risk": "Highest live risk of falling below the warning level in the next 12 months: " + ", ".join(top) + ".",
        },
        "pooled_backtest": {"by_horizon": pooled, "n_lakes": int(BT["lake"].nunique())},
        "reservoirs": lakes_out,
        "crises": cr,
        "crises_not_scorable": NOT_SCORABLE,
        "limitations": [
            "Satellite altimetry level is not the operator's gauge level (different datum and point of measurement). Percentiles of the lake's own record avoid the datum problem, but a percentile is not a usable-storage fraction: a low percentile may still be well above minimum operating level, and vice versa.",
            "Percentile thresholds depend on the record length (5 to 33 years). Early in the record, and for lakes starting in 2008, the 10th and 20th percentiles rest on few years.",
            "Operations (release decisions, new upstream dams, rule curves) change level behaviour. Analogs assume past level changes are representative.",
            "Analogs add the past 12-month level change to today's level, capped at the highest level seen. This ignores the lake's shape (a metre is more water when the lake is full) and minimum-level operating limits.",
            "The ENSO outlook in backtests is the ONI known at issue (persistence), not an archived ENSO forecast; issues before an event develops (boreal spring) see the wrong phase.",
            "Several lakes have multi-year gaps (2002-2008 for lakes off the TOPEX/Jason track); no forecasts are made across gaps.",
            "Crisis dates come from news and official statements; several give only the month. Multi-reservoir crises are scored on one pre-chosen main reservoir.",
            "Lake Victoria and Lake Malawi levels drive run-of-river plants; Itaipu and Three Gorges levels are rule-driven and say little about drought.",
        ],
        "notes": notes,
        "runtime_s": None,
    }
    out["runtime_s"] = round(time.time() - t0, 1)

    def clean(o):
        if isinstance(o, dict):
            return {k: clean(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [clean(v) for v in o]
        if isinstance(o, (np.floating, float)):
            return None if not np.isfinite(o) else float(o)
        if isinstance(o, np.integer):
            return int(o)
        if isinstance(o, np.bool_):
            return bool(o)
        return o
    f = OUT / "reservoirs.json"
    f.write_text(json.dumps(clean(out), ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {f} ({f.stat().st_size/1e6:.2f} MB) in {time.time()-t0:.0f}s")
    print(headline)
    print(out["summary"]["headline_risk"])
    for p in pooled:
        print(p)
    for c in cr:
        print(c["id"], c["outcome"], c["alarm"], c["lead_months"], c["alarm_type"], c["persistence_baseline"])


if __name__ == "__main__":
    main()
