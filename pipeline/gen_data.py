"""Labels and features for the country hydropower shortfall model.

Labels (DESIGN.md 11.1): monthly hydro capacity factor = hydro TWh / (hydro GW x hours in month), using Ember
yearly hydro capacity treated as the mid-year value, interpolated linearly between years and carried
forward/backward at the ends. Anomaly % = CF vs the median CF of the same calendar month in *earlier* years only
(expanding window, >= 2 prior years). Sichuan has no capacity series, so it uses the generation anomaly.

Features at issue month t respect publication lags:
  Ember   t-2 (persistence)        GRACE   t-3 (TWS z vs calendar month, expanding baseline; 3-month change)
  POWER   t-1 (precip 1/3/6/12-month % of 1981-2010 normal; root/surface wetness and T2M z vs 1981-2010)
  ONI     t-1 (3-month season ending at t-1, and its 3-month change)
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import xarray as xr

from pipeline.gen_points import points_for
from pipeline.paths import RAW, REFERENCE
from pipeline.power import monthly_point

SHORTFALL_PCT = -15.0
SEVERE_PCT = -30.0
SICHUAN = "CHN-SC"
CLIM_BASE = (1981, 2010)
POWER_LAND_CUTOFF = pd.Period("2026-10", "M")  # first month of the POWER soil/temperature step change  # POWER climatology baseline (entirely before the label period)


def reference() -> pd.DataFrame:
    ref = pd.read_csv(REFERENCE / "hydro_dependent_countries_ember.csv")
    return ref.rename(columns={"ISO 3 code": "iso3", "Area": "name"})


def tier1_codes() -> list[str]:
    ref = reference()
    return ref.loc[ref["has_monthly"], "iso3"].tolist() + [SICHUAN]


# ---------------------------------------------------------------- labels
def _ember_monthly() -> pd.DataFrame:
    m = pd.read_csv(RAW / "ember_release_generation_monthly_global.csv",
                    usecols=["ISO 3 code", "Date", "Electricity source", "Generation (TWh)", "Share of generation (%)"])
    m = m[m["Electricity source"] == "Hydro"].rename(columns={"ISO 3 code": "iso3", "Generation (TWh)": "twh",
                                                              "Share of generation (%)": "share"})
    m["month"] = pd.to_datetime(m["Date"]).dt.to_period("M")
    return m[["iso3", "month", "twh", "share"]].dropna(subset=["iso3"])


def _sichuan_monthly() -> pd.DataFrame:
    c = pd.read_csv(RAW / "ember_release_chn_subnational_generation_monthly.csv")
    c = c[(c["Province"] == "Sichuan") & (c["Electricity source"] == "Hydro")]
    out = pd.DataFrame({"iso3": SICHUAN, "month": pd.to_datetime(c["Date"]).dt.to_period("M"),
                        "twh": c["Generation (TWh)"].values, "share": c["Share of generation (%)"].values})
    return out


def sichuan_totals() -> pd.DataFrame:
    """Sichuan yearly hydro TWh and share (from the monthly province file)."""
    c = pd.read_csv(RAW / "ember_release_chn_subnational_generation_monthly.csv")
    c = c[c["Province"] == "Sichuan"].copy()
    c["year"] = pd.to_datetime(c["Date"]).dt.year
    h = c[c["Electricity source"] == "Hydro"].groupby("year")["Generation (TWh)"].agg(["sum", "count"])
    t = c[c["Electricity source"] == "Total generation"].groupby("year")["Generation (TWh)"].sum()
    h["total"] = t
    return h


def ember_yearly() -> pd.DataFrame:
    y = pd.read_csv(RAW / "ember_release_generation_yearly_global.csv",
                    usecols=["ISO 3 code", "Year", "Electricity source", "Generation (TWh)", "Capacity (GW)",
                             "Share of generation (%)"])
    y = y[y["Electricity source"] == "Hydro"].rename(columns={"ISO 3 code": "iso3", "Year": "year",
                                                             "Capacity (GW)": "gw", "Generation (TWh)": "twh"})
    return y.dropna(subset=["iso3"])


def monthly_capacity(iso3: str, months: pd.PeriodIndex) -> pd.Series:
    """Ember yearly hydro GW as mid-year (July) values, linear in between, flat beyond the ends."""
    y = ember_yearly()
    y = y[(y["iso3"] == iso3) & y["gw"].notna() & (y["gw"] > 0)]
    if y.empty:
        return pd.Series(np.nan, index=months)
    x = np.array([pd.Period(f"{yr}-07", "M").ordinal for yr in y["year"]], dtype=float)
    return pd.Series(np.interp(months.asi8.astype(float), x, y["gw"].values), index=months)


def expanding_month_normal(s: pd.Series, min_years: int = 2) -> pd.Series:
    """For each month, the median of the same calendar month in strictly earlier years."""
    out = pd.Series(np.nan, index=s.index)
    df = pd.DataFrame({"v": s.values, "m": s.index.month, "y": s.index.year}, index=s.index)
    for m, g in df.groupby("m"):
        g = g.sort_values("y")
        vals = g["v"].values
        for i, idx in enumerate(g.index):
            prev = vals[:i]
            prev = prev[~np.isnan(prev)]
            if len(prev) >= min_years:
                out[idx] = np.median(prev)
    return out


def scaled_month_normal(s: pd.Series, min_years: int = 2) -> pd.Series:
    """Normal for areas without a capacity series (Sichuan): each earlier year's same-month value is rescaled
    by (last complete year's total / that year's total), then the median is taken. This stands in for capacity
    growth (Sichuan added >20 GW of hydro in 2016-2025) using only data available before year Y."""
    df = pd.DataFrame({"v": s.values, "y": s.index.year, "m": s.index.month})
    cnt = df.groupby("y")["v"].count()
    tot = df.groupby("y")["v"].sum()
    out = pd.Series(np.nan, index=s.index)
    for i, (idx, r) in enumerate(zip(s.index, df.itertuples())):
        Y = r.y
        if (Y - 1) not in cnt.index or cnt[Y - 1] < 12 or np.isnan(r.v):
            continue
        prev = df[(df.y < Y) & (df.m == r.m) & df.v.notna()]
        prev = prev[prev.y.map(cnt) == 12]
        if len(prev) < min_years:
            continue
        out[idx] = np.median(prev.v.values * tot[Y - 1] / prev.y.map(tot).values)
    return out


def labels() -> tuple[pd.DataFrame, dict]:
    """Per area-month: twh, gw, cf, normal, anom_pct, shortfall, severe. Returns (frame, info per area)."""
    m = pd.concat([_ember_monthly(), _sichuan_monthly()], ignore_index=True)
    codes = tier1_codes()
    frames, info = [], {}
    for iso in codes:
        d = m[m["iso3"] == iso].drop_duplicates("month").set_index("month").sort_index()
        if d.empty:
            continue
        idx = pd.period_range(d.index.min(), d.index.max(), freq="M")
        d = d.reindex(idx)
        hours = idx.days_in_month.values * 24.0
        gw = monthly_capacity(iso, idx) if iso != SICHUAN else pd.Series(np.nan, index=idx)
        if gw.notna().all():
            metric = d["twh"] * 1000.0 / (gw * hours)  # capacity factor (0-1)
            basis = "capacity_factor"
            normal = expanding_month_normal(metric)
        else:
            metric = d["twh"] / (hours / 24.0)  # TWh per day, so month length does not matter
            basis = "generation_scaled_by_last_full_year"
            normal = scaled_month_normal(metric)
        anom = (metric / normal - 1.0) * 100.0
        f = pd.DataFrame({"iso3": iso, "month": idx, "twh": d["twh"].values, "gw": gw.values,
                          "metric": metric.values, "normal": normal.values, "anom_pct": anom.values,
                          "hours": hours})
        f["shortfall"] = np.where(f["anom_pct"].notna(), f["anom_pct"] <= SHORTFALL_PCT, np.nan)
        f["severe"] = np.where(f["anom_pct"].notna(), f["anom_pct"] <= SEVERE_PCT, np.nan)
        frames.append(f)
        info[iso] = {"basis": basis, "first": str(idx.min()), "last": str(d["twh"].dropna().index.max())}
    return pd.concat(frames, ignore_index=True), info


# ---------------------------------------------------------------- drivers
def load_oni() -> pd.Series:
    """ONI indexed by the LAST month of its 3-month season (e.g. ASO 2026 -> 2026-10)."""
    seas = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"]
    df = pd.read_csv(RAW / "oni.ascii.txt", sep=r"\s+")
    out = {}
    for r in df.itertuples():
        i = seas.index(r.SEAS)
        centre = pd.Period(f"{int(r.YR)}-{i + 1:02d}", "M")
        out[centre + 1] = float(r.ANOM)
    return pd.Series(out).sort_index()


_GRACE = None


def _grace():
    global _GRACE
    if _GRACE is None:
        ds = xr.open_dataset(RAW / "gravis_tws_grid.nc")
        _GRACE = (ds["tws"], pd.to_datetime(ds["time"].values).to_period("M"))
    return _GRACE


def grace_series(points: list[tuple[float, float, float]]) -> pd.Series:
    """Weighted TWS anomaly (cm) at 1-degree cells holding the points; monthly PeriodIndex, gaps as NaN."""
    tws, per = _grace()
    vals, ws = [], []
    for lon, lat, w in points:
        la = np.floor(lat) + 0.5
        lo = (np.floor(lon) + 0.5) % 360
        v = tws.sel(lat=la, lon=lo, method="nearest").values.astype(float)
        vals.append(v)
        ws.append(w)
    V = np.array(vals)
    W = np.array(ws)[:, None] * ~np.isnan(V)
    with np.errstate(invalid="ignore"):
        s = np.nansum(np.nan_to_num(V) * W, axis=0) / W.sum(axis=0)
    s = pd.Series(s, index=per).groupby(level=0).mean()
    full = pd.period_range(s.index.min(), s.index.max(), freq="M")
    return s.reindex(full)


def expanding_month_z(s: pd.Series, min_years: int = 4) -> pd.Series:
    """z-score vs the same calendar month in strictly earlier years (causal)."""
    out = pd.Series(np.nan, index=s.index)
    for m in range(1, 13):
        g = s[s.index.month == m].dropna()
        for i in range(len(g)):
            prev = g.values[:i]
            if len(prev) >= min_years and prev.std(ddof=1) > 0:
                out[g.index[i]] = (g.values[i] - prev.mean()) / prev.std(ddof=1)
    return out


def power_series(points: list[tuple[float, float, float]]) -> pd.DataFrame:
    """Capacity-weighted POWER monthly series (PeriodIndex)."""
    frames, ws = [], []
    for lon, lat, w in points:
        d = monthly_point(lon, lat)
        frames.append(d)
        ws.append(w)
    idx = frames[0].index
    for f in frames[1:]:
        idx = idx.union(f.index)
    acc = None
    wsum = None
    for f, w in zip(frames, ws):
        f = f.reindex(idx)
        ww = f.notna().astype(float) * w
        acc = f.fillna(0) * ww if acc is None else acc + f.fillna(0) * ww
        wsum = ww if wsum is None else wsum + ww
    out = acc / wsum.replace(0, np.nan)
    out.index = out.index.to_period("M")
    return out


_GPCP = None


def _gpcp():
    global _GPCP
    if _GPCP is None:
        d = xr.open_dataset(RAW / "gpcp" / "precip.mon.mean.nc", decode_times=False, drop_variables=["time_bnds"])
        t = (pd.Timestamp("1800-01-01") + pd.to_timedelta(d["time"].values, "D")).to_period("M")
        _GPCP = (d["precip"], t)
    return _GPCP


def gpcp_series(points: list[tuple[float, float, float]]) -> pd.Series:
    """GPCP v2.3 monthly rain (mm/day, 2.5 deg), nearest cell per point, capacity-weighted."""
    pr, per = _gpcp()
    acc = None
    for x, y, w in points:
        v = pr.sel(lat=y, lon=x % 360, method="nearest").values.astype(float)
        v = np.where((v >= 0) & (v < 1e3), v, np.nan) * w
        acc = v if acc is None else acc + v
    return pd.Series(acc, index=per).groupby(level=0).mean()


def _precip_anoms(p_mmday: pd.Series, idx: pd.PeriodIndex, prefix: str) -> pd.DataFrame:
    p_mmday = p_mmday.reindex(idx)
    base = p_mmday[(idx.year >= CLIM_BASE[0]) & (idx.year <= CLIM_BASE[1])]
    clim = base.groupby(base.index.month).mean()
    p = p_mmday * idx.days_in_month
    pc = pd.Series(clim.reindex(idx.month).values * idx.days_in_month, index=idx)
    out = pd.DataFrame(index=idx)
    for k in (1, 3, 6, 12):
        out[f"{prefix}{k}m_anom_pct"] = (p.rolling(k, min_periods=k).sum() / pc.rolling(k, min_periods=k).sum() - 1.0) * 100.0
    return out


def trailing_month_z(s: pd.Series, years: int = 10, min_years: int = 5) -> pd.Series:
    """Causal standardized anomaly: deviation from the same calendar month's mean over the previous `years`
    years, divided by the spread of all monthly deviations over the previous `years` years (>= 5 years).
    A trailing baseline absorbs step changes in the MERRA-2 land record after a few years (it does not remove
    one-off artefacts)."""
    dev = pd.Series(np.nan, index=s.index)
    for m in range(1, 13):
        g = s[s.index.month == m]
        base = g.shift(1).rolling(years, min_periods=min_years).mean()
        dev[g.index] = (g - base).values
    sd = dev.shift(1).rolling(12 * years, min_periods=12 * min_years).std()
    return dev / sd


def driver_table(iso3: str, oni: pd.Series) -> pd.DataFrame:
    """Monthly driver series for one area, indexed by observation month (not yet lagged)."""
    pts = points_for(iso3)
    pw = power_series(pts)
    gp = gpcp_series(pts)
    idx = pd.period_range("1981-01", max(pw.index.max(), gp.index.max()), freq="M")
    pw = pw.reindex(idx)
    d = _precip_anoms(gp, idx, "precip_")                       # GPCP v2.3 (primary rain input)
    d = d.join(_precip_anoms(pw["PRECTOTCORR"], idx, "merra_precip_"))  # POWER/MERRA-2 rain (comparison only)
    # POWER soil wetness/T2M show a step change from 2026-10 (MERRA-2 stream change); treat >= 2026-10 as unavailable
    pw.loc[pw.index >= POWER_LAND_CUTOFF, ["GWETROOT", "GWETTOP", "T2M"]] = np.nan
    for v, name in (("GWETROOT", "soil_root"), ("GWETTOP", "soil_top"), ("T2M", "t2m")):
        d[f"{name}_anom_sd"] = trailing_month_z(pw[v])
    d["soil_root_3m_anom_sd"] = d["soil_root_anom_sd"].rolling(3, min_periods=3).mean()
    d["t2m_3m_anom_sd"] = d["t2m_anom_sd"].rolling(3, min_periods=3).mean()
    g = grace_series(pts)
    gz = expanding_month_z(g)
    d["tws_anom_cm"] = g.reindex(idx)
    d["tws_anom_sd"] = gz.reindex(idx)
    d["oni"] = oni.reindex(idx)
    return d


LAGS = {"ember": 2, "grace": 3, "power": 1, "oni": 1}

FEATURE_GROUPS = {
    "ember": ["persist_anom_pct", "persist_3m_anom_pct", "anom_lag12_target_pct"],
    "gravis": ["tws_anom_sd", "tws_change_3m_sd"],
    "gpcp_precip": ["precip_1m_anom_pct", "precip_3m_anom_pct", "precip_6m_anom_pct", "precip_12m_anom_pct"],
    "power_soil": ["soil_root_anom_sd", "soil_root_3m_anom_sd", "soil_top_anom_sd"],
    "power_temp": ["t2m_anom_sd", "t2m_3m_anom_sd"],
    "oni": ["oni", "oni_change_3m"],
    "calendar": ["target_month_sin", "target_month_cos", "issue_month_sin", "issue_month_cos"],
    "static": ["hydro_share_pct"],
    "history": ["hist_short_rate", "hist_short_rate_cal", "hist_anom_sd"],
}
MERRA_PRECIP = ["merra_precip_1m_anom_pct", "merra_precip_3m_anom_pct", "merra_precip_6m_anom_pct",
                "merra_precip_12m_anom_pct"]
FEATURES = [f for g in FEATURE_GROUPS.values() for f in g]


def issue_features(drv: pd.DataFrame, lab: pd.Series, issue_months: pd.PeriodIndex) -> pd.DataFrame:
    """Features known at each issue month t (horizon-independent part)."""
    t = issue_months
    out = pd.DataFrame(index=t)
    pw = drv.reindex(t - LAGS["power"])
    for c in FEATURE_GROUPS["gpcp_precip"] + MERRA_PRECIP:
        out[c] = pw[c].values
    # soil/temperature: t-1, falling back to t-2 when t-1 is unavailable (live: 2026-10 masked, so 2026-09 is used)
    pw2 = drv.reindex(t - LAGS["power"] - 1)
    for c in FEATURE_GROUPS["power_soil"] + FEATURE_GROUPS["power_temp"]:
        out[c] = np.where(np.isnan(pw[c].values), pw2[c].values, pw[c].values)
    gz = drv["tws_anom_sd"]
    out["tws_anom_sd"] = gz.reindex(t - LAGS["grace"]).values
    out["tws_change_3m_sd"] = (gz.reindex(t - LAGS["grace"]).values - gz.reindex(t - LAGS["grace"] - 3).values)
    oni = drv["oni"]
    out["oni"] = oni.reindex(t - LAGS["oni"]).values
    out["oni_change_3m"] = oni.reindex(t - LAGS["oni"]).values - oni.reindex(t - LAGS["oni"] - 3).values
    lab = lab.copy()
    # last observed anomaly at t-2; if that month is not yet published, fall back to t-3 (live: BRA/CAN/ECU/NGA)
    out["persist_anom_pct"] = np.where(np.isnan(lab.reindex(t - LAGS["ember"]).values),
                                       lab.reindex(t - LAGS["ember"] - 1).values, lab.reindex(t - LAGS["ember"]).values)
    out["persist_3m_anom_pct"] = pd.concat([lab.reindex(t - LAGS["ember"] - k).reset_index(drop=True)
                                            for k in range(3)], axis=1).mean(axis=1, skipna=False).values
    # causal grid history: shortfall rate and anomaly spread from labels observed by t-2
    sh = (lab <= SHORTFALL_PCT).astype(float).where(lab.notna())
    cum_n = sh.notna().cumsum()
    rate = (sh.fillna(0).cumsum() / cum_n).where(cum_n >= 12)
    sd = lab.expanding(min_periods=12).std()
    out["hist_short_rate"] = rate.reindex(t - LAGS["ember"]).values
    out["hist_anom_sd"] = sd.reindex(t - LAGS["ember"]).values
    out["issue_month_sin"] = np.sin(2 * np.pi * t.month / 12)
    out["issue_month_cos"] = np.cos(2 * np.pi * t.month / 12)
    return out


def horizon_rows(iso3: str, base: pd.DataFrame, lab: pd.DataFrame, h: int, share: float) -> pd.DataFrame:
    """Rows (issue t, target t+h) with target label columns attached (NaN if unobserved)."""
    t = base.index
    tgt = t + h
    L = lab.set_index("month")
    df = base.copy()
    df["iso3"] = iso3
    df["issue"] = t
    df["target"] = tgt
    df["horizon"] = h
    df["target_month_sin"] = np.sin(2 * np.pi * tgt.month / 12)
    df["target_month_cos"] = np.cos(2 * np.pi * tgt.month / 12)
    df["anom_lag12_target_pct"] = L["anom_pct"].reindex(tgt - 12).values
    df["hydro_share_pct"] = share
    # shortfall rate in the target's calendar month, from labels observed by t-2 (>= 2 years)
    sh = (L["anom_pct"] <= SHORTFALL_PCT).astype(float).where(L["anom_pct"].notna())
    cal = []
    for ti, tg in zip(t, tgt):
        v = sh[(sh.index.month == tg.month) & (sh.index <= ti - LAGS["ember"])].dropna()
        cal.append((v.sum() + 1) / (len(v) + 2) if len(v) >= 2 else np.nan)
    df["hist_short_rate_cal"] = cal
    df["y_anom"] = L["anom_pct"].reindex(tgt).values
    df["y_short"] = L["shortfall"].reindex(tgt).values
    df["y_severe"] = L["severe"].reindex(tgt).values
    # any shortfall in t+1..t+6 (alarm target): known only when all 6 months are labelled
    win = np.column_stack([L["shortfall"].reindex(t + k).values.astype(float) for k in range(1, 7)])
    hit = (np.nan_to_num(win) > 0).any(axis=1)
    anyw = np.where(hit, 1.0, np.where(np.isnan(win).any(axis=1), np.nan, 0.0))
    df["y_any6"] = anyw
    df["normal_target"] = L["normal"].reindex(tgt).values
    return df.reset_index(drop=True)
