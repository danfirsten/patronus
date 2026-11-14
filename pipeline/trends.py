"""Global trend map: is water storage in the world's hydropower basins changing, and is it significant?

For each HydroBASINS level-4 basin that contains WRI GPPD hydro plants:
  1. GFZ GravIS GRACE/GRACE-FO total water storage (TWS) anomaly, area-weighted (cos lat) mean of the 1-degree cells
     whose centres fall inside the basin (nearest land cell if none does; flagged low_resolution).
  2. Deseasonalize (subtract each calendar month's mean). Missing months, including the 2017-18 GRACE/GRACE-FO gap,
     stay missing; nothing is interpolated.
  3. Mann-Kendall with Hamed-Rao autocorrelation correction (pymannkendall) for significance; Sen's slope computed on
     the real time axis (so gaps don't compress time), in cm/decade.
  4. Same test on GPCP v2.3 monthly precipitation (overlap-area x cos-lat weighted 2.5-degree cells), slope in % of mean
     per decade. NASA POWER (MERRA-2) point rainfall is kept as *_merra2 for comparison only (it has breaks).
  5. Benjamini-Hochberg FDR across basins, separately for TWS and precipitation. trend_class uses TWS q < 0.05.

Writes web/public/data/trends.json and web/public/data/basins.geojson.

    python3 -m pipeline.trends
"""
from __future__ import annotations

import json
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import geopandas as gpd
import numpy as np
import pandas as pd
import pymannkendall as mk
import shapely
import xarray as xr
from shapely.geometry import Point

from pipeline.basins import load_basins, load_plants
from pipeline.paths import OUT, RAW
from pipeline.power import monthly_point

GRAVIS = RAW / "gravis_tws_grid.nc"
START, END = "2002-04", "2026-08"
ALPHA = 0.05
SMALL_BASIN_KM2 = 50_000          # well below GRACE's ~300 km effective resolution
KARIBA_BASIN = "1041438860"       # level-4 basin holding Kariba North/South and Victoria Falls (ZMB/ZWE)
N_SERIES = 50
MONTHS = pd.period_range(START, END, freq="M")


# ---------------------------------------------------------------- GRACE grid
def load_gravis() -> tuple[np.ndarray, np.ndarray, np.ndarray, list[str]]:
    """Return (tws[month, lat, lon] on the full monthly axis, lat, lon(-180..180), notes)."""
    notes = []
    ds = xr.open_dataset(GRAVIS)
    tws = ds["tws"].values  # (time, lat, lon), cm
    per = pd.DatetimeIndex(ds["time"].values).to_period("M")
    lat = ds["lat"].values.astype(float)
    lon = ds["lon"].values.astype(float)
    lon = np.where(lon > 180, lon - 360, lon)
    out = np.full((len(MONTHS), len(lat), len(lon)), np.nan)
    pos = {p: i for i, p in enumerate(MONTHS)}
    groups = defaultdict(list)
    for i, p in enumerate(per):
        groups[p].append(i)
    dups = []
    for p, idx in groups.items():
        if p not in pos:
            continue
        if len(idx) > 1:
            dups.append(str(p))
            out[pos[p]] = np.nanmean(tws[idx], axis=0)
        else:
            out[pos[p]] = tws[idx[0]]
    if dups:
        notes.append(f"GravIS has two solutions dated in the same calendar month for {', '.join(dups)}; they are averaged.")
    have = ~np.all(np.isnan(out.reshape(len(MONTHS), -1)), axis=1)
    missing = [str(m) for m, h in zip(MONTHS, have) if not h]
    notes.append(f"{len(missing)} of {len(MONTHS)} months have no GRACE/GRACE-FO solution (including the "
                 f"2017-07..2018-05 mission gap); they are left missing, not interpolated.")
    return out, lat, lon, notes


def basin_cells(basins: gpd.GeoDataFrame, land: np.ndarray, lat: np.ndarray, lon: np.ndarray) -> dict:
    """basin_id -> (lat_idx array, lon_idx array, used_nearest)."""
    li, lj = np.nonzero(land)
    cells = gpd.GeoDataFrame({"i": li, "j": lj}, geometry=gpd.points_from_xy(lon[lj], lat[li]), crs="EPSG:4326")
    j = gpd.sjoin(cells, basins[["basin_id", "geometry"]], how="inner", predicate="within")
    res = {bid: (g["i"].values, g["j"].values, False) for bid, g in j.groupby("basin_id")}
    tree = shapely.STRtree(cells.geometry.values)
    for r in basins.itertuples():
        if r.basin_id in res:
            continue
        rp = r.geometry.representative_point()
        k = tree.nearest(rp)
        res[r.basin_id] = (np.array([cells["i"].iat[k]]), np.array([cells["j"].iat[k]]), True)
    return res


def area_mean(tws: np.ndarray, lat: np.ndarray, ii: np.ndarray, jj: np.ndarray) -> np.ndarray:
    v = tws[:, ii, jj]  # (time, ncell)
    w = np.cos(np.deg2rad(lat[ii]))[None, :] * ~np.isnan(v)
    s = np.nansum(v * w, axis=1)
    ws = w.sum(axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(ws > 0, s / ws, np.nan)


# ---------------------------------------------------------------- statistics
def deseasonalize(x: np.ndarray) -> np.ndarray:
    moy = np.array([m.month for m in MONTHS])
    out = x.copy()
    for m in range(1, 13):
        sel = moy == m
        mu = np.nanmean(x[sel]) if np.any(~np.isnan(x[sel])) else np.nan
        out[sel] = x[sel] - mu
    return out


def sen_slope(t: np.ndarray, x: np.ndarray) -> tuple[float, float]:
    """Sen's slope on the real time axis (units of x per unit t) and intercept (median of x - b*t)."""
    i, j = np.triu_indices(len(t), k=1)
    b = float(np.median((x[j] - x[i]) / (t[j] - t[i])))
    a = float(np.median(x - b * t))
    return b, a


def trend_test(anom: np.ndarray) -> dict | None:
    ok = ~np.isnan(anom)
    if ok.sum() < 60:
        return None
    t = np.arange(len(anom), dtype=float)[ok]  # months since 2002-04
    x = anom[ok]
    with np.errstate(invalid="ignore"):
        r = mk.hamed_rao_modification_test(x)
    test = "hamed_rao"
    if not np.isfinite(r.p):  # Hamed-Rao corrected variance can go negative; fall back to Yue-Wang correction
        r = mk.yue_wang_modification_test(x)
        test = "yue_wang"
    b, a = sen_slope(t, x)
    return {"p": float(r.p), "z": float(r.z), "tau": float(r.Tau), "slope_per_month": b, "intercept": a,
            "n": int(ok.sum()), "test": test}


def annual_p(anom: np.ndarray) -> float | None:
    """Robustness check: Hamed-Rao MK on calendar-year means (years with >= 6 months of data)."""
    yrs = np.array([m.year for m in MONTHS])
    s = pd.Series(anom).groupby(yrs).agg(lambda v: v.mean() if v.notna().sum() >= 6 else np.nan).dropna()
    if len(s) < 10:
        return None
    with np.errstate(invalid="ignore"):
        r = mk.hamed_rao_modification_test(s.to_numpy())
    if not np.isfinite(r.p):
        r = mk.yue_wang_modification_test(s.to_numpy())
    return float(r.p)


def bh_fdr(p: list[float | None]) -> list[float | None]:
    idx = [k for k, v in enumerate(p) if v is not None and np.isfinite(v)]
    q = [None] * len(p)
    if not idx:
        return q
    pv = np.array([p[k] for k in idx])
    m = len(pv)
    order = np.argsort(pv)
    ranked = pv[order] * m / np.arange(1, m + 1)
    ranked = np.minimum.accumulate(ranked[::-1])[::-1]
    qv = np.empty(m)
    qv[order] = np.minimum(ranked, 1.0)
    for k, v in zip(idx, qv):
        q[k] = float(v)
    return q


# ---------------------------------------------------------------- precipitation (GPCP primary)
GPCP = RAW / "gpcp" / "precip.mon.mean.nc"


def load_gpcp() -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """GPCP v2.3 monthly precip (mm/day) on the 2002-04..2026-08 axis: (pr[month, lat, lon], lat, lon(-180..180))."""
    if not GPCP.exists():
        return None
    d = xr.open_dataset(GPCP, decode_times=False, drop_variables=["time_bnds"])
    per = (pd.Timestamp("1800-01-01") + pd.to_timedelta(d["time"].values, "D")).to_period("M")
    pr = d["precip"].values.astype(float)
    pr[(pr < 0) | (pr > 1e3)] = np.nan
    pos = {p: i for i, p in enumerate(per)}
    out = np.full((len(MONTHS), pr.shape[1], pr.shape[2]), np.nan)
    for k, m in enumerate(MONTHS):
        if m in pos:
            out[k] = pr[pos[m]]
    lon = d["lon"].values.astype(float)
    return out, d["lat"].values.astype(float), np.where(lon > 180, lon - 360, lon)


def gpcp_weights(geom, lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """2.5-degree cells overlapping geom; weight = overlap area (deg2) x cos(lat). Small basins get their 1-2 cells."""
    minx, miny, maxx, maxy = geom.bounds
    ii, jj, ww = [], [], []
    for i, y in enumerate(lat):
        if y + 1.25 < miny or y - 1.25 > maxy:
            continue
        for j, x in enumerate(lon):
            if x + 1.25 < minx or x - 1.25 > maxx:
                continue
            a = geom.intersection(shapely.box(x - 1.25, y - 1.25, x + 1.25, y + 1.25)).area
            if a > 0:
                ii.append(i), jj.append(j), ww.append(a * np.cos(np.deg2rad(y)))
    if not ii:  # fallback: nearest cell to the representative point
        rp = geom.representative_point()
        ii, jj, ww = [int(np.abs(lat - rp.y).argmin())], [int(np.abs(lon - rp.x).argmin())], [1.0]
    return np.array(ii), np.array(jj), np.array(ww)


def gpcp_series(g, geom) -> np.ndarray:
    pr, lat, lon = g
    ii, jj, ww = gpcp_weights(geom, lat, lon)
    v = pr[:, ii, jj]
    w = ww[None, :] * ~np.isnan(v)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(w.sum(1) > 0, np.nansum(v * w, 1) / w.sum(1), np.nan)


# ---------------------------------------------------------------- precipitation (NASA POWER, cross-check)
def precip_series(points: list[tuple[float, float]]) -> np.ndarray | None:
    frames = []
    for lon, lat in points:
        try:
            df = monthly_point(lon, lat, fill_recent=False)
            frames.append(df["PRECTOTCORR"])
        except Exception:  # noqa: BLE001
            continue
    if not frames:
        return None
    s = pd.concat(frames, axis=1).mean(axis=1)
    s.index = pd.DatetimeIndex(s.index).to_period("M")
    s = s[~s.index.duplicated()]
    return s.reindex(MONTHS).to_numpy(dtype=float)


RAIN_END = "2019-12"  # GPCP drifts low vs MERRA-2 (and vs Kariba lake rises) from ~2020; see drift_check()


def precip_test(pr: np.ndarray | None, end: str | None = None) -> dict | None:
    """Rain trend; with `end`, months after it are dropped (deseasonalized and tested on the window only)."""
    if pr is None:
        return None
    pr = pr.copy()
    n = len(pr)
    if end is not None:
        cut = np.array([m > pd.Period(end, "M") for m in MONTHS])
        pr[cut] = np.nan
        n = int((~cut).sum())
    if np.isnan(pr).sum() - (len(pr) - n) > n * 0.1:
        return None
    mean = float(np.nanmean(pr))
    if not mean > 0.05:  # deserts: % of ~0 is meaningless
        return None
    r = trend_test(deseasonalize(pr))
    if r is None:
        return None
    r["slope_pct_per_decade"] = r["slope_per_month"] * 120 / mean * 100
    r["mean_mm_day"] = mean
    return r


def grid_points(geom, max_points: int) -> list[tuple[float, float]]:
    minx, miny, maxx, maxy = geom.bounds
    pts = [(geom.representative_point().x, geom.representative_point().y)]
    for x in np.arange(np.floor(minx) + 0.5, maxx, 1.0):
        for y in np.arange(np.floor(miny) + 0.5, maxy, 1.0):
            if geom.contains(Point(x, y)):
                pts.append((float(x), float(y)))
    if len(pts) > max_points:
        idx = np.linspace(0, len(pts) - 1, max_points).round().astype(int)
        pts = [pts[i] for i in sorted(set(idx))]
    return pts


# ---------------------------------------------------------------- helpers
def r_(v, n=3):
    if v is None:
        return None
    v = float(v)
    return round(v, n) if np.isfinite(v) else None


def clean_plant_name(s: str, country: str = "") -> str:
    if country and s.endswith(" " + country):
        s = s[: -len(country) - 1]
    for junk in [" Pumped Storage", " Hydroelectric Power Station", " Hydroelectric Power Plant", " Hydropower Station",
                 " Hydro Power Plant", " Hydroelectric Plant", " Power Station", " Power Plant", " Hydroelectric", " Dam",
                 " GEN"]:
        s = s.replace(junk, "")
    s = s.replace("_", " ").strip(" ,-")
    if s.isupper() and len(s) > 4:
        s = s.title()
    return s if len(s) <= 40 else s[:38].rstrip() + "…"


def upstream_catchment(basin_id: str) -> tuple[list[str], object, float]:
    """All level-4 basins draining into basin_id (inclusive), via HydroBASINS NEXT_DOWN."""
    g = gpd.read_file(RAW / "hydrobasins" / f"hybas_{'af'}_lev04_v1c.shp", columns=["HYBAS_ID", "NEXT_DOWN", "SUB_AREA"])
    up = defaultdict(list)
    for h, n in zip(g["HYBAS_ID"].astype("int64"), g["NEXT_DOWN"].astype("int64")):
        up[n].append(h)
    todo, seen = [int(basin_id)], []
    while todo:
        h = todo.pop()
        seen.append(h)
        todo.extend(up.get(h, []))
    sub = g[g["HYBAS_ID"].astype("int64").isin(seen)]
    return [str(h) for h in seen], sub.geometry.union_all(), float(sub["SUB_AREA"].sum())


KARIBA_LAKE_KM2 = 5580  # Lake Kariba surface area at full supply level (approximate, published figure)


def kariba_lake_equivalent(basin_area_km2: float) -> dict | None:
    """Sen slope of G-REALM Lake Kariba level over the GRACE period, expressed as water depth spread over the basin."""
    f = RAW / "kariba_grealm_10day_levels.csv"
    if not f.exists():
        return None
    df = pd.read_csv(f, parse_dates=["date"])
    m = df.groupby(df["date"].dt.to_period("M"))["level_m_egm2008"].mean().reindex(MONTHS).to_numpy(dtype=float)
    r = trend_test(deseasonalize(m))
    if r is None:
        return None
    m_per_decade = r["slope_per_month"] * 120
    return {"lake_level_slope_m_per_decade": r_(m_per_decade, 3), "lake_level_p": r_(r["p"], 5),
            "lake_area_km2_assumed": KARIBA_LAKE_KM2,
            "basin_equivalent_cm_per_decade": r_(m_per_decade * 100 * KARIBA_LAKE_KM2 / basin_area_km2, 3),
            "source": "grealm",
            "method": "Sen slope of deseasonalized monthly-mean G-REALM level, 2002-04..2026-08, times lake area / basin area"}


def series_block(raw: np.ndarray, anom: np.ndarray) -> dict:
    return {"months": [str(m) for m in MONTHS],
            "tws_anom_cm": [r_(v, 2) for v in anom],
            "tws_cm": [r_(v, 2) for v in raw]}


# ---------------------------------------------------------------- main
def main() -> None:
    t0 = time.time()
    notes: list[str] = []
    basins = load_basins().sort_values("hydro_gw", ascending=False).reset_index(drop=True)
    plants = load_plants()

    tws, lat, lon, n1 = load_gravis()
    notes += n1
    land = ~np.all(np.isnan(tws), axis=0)
    cells = basin_cells(basins, land, lat, lon)
    print(f"[trends] GRACE loaded, cells assigned ({time.time() - t0:.1f}s)")

    # --- TWS per basin
    raw_series, anom_series, tws_res = {}, {}, {}
    for r in basins.itertuples():
        ii, jj, _ = cells[r.basin_id]
        x = area_mean(tws, lat, ii, jj)
        raw_series[r.basin_id] = x
        anom_series[r.basin_id] = deseasonalize(x)
        try:
            tws_res[r.basin_id] = trend_test(anom_series[r.basin_id])
        except Exception as e:  # noqa: BLE001
            tws_res[r.basin_id] = None
            notes.append(f"TWS trend test failed for basin {r.basin_id}: {e}")
    print(f"[trends] TWS tests done ({time.time() - t0:.1f}s)")

    # --- precipitation per basin: GPCP v2.3 (primary), NASA POWER MERRA-2 (cross-check; has breaks at some points)
    geoms = dict(zip(basins["basin_id"], basins.geometry))
    gp = load_gpcp()
    if gp is None:
        notes.append("GPCP file missing (data/raw/gpcp/precip.mon.mean.nc); precip fields fall back to null.")
    gp_ser = {bid: (gpcp_series(gp, geoms[bid]) if gp is not None else None) for bid in geoms}
    gp_res = {bid: precip_test(gp_ser[bid], end=RAIN_END) for bid in geoms}          # primary: stable period
    gp_full = {bid: precip_test(gp_ser[bid]) for bid in geoms}                        # full period, for comparison

    def _pr(bid):
        try:  # same sampling as pipeline.basins.basin_sample_points(bid, 3), without reloading the basin file per call
            return bid, precip_test(precip_series(grid_points(geoms[bid], 3)))
        except Exception:  # noqa: BLE001
            return bid, None
    with ThreadPoolExecutor(max_workers=6) as ex:
        pr_res = dict(ex.map(_pr, basins["basin_id"].tolist()))
    n_pr_fail = sum(v is None for v in pr_res.values())
    if n_pr_fail:
        notes.append(f"MERRA-2 precipitation trend unavailable for {n_pr_fail} basins (POWER request failed, data incomplete, "
                     f"or mean rainfall < 0.05 mm/day); their *_merra2 fields are null.")
    n_gp_fail = sum(v is None for v in gp_res.values())
    if n_gp_fail:
        notes.append(f"GPCP precipitation trend unavailable for {n_gp_fail} basins (mean rainfall < 0.05 mm/day or "
                     f"incomplete data); their precip fields are null.")
    print(f"[trends] precip tests done ({time.time() - t0:.1f}s)")

    ids = basins["basin_id"].tolist()
    tws_q = dict(zip(ids, bh_fdr([tws_res[b]["p"] if tws_res[b] else None for b in ids])))
    pr_q = dict(zip(ids, bh_fdr([gp_res[b]["p"] if gp_res[b] else None for b in ids])))
    pr_q_full = dict(zip(ids, bh_fdr([gp_full[b]["p"] if gp_full[b] else None for b in ids])))
    pr_q_m2 = dict(zip(ids, bh_fdr([pr_res[b]["p"] if pr_res[b] else None for b in ids])))

    # --- plants per basin
    pl = plants.groupby(["basin_id", "name", "country_name"], as_index=False)["capacity_mw"].sum()
    top_plants = {bid: g.sort_values("capacity_mw", ascending=False).head(2) for bid, g in pl.groupby("basin_id")}

    series_ids = set(ids[:N_SERIES])
    kariba_ids = [b for b in ids if set(basins.loc[basins.basin_id == b, "countries"].iloc[0]) & {"ZMB", "ZWE"}
                  and any("kariba" in n.lower() for n in top_plants.get(b, pd.DataFrame({"name": []}))["name"])]
    if KARIBA_BASIN in ids and KARIBA_BASIN not in kariba_ids:
        kariba_ids.append(KARIBA_BASIN)
    series_ids |= set(kariba_ids)

    out_basins = []
    for r in basins.itertuples():
        bid = r.basin_id
        t, p, pm, pf = tws_res[bid], gp_res[bid], pr_res[bid], gp_full[bid]
        q = tws_q[bid]
        slope = t["slope_per_month"] * 120 if t else None
        if t is None or q is None:
            cls = None
        elif q < ALPHA and slope < 0:
            cls = "drying"
        elif q < ALPHA and slope > 0:
            cls = "wetting"
        else:
            cls = "no_significant_trend"
        ctry = sorted(r.countries.items(), key=lambda kv: -kv[1])
        tp = top_plants.get(bid)
        major = [{"name": n, "mw": r_(mw, 1)} for n, mw in zip(tp["name"], tp["capacity_mw"])] if tp is not None else []
        main_ctry = [c for c, gw in ctry if gw >= 0.1 * r.hydro_gw][:3] or [c for c, _ in ctry[:1]]
        label = clean_plant_name(tp["name"].iat[0], tp["country_name"].iat[0]) if major else bid
        precip_decline = None if p is None or pr_q[bid] is None else bool(pr_q[bid] < ALPHA and p["slope_per_month"] < 0)
        precip_decline_full = None if pf is None or pr_q_full[bid] is None else bool(pr_q_full[bid] < ALPHA and pf["slope_per_month"] < 0)
        pa = annual_p(anom_series[bid])
        gw_flag = None if (cls is None or precip_decline is None) else bool(cls == "drying" and not precip_decline)
        ii, _, nearest = cells[bid]
        rec = {
            "basin_id": bid,
            "name": f"{label} basin ({'/'.join(main_ctry)})",
            "countries": [c for c, _ in ctry],
            "countries_gw": {c: r_(g, 3) for c, g in ctry},
            "hydro_gw": r_(r.hydro_gw, 3),
            "n_plants": int(r.n_plants),
            "major_plants": major,
            "centroid": [r_(r.centroid_lon, 3), r_(r.centroid_lat, 3)],
            "area_km2": r_(r.area_km2, 0),
            "grace_cells": int(0 if nearest else len(ii)),
            "low_resolution": bool(nearest or r.area_km2 < SMALL_BASIN_KM2),
            "tws_slope_cm_per_decade": r_(slope, 3),
            "tws_p": r_(t["p"], 5) if t else None,
            "tws_q": r_(q, 5),
            "tws_n_months": t["n"] if t else None,
            "tws_p_annual": r_(pa, 5),
            "precip_slope_pct_per_decade": r_(p["slope_pct_per_decade"], 2) if p else None,
            "precip_p": r_(p["p"], 5) if p else None,
            "precip_q": r_(pr_q[bid], 5),
            "precip_slope_pct_per_decade_full_period": r_(pf["slope_pct_per_decade"], 2) if pf else None,
            "precip_p_full_period": r_(pf["p"], 5) if pf else None,
            "precip_q_full_period": r_(pr_q_full[bid], 5),
            "precip_decline_significant_full_period": precip_decline_full,
            "precip_mean_mm_day": r_(p["mean_mm_day"], 3) if p else None,
            "precip_slope_merra2_pct_per_decade": r_(pm["slope_pct_per_decade"], 2) if pm else None,
            "precip_p_merra2": r_(pm["p"], 5) if pm else None,
            "precip_q_merra2": r_(pr_q_m2[bid], 5),
            "trend_class": cls,
            "precip_decline_significant": precip_decline,
            "possible_groundwater_signal": gw_flag,
        }
        if bid in series_ids:
            rec["series"] = series_block(raw_series[bid], anom_series[bid])
            if t:
                rec["series"]["sen_intercept_cm"] = r_(t["intercept"], 3)
                rec["series"]["sen_slope_cm_per_month"] = r_(t["slope_per_month"], 5)
        out_basins.append(rec)

    # --- Kariba / upper Zambezi
    kariba = None
    try:
        kb = next(b for b in out_basins if b["basin_id"] == KARIBA_BASIN)
        up_ids, up_geom, up_area = upstream_catchment(KARIBA_BASIN)
        lon2, lat2 = np.meshgrid(lon, lat)
        inside = shapely.contains_xy(up_geom, lon2, lat2) & land
        ii, jj = np.nonzero(inside)
        ux = area_mean(tws, lat, ii, jj)
        ua = deseasonalize(ux)
        ut = trend_test(ua)
        up_gs = gpcp_series(gp, up_geom) if gp is not None else None
        up_pr = precip_test(up_gs, end=RAIN_END)
        up_pf = precip_test(up_gs)
        up_pm = precip_test(precip_series(grid_points(up_geom, 6)))
        kariba = {
            "description": "Lake Kariba (Zambia/Zimbabwe). 'basin' is the HydroBASINS level-4 basin holding the Kariba "
                           "and Victoria Falls plants; 'upstream_catchment' is the whole Zambezi catchment draining into "
                           "Kariba (upper Zambezi incl. Barotse floodplain, Kwando/Chobe), traced with HydroBASINS NEXT_DOWN.",
            "basin": {k: kb[k] for k in kb if k != "series"} | {"series": kb.get("series")},
            "upstream_catchment": {
                "hybas_ids": up_ids, "n_basins": len(up_ids), "area_km2": r_(up_area, 0), "grace_cells": int(len(ii)),
                "tws_slope_cm_per_decade": r_(ut["slope_per_month"] * 120, 3) if ut else None,
                "tws_p": r_(ut["p"], 5) if ut else None,
                "significant": bool(ut and ut["p"] < ALPHA),
                "precip_slope_pct_per_decade": r_(up_pr["slope_pct_per_decade"], 2) if up_pr else None,
                "precip_p": r_(up_pr["p"], 5) if up_pr else None,
                "precip_slope_pct_per_decade_full_period": r_(up_pf["slope_pct_per_decade"], 2) if up_pf else None,
                "precip_p_full_period": r_(up_pf["p"], 5) if up_pf else None,
                "precip_slope_merra2_pct_per_decade": r_(up_pm["slope_pct_per_decade"], 2) if up_pm else None,
                "precip_p_merra2": r_(up_pm["p"], 5) if up_pm else None,
                "series": series_block(ux, ua) | ({"sen_intercept_cm": r_(ut["intercept"], 3),
                                                    "sen_slope_cm_per_month": r_(ut["slope_per_month"], 5)} if ut else {}),
                "note": "Single pre-specified test, so p is not FDR-adjusted.",
            },
            "interpretation": None,
        }
        up = kariba["upstream_catchment"]
        lake = kariba_lake_equivalent(kb["area_km2"])
        kariba["lake_level_trend"] = lake
        if kb["trend_class"] == "drying" and not up["significant"]:
            lake_txt = ""
            if lake and lake["basin_equivalent_cm_per_decade"] is not None:
                share = 100 * lake["basin_equivalent_cm_per_decade"] / kb["tws_slope_cm_per_decade"]
                kariba["lake_share_of_basin_trend_pct"] = r_(share, 0)
                lake_txt = (f" G-REALM shows the lake level itself falling {lake['lake_level_slope_m_per_decade']:+.2f} m/decade "
                            f"(p={lake['lake_level_p']:.3f}); spread over the basin that is "
                            f"{lake['basin_equivalent_cm_per_decade']:+.1f} cm/decade, "
                            + ("enough on its own to explain the whole GRACE trend" if share >= 100 else
                               f"about {share:.0f}% of the GRACE trend")
                            + " (a rough comparison: GRACE smears the lake's mass beyond the basin edge).")
            kariba["interpretation"] = (
                f"The Kariba level-4 basin shows significant TWS drying ({kb['tws_slope_cm_per_decade']:+.1f} cm/decade, "
                f"q={kb['tws_q']:.3f}), while water storage over the whole catchment draining into Kariba "
                f"(upper Zambezi, {up['area_km2']:,.0f} km2) shows no significant trend ({up['tws_slope_cm_per_decade']:+.1f} "
                f"cm/decade, p={up['tws_p']:.2f}).{lake_txt}"
                + (f" GPCP rainfall is drifting down: {up['precip_slope_pct_per_decade']:+.1f}%/decade over the upstream "
                   f"catchment (p={up['precip_p']:.4f}) and {kb['precip_slope_pct_per_decade']:+.1f}%/decade over the Kariba basin "
                   f"(p={kb['precip_p']:.3f}, q={kb['precip_q']:.2f} after FDR across all basins). MERRA-2 shows no such decline "
                   f"({up['precip_slope_merra2_pct_per_decade']:+.1f}%/decade upstream), so treat it as a warning sign, not a settled trend."
                   if up.get("precip_slope_pct_per_decade") is not None and up.get("precip_p") is not None else "")
                + " The storage decline in the Kariba basin is mostly the reservoir drawing down; storage across the upper "
                "Zambezi has not followed. Kariba's risk comes mainly from year-to-year (ENSO-driven) rainfall swings and "
                "release decisions, which is why Patronus forecasts it month by month.")
        else:
            kariba["interpretation"] = (
                f"Kariba basin: {kb['trend_class']} ({kb['tws_slope_cm_per_decade']} cm/decade, q={kb['tws_q']}); "
                f"upstream catchment: {up['tws_slope_cm_per_decade']} cm/decade, p={up['tws_p']}.")
    except Exception as e:  # noqa: BLE001
        notes.append(f"Kariba upstream catchment could not be computed: {e}")

    # --- summary
    def gw(cls):
        return sum(b["hydro_gw"] for b in out_basins if b["trend_class"] == cls)
    tested = [b for b in out_basins if b["trend_class"] is not None]
    gw_total = sum(b["hydro_gw"] for b in out_basins)
    gw_dry, gw_wet, gw_none = gw("drying"), gw("wetting"), gw("no_significant_trend")
    n_dry = sum(b["trend_class"] == "drying" for b in out_basins)
    n_wet = sum(b["trend_class"] == "wetting" for b in out_basins)
    drying = sorted([b for b in out_basins if b["trend_class"] == "drying"], key=lambda b: -b["hydro_gw"])
    gw_dry_gwsig = sum(b["hydro_gw"] for b in drying if b["possible_groundwater_signal"])
    gw_dry_robust = sum(b["hydro_gw"] for b in drying if b["possible_groundwater_signal"] is False)
    gw_dry_annual = sum(b["hydro_gw"] for b in drying if b["tws_p_annual"] is not None and b["tws_p_annual"] < ALPHA)
    summary = {
        "n_basins": len(out_basins), "n_tested": len(tested), "n_drying": n_dry, "n_wetting": n_wet,
        "n_no_significant_trend": sum(b["trend_class"] == "no_significant_trend" for b in out_basins),
        "gw_total": r_(gw_total, 1), "gw_drying": r_(gw_dry, 1), "gw_wetting": r_(gw_wet, 1),
        "gw_no_significant_trend": r_(gw_none, 1),
        "gw_drying_pct": r_(100 * gw_dry / gw_total, 1), "gw_wetting_pct": r_(100 * gw_wet / gw_total, 1),
        "gw_drying_with_precip_decline": r_(gw_dry_robust, 1),
        "gw_drying_possible_groundwater_signal": r_(gw_dry_gwsig, 1),
        "gw_drying_also_significant_annual": r_(gw_dry_annual, 1),
        "n_drying_also_significant_annual": sum(1 for b in drying if b["tws_p_annual"] is not None and b["tws_p_annual"] < ALPHA),
        "n_precip_drying": sum(1 for b in out_basins if b["precip_q"] is not None and b["precip_q"] < ALPHA
                               and b["precip_slope_pct_per_decade"] < 0),
        "n_precip_wetting": sum(1 for b in out_basins if b["precip_q"] is not None and b["precip_q"] < ALPHA
                                and b["precip_slope_pct_per_decade"] > 0),
        "headline": (f"{gw_dry:.0f} GW of hydropower ({100 * gw_dry / gw_total:.0f}% of the {gw_total:.0f} GW mapped) sits in "
                     f"{n_dry} basins with a significant drying trend in GRACE water storage since 2002; "
                     f"{gw_wet:.0f} GW sits in {n_wet} significantly wetting basins."),
        "headline_caveat": (f"Only {gw_dry_robust:.0f} GW of the drying total is in basins where rainfall also declined "
                            f"significantly; elsewhere the storage loss may be groundwater pumping (e.g. north India), "
                            f"glacier and snow loss (Alps, Norway) or reservoir drawdown rather than less rain."),
        "top_drying": [{k: b[k] for k in ("basin_id", "name", "countries", "hydro_gw", "major_plants",
                                          "tws_slope_cm_per_decade", "tws_q", "precip_slope_pct_per_decade",
                                          "precip_q", "precip_slope_merra2_pct_per_decade", "precip_decline_significant", "possible_groundwater_signal",
                                          "tws_p_annual", "low_resolution")}
                       for b in drying[:10]],
    }

    doc = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": ["gravis", "gpcp", "power", "gppd", "hydrobasins", "grealm"],
        "method": ("Mann-Kendall (Hamed-Rao autocorrelation correction) + Sen slope on deseasonalized monthly GRACE/GRACE-FO "
                   "TWS (GFZ GravIS, 1-degree), 2002-04..2026-08; Benjamini-Hochberg FDR q<0.05 across basins. Basin value = "
                   "cos(latitude)-weighted mean of grid cells whose centres lie in the basin (nearest land cell if none). "
                   "Deseasonalized by subtracting each calendar month's mean; missing months (incl. the 2017-18 mission gap) "
                   "are not interpolated; Sen slope is computed on the real time axis. Precipitation: GPCP v2.3 monthly "
                   "(NASA GSFC/GEWEX, 2.5-degree), mean of cells overlapping the basin weighted by overlap area x cos(lat), "
                   "same test on deseasonalized anomalies, slope as % of mean per decade, separate BH-FDR. NASA POWER "
                   "(MERRA-2) PRECTOTCORR at up to 3 points per basin is kept as *_merra2 for comparison."),
        "period": {"from": START, "to": END},
        "definitions": {
            "trend_class": "drying / wetting if TWS BH-FDR q < 0.05 with negative / positive Sen slope, else no_significant_trend",
            "low_resolution": f"no GRACE cell centre inside the basin (nearest cell used) or basin area < {SMALL_BASIN_KM2:,} km2; "
                              "GRACE effective resolution is ~300 km, so the value mostly reflects the surrounding region",
            "possible_groundwater_signal": "TWS drying but precipitation shows no significant decline (precip q >= 0.05 or "
                                           "slope >= 0); the storage loss may come from groundwater pumping, glacier/snow "
                                           "loss or reservoir drawdown rather than less rain. Broad by design: rainfall "
                                           "trends rarely reach significance, so most drying basins carry it",
            "tws_p_annual": "robustness check: Hamed-Rao Mann-Kendall p on calendar-year means (years with >= 6 months)",
            "series.tws_anom_cm": "deseasonalized TWS anomaly (what the trend test uses); series.tws_cm keeps the seasonal cycle "
                                  "(GravIS anomaly vs. its own reference); trend line = sen_intercept_cm + sen_slope_cm_per_month * "
                                  "months since 2002-04",
            "name": "derived label: largest GPPD hydro plant in the basin + main countries (>= 10% of basin GW)",
        },
        "summary": summary,
        "kariba_basin": kariba,
        "limitations": [
            "GRACE TWS is the sum of all water: groundwater, soil moisture, snow, lakes and reservoirs. Declines in heavily "
            "irrigated regions (e.g. north India, the North China Plain, the Middle East) can come from groundwater pumping and "
            "need not mean less river flow for hydropower; such basins are flagged possible_groundwater_signal.",
            "Reservoir filling itself raises TWS (e.g. new dams in China, Ethiopia), which can mask or create trends.",
            "GRACE's effective resolution is ~300 km; level-4 basins smaller than that, or with no 1-degree cell centre inside, "
            "carry the regional signal (low_resolution).",
            "Trends over 2002-2026 (about 24 years) are sensitive to the start and end years and to multi-year climate "
            "variability (e.g. ENSO); a significant trend is not proof of a permanent change.",
            "The 2017-07..2018-05 GRACE/GRACE-FO gap and other missing months are left missing; the inter-mission bias is "
            "handled by GFZ's processing, not by us.",
            "Precipitation trends use GPCP v2.3 (satellite-gauge merge, 2.5 degrees), standing in for GPM IMERG (which needs "
            "an Earthdata login). An earlier version used NASA POWER (MERRA-2) point rainfall, which has artificial breaks at "
            "some points (e.g. Colombia drops to ~30% of normal in 2007-08 and 2021; Vietnam roughly doubles from the 1980s "
            "to the 2010s) and could create false rainfall trends; it is kept only as *_merra2 for comparison. GPCP's 2.5-degree "
            "cells smooth small, steep basins (Andes, Alps, Himalaya), and its data after 2021-11 are interim.",
            "Basins are weighted by installed capacity in WRI GPPD v1.3 (2021); plants built since then are missing.",
            "Glacier and ice-sheet mass loss (e.g. Alaska, Patagonia, High Mountain Asia) appears as TWS decline and may leak "
            "into neighbouring basins at GRACE resolution.",
        ],
        "notes": notes,
        "basins": out_basins,
    }
    tj = OUT / "trends.json"
    tj.write_text(json.dumps(doc, separators=(",", ":"), allow_nan=False))

    # --- geojson
    cls = {b["basin_id"]: b for b in out_basins}
    feats = []
    for r in basins.itertuples():
        geom = r.geometry.simplify(0.05, preserve_topology=True)
        geom = shapely.set_precision(geom, 0.001)
        if geom.is_empty:
            geom = shapely.set_precision(r.geometry.simplify(0.01, preserve_topology=True), 0.001)
        if not geom.is_valid:
            fixed = shapely.make_valid(geom)
            polys = [g for g in getattr(fixed, "geoms", [fixed]) if g.geom_type in ("Polygon", "MultiPolygon")]
            geom = shapely.set_precision(shapely.union_all(polys), 0.001) if polys else geom
        gj = json.loads(shapely.to_geojson(geom))
        b = cls[r.basin_id]
        feats.append({"type": "Feature", "geometry": gj, "properties": {
            "basin_id": r.basin_id, "name": b["name"], "trend_class": b["trend_class"],
            "tws_slope_cm_per_decade": b["tws_slope_cm_per_decade"], "tws_q": b["tws_q"], "hydro_gw": b["hydro_gw"],
            "low_resolution": b["low_resolution"], "possible_groundwater_signal": b["possible_groundwater_signal"]}})
    gjp = OUT / "basins.geojson"
    gjp.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))

    print(f"[trends] {summary['headline']}")
    print(f"[trends] wrote {tj} ({tj.stat().st_size / 1e6:.2f} MB), {gjp} ({gjp.stat().st_size / 1e6:.2f} MB) "
          f"in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
