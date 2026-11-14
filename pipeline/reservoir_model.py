"""Level series, percentile targets, ENSO sensitivity and the analog ensemble for the reservoir watch.

Everything is computed from a lake's own G-REALM altimetry level. Because the target is a percentile
of the lake's own same-calendar-month history, the altimetry datum (EGM2008 geoid, not the
operator's gauge datum) cancels out: no storage curve or gauge offset is needed.

Conventions
  * Monthly level = mean of the valid 10-day passes in the month. Gaps of 1-2 months are filled by
    linear interpolation (flagged `interp`); longer gaps stay empty (e.g. the 2002-2008 gap for lakes
    not on the TOPEX/Jason ground track).
  * An issue in month t uses data through month t-1 (G-REALM passes are posted within days) and the
    ONI season ending in month t-1 (published in early month t). Horizon h = 1..12 targets months
    t .. t+11.
  * Thresholds for a target month = the 20th (warning) and 10th (danger) percentiles of the levels
    observed in that calendar month in all earlier years (np.quantile, linear). At least MIN_BASE years.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.kariba_reservoirs import read_grealm

MIN_BASE = 5          # years of same-month history needed for a threshold
MIN_POOL = 3          # minimum analog years in a phase pool
MIN_SEASONS_GATE = 8  # minimum wet seasons before the ENSO gate can open
GATE_P = 0.10
WARN_Q, DANGER_Q = 0.20, 0.10


# --------------------------------------------------------------------------------------
# Level series
# --------------------------------------------------------------------------------------
def clean_passes(d: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """Drop isolated spikes: |level - centred 7-pass rolling median| > max(4 robust SD, 1.0 m)."""
    d = d.sort_values("date").drop_duplicates("date").reset_index(drop=True)
    med = d["level_m"].rolling(7, center=True, min_periods=3).median()
    r = d["level_m"] - med
    sig = 1.4826 * np.nanmedian(np.abs(r))
    bad = np.abs(r) > max(4 * sig, 1.0)
    return d[~bad].reset_index(drop=True), int(bad.sum())


def lake_monthly(grealm_id: str, valid_from: str | None = None):
    raw = read_grealm(grealm_id)
    if valid_from:
        raw = raw[raw["date"] >= pd.Timestamp(valid_from + "-01")]
    d, n_drop = clean_passes(raw)
    s = d.set_index("date")["level_m"]
    m = s.resample("MS").mean()
    n = s.resample("MS").count()
    idx = pd.date_range(m.index.min(), m.index.max(), freq="MS")
    m, n = m.reindex(idx), n.reindex(idx).fillna(0).astype(int)
    filled = m.interpolate(limit=2, limit_area="inside")
    # only fill runs of <= 2 missing months (interpolate(limit) would partially fill longer runs)
    miss = m.isna()
    run_id = (miss != miss.shift()).cumsum()
    run_len = miss.groupby(run_id).transform("sum")
    filled[miss & (run_len > 2)] = np.nan
    df = pd.DataFrame({"level_m": filled, "n_obs": n, "interp": miss & filled.notna()})
    gaps = []
    for _, g in df[df["level_m"].isna()].groupby(run_id[df["level_m"].isna()]):
        gaps.append({"from": g.index[0].strftime("%Y-%m"), "to": g.index[-1].strftime("%Y-%m"), "months": len(g)})
    info = {"n_passes": int(len(d)), "n_spikes_removed": n_drop,
            "first_pass": d["date"].min().strftime("%Y-%m-%d"), "last_pass": d["date"].max().strftime("%Y-%m-%d"),
            "last_pass_level_m": round(float(d["level_m"].iloc[-1]), 2), "gaps": gaps,
            "n_months_with_data": int(df["level_m"].notna().sum())}
    return df, info


def expanding_percentile(L: pd.Series) -> pd.DataFrame:
    """For each month: percentile (mid-rank, 0-100) of its level among the same calendar month in
    earlier years, and the 20th/10th percentile levels of those earlier years."""
    out = pd.DataFrame(index=L.index, columns=["pct", "q20", "q10", "n_base"], dtype=float)
    for cm in range(1, 13):
        sub = L[L.index.month == cm]
        vals = []
        for t, v in sub.items():
            if len(vals) >= MIN_BASE and not np.isnan(v):
                a = np.array(vals)
                out.loc[t, "pct"] = 100 * (np.sum(a < v) + 0.5 * np.sum(a == v)) / len(a)
            if len(vals) >= MIN_BASE:
                out.loc[t, ["q20", "q10"]] = np.quantile(vals, [WARN_Q, DANGER_Q])
                out.loc[t, "n_base"] = len(vals)
            if not np.isnan(v):
                vals.append(v)
    return out


# --------------------------------------------------------------------------------------
# Wet season and ENSO sensitivity
# --------------------------------------------------------------------------------------
def seasonal_cycle(L: pd.Series):
    """Mean seasonal cycle (level minus that year's mean, years with >= 10 months).
    Returns (low_month, high_month, amplitude_m, cycle dict)."""
    df = L.dropna().to_frame("v")
    df["y"], df["m"] = df.index.year, df.index.month
    ok = df.groupby("y")["v"].transform("count") >= 10
    df = df[ok]
    if df.empty:
        return None, None, None, {}
    df["a"] = df["v"] - df.groupby("y")["v"].transform("mean")
    cyc = df.groupby("m")["a"].mean().reindex(range(1, 13))
    lo, hi = int(cyc.idxmin()), int(cyc.idxmax())
    return lo, hi, float(cyc.max() - cyc.min()), {int(k): round(float(v), 3) for k, v in cyc.items()}


def wet_months(lo: int, hi: int) -> list[int]:
    """Calendar months after the low month up to and including the high month."""
    k = (hi - lo) % 12
    return [((lo - 1 + i) % 12) + 1 for i in range(1, k + 1)]


def oni_class(v: float) -> str:
    if v is None or np.isnan(v):
        return "neutral"
    return "el_nino" if v >= 0.5 else ("la_nina" if v <= -0.5 else "neutral")


def season_djf(t_hi: pd.Timestamp, k: int, oni: pd.Series):
    """ENSO class of a wet season, as in Kariba's enso block: the DJF ONI of the winter whose
    January is nearest the season's midpoint (ties go to the following winter). Returns
    (year of that January, DJF ONI)."""
    mid = t_hi - pd.DateOffset(months=k // 2) if k % 2 == 0 else t_hi - pd.DateOffset(months=k // 2, days=15)
    best = None
    for y in (mid.year - 1, mid.year, mid.year + 1):
        dist = abs((pd.Timestamp(y, 1, 15) - mid).days)
        if best is None or dist < best[0] or (dist == best[0] and y > best[1]):
            best = (dist, y)
    y = best[1]
    return y, float(oni.get(pd.Timestamp(y, 2, 1), np.nan))


def season_table(L: pd.Series, oni: pd.Series, lo: int, hi: int, before: pd.Timestamp | None = None):
    """One row per wet season: level change low-month -> high-month and the mean ONI over the
    wet-season months. Only seasons whose high month is before `before`."""
    k = (hi - lo) % 12
    rows = []
    for t_hi in L.index[L.index.month == hi]:
        if before is not None and t_hi >= before:
            continue
        t_lo = t_hi - pd.DateOffset(months=k)
        if t_lo not in L.index or np.isnan(L[t_hi]) or np.isnan(L[t_lo]):
            continue
        y, v = season_djf(t_hi, k, oni)
        rows.append({"season_end": t_hi, "year": t_hi.year, "dlevel_m": float(L[t_hi] - L[t_lo]),
                     "djf_year": y, "oni_djf": v})
    d = pd.DataFrame(rows)
    if len(d):
        d["enso"] = [oni_class(v) for v in d["oni_djf"]]
    return d


def perm_test(x: np.ndarray, mask: np.ndarray, n_perm: int, rng) -> tuple[float, float | None]:
    """Two-sided permutation test of mean(x[mask]) - mean(x[~mask])."""
    k, N = int(mask.sum()), len(x)
    if k < 3 or N - k < 3:
        return (float(x[mask].mean() - x[~mask].mean()) if 0 < k < N else np.nan), None
    obs = x[mask].mean() - x[~mask].mean()
    P = np.argsort(rng.random((n_perm, N)), axis=1)
    pm = mask[P]
    s_in = (x[None, :] * pm).sum(1) / k
    s_out = (x.sum() - s_in * k) / (N - k)
    cnt = np.sum(np.abs(s_in - s_out) >= abs(obs) - 1e-12)
    return float(obs), float((cnt + 1) / (n_perm + 1))


def enso_sensitivity(L, oni, lo, hi, before=None, n_perm=20000, seed=1):
    d = season_table(L, oni, lo, hi, before)
    if len(d) < 6:
        return {"n_seasons": int(len(d)), "el_nino_effect_m": None, "el_nino_p": None,
                "la_nina_effect_m": None, "la_nina_p": None}, d
    rng = np.random.default_rng(seed)
    x = d["dlevel_m"].values
    en, ln = (d["enso"] == "el_nino").values, (d["enso"] == "la_nina").values
    de, pe = perm_test(x, en, n_perm, rng)
    dl, pl = perm_test(x, ln, n_perm, rng)
    sd = float(np.std(x, ddof=1))
    return {"n_seasons": int(len(d)), "n_el_nino": int(en.sum()), "n_la_nina": int(ln.sum()),
            "el_nino_effect_m": de, "el_nino_p": pe, "la_nina_effect_m": dl, "la_nina_p": pl,
            "el_nino_effect_sd": de / sd if sd > 0 else None, "la_nina_effect_sd": dl / sd if sd > 0 else None,
            "mean_change_m": float(x.mean()), "sd_change_m": sd}, d


def gate(sens: dict) -> dict:
    ok = sens.get("n_seasons", 0) >= MIN_SEASONS_GATE
    return {"el_nino": bool(ok and sens.get("el_nino_p") is not None and sens["el_nino_p"] < GATE_P),
            "la_nina": bool(ok and sens.get("la_nina_p") is not None and sens["la_nina_p"] < GATE_P)}


# --------------------------------------------------------------------------------------
# Analog ensemble
# --------------------------------------------------------------------------------------
def forecast(L: pd.Series, t: pd.Timestamp, oni: pd.Series, wet: list[int], gates: dict, H: int = 12):
    """Analog ensemble issued in month t. Returns None if no recent level or no analogs."""
    s0 = None
    for back in (1, 2, 3):
        c = t - pd.DateOffset(months=back)
        if c in L.index and not np.isnan(L[c]):
            s0 = c
            break
    if s0 is None:
        return None
    hist = L[:s0].dropna()
    l0 = float(L[s0])
    targets = pd.date_range(t, periods=H, freq="MS")
    D = (targets[-1].year - s0.year) * 12 + targets[-1].month - s0.month
    # thresholds from same-calendar-month values known at issue (all earlier years)
    q20 = np.full(H, np.nan)
    q10 = np.full(H, np.nan)
    clim = np.full(H, np.nan)
    base = {}
    for j, m in enumerate(targets):
        past = hist[hist.index.month == m.month].values
        base[m.month] = past
        if len(past) >= MIN_BASE:
            q20[j], q10[j] = np.quantile(past, [WARN_Q, DANGER_Q])
            clim[j] = float(np.mean(past < q20[j]))
    cur_past = hist[(hist.index.month == s0.month) & (hist.index < s0)].values
    persist = (float(l0 < np.quantile(cur_past, WARN_Q)) if len(cur_past) >= MIN_BASE else np.nan)
    persist_d = (float(l0 < np.quantile(cur_past, DANGER_Q)) if len(cur_past) >= MIN_BASE else np.nan)
    # candidates
    phase_val = float(oni.get(t - pd.DateOffset(months=1), np.nan))
    phase = oni_class(phase_val)
    cands = []
    k = 1
    first = L.index[0]
    while True:
        b = s0 - pd.DateOffset(years=k)
        if b < first:
            break
        seg = L[b: b + pd.DateOffset(months=D)]
        if len(seg) == D + 1 and seg.notna().all() and b + pd.DateOffset(months=D) <= s0:
            win = pd.date_range(b + pd.DateOffset(months=1), b + pd.DateOffset(months=D), freq="MS")
            his = [w for w in win if w.month == wet[-1]] if wet else []
            cls = oni_class(season_djf(his[0], len(wet), oni)[1]) if his else "neutral"
            cands.append({"base": b, "year": int((b + pd.DateOffset(months=1)).year), "enso": cls,
                          "dl": seg.values[1:] - seg.values[0]})
        k += 1
    if not cands:
        return None
    use = None
    if phase == "el_nino" and gates.get("el_nino"):
        use = "el_nino"
    elif phase == "la_nina" and gates.get("la_nina"):
        use = "la_nina"
    elif phase == "neutral" and (gates.get("el_nino") or gates.get("la_nina")):
        use = "neutral"
    pool, pool_type, note = cands, "climatology", None
    if use is not None:
        sub = [c for c in cands if c["enso"] == use]
        if len(sub) >= MIN_POOL:
            pool, pool_type = sub, use
        else:
            note = f"only {len(sub)} {use} analog years; used all {len(cands)}"
    cap = float(hist.max())
    P = np.array([np.minimum(l0 + c["dl"], cap) for c in pool])[:, -H:]   # members x H
    with np.errstate(invalid="ignore"):
        pw = np.where(np.isnan(q20), np.nan, (P < q20[None, :]).mean(0))
        pd_ = np.where(np.isnan(q10), np.nan, (P < q10[None, :]).mean(0))
    return {"issue": t, "s0": s0, "level0": l0, "phase": phase, "oni_at_issue": phase_val, "pool_type": pool_type,
            "pool_note": note, "pool": pool, "n_candidates": len(cands), "targets": targets, "members": P,
            "q20": q20, "q10": q10, "clim": clim, "persist": persist, "persist_danger": persist_d,
            "p_warn": pw, "p_danger": pd_, "base": base}


def member_percentile(v: float, past: np.ndarray):
    if len(past) < MIN_BASE:
        return None
    return float(100 * (np.sum(past < v) + 0.5 * np.sum(past == v)) / len(past))
