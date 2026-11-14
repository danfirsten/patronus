"""Data loading for the Lake Kariba forecast.

Everything here is real, downloaded data:
  * G-REALM 10-day satellite altimetry of Lake Kariba (NASA/USDA, lake000394)
  * GFZ GravIS GRACE/GRACE-FO terrestrial water storage grid (1 deg)
  * NASA POWER (MERRA-2) daily precipitation and root-zone soil wetness
  * NOAA ONI
  * HydroBASINS level-5 polygons, used to delineate the catchment above Kariba dam

The storage curve (level -> usable %) is fitted to ZRA-published level/storage pairs.
"""
from __future__ import annotations

import json
import time
from functools import lru_cache

import numpy as np
import pandas as pd
import requests

from pipeline.paths import CACHE, RAW

# --------------------------------------------------------------------------------------
# Operating band and storage curve
# --------------------------------------------------------------------------------------
MIN_OP_M = 475.50   # ZRA minimum operating level (0 % usable)
MAX_OP_M = 488.50   # ZRA full supply level (100 % usable)
WARNING_PCT = 20.0
DANGER_PCT = 10.0
# 23.77 BCM is 36.68 % of usable storage (ZRA, 14 Oct 2026) -> usable capacity
USABLE_CAPACITY_BCM = 23.77 / 0.3668   # = 64.8 BCM

# ZRA-published (level, usable %) pairs. The two ends of the band are exact by definition.
ZRA_POINTS = [
    {"level_m": 475.50, "usable_pct": 0.0, "date": None, "note": "minimum operating level (definition)"},
    {"level_m": 475.91, "usable_pct": 2.89, "date": "2024-12-11", "note": "ZRA lake-level bulletin"},
    {"level_m": 479.98, "usable_pct": 31.7, "date": "2026-11-10", "note": "ZRA lake-level bulletin (approx.)"},
    {"level_m": 480.65, "usable_pct": 36.68, "date": "2026-10-14", "note": "ZRA: 23.77 BCM usable"},
    {"level_m": 488.50, "usable_pct": 100.0, "date": None, "note": "full supply level (definition)"},
]


def _fit_storage_curve():
    """Quadratic usable% = a*x + b*x^2 with x = level - 475.5.

    The curve is forced through 0 % at 475.5 m and 100 % at 488.5 m, and the remaining
    coefficient is chosen by least squares on the three interior ZRA points. A quadratic with
    b > 0 is convex: each extra metre holds more water because the lake area grows with level.
    """
    span = MAX_OP_M - MIN_OP_M
    # constraint a*span + b*span^2 = 100  ->  a = (100 - b*span^2)/span
    xs = np.array([p["level_m"] - MIN_OP_M for p in ZRA_POINTS[1:-1]])
    ys = np.array([p["usable_pct"] for p in ZRA_POINTS[1:-1]])
    # y = (100/span) x + b (x^2 - span x)
    g = xs ** 2 - span * xs
    b = float(np.sum(g * (ys - 100 / span * xs)) / np.sum(g * g))
    a = (100 - b * span ** 2) / span
    return a, b


CURVE_A, CURVE_B = _fit_storage_curve()


def level_to_pct(level):
    """Usable storage in % of the 64.8 BCM live capacity. Below 475.5 m it goes negative
    (water below the minimum operating level); callers clip for display."""
    x = np.asarray(level, dtype=float) - MIN_OP_M
    return CURVE_A * x + CURVE_B * x * x


def pct_to_level(pct):
    pct = np.asarray(pct, dtype=float)
    # solve b x^2 + a x - pct = 0 for the positive root
    disc = CURVE_A ** 2 + 4 * CURVE_B * pct
    x = (-CURVE_A + np.sqrt(np.maximum(disc, 0))) / (2 * CURVE_B)
    return MIN_OP_M + x


def pct_to_bcm(pct):
    return np.asarray(pct, dtype=float) / 100.0 * USABLE_CAPACITY_BCM


def bcm_to_pct(bcm):
    return np.asarray(bcm, dtype=float) / USABLE_CAPACITY_BCM * 100.0


def storage_curve_points():
    levels = np.round(np.arange(475.0, 489.01, 0.5), 2)
    return [{"level_m": float(l), "usable_pct": round(float(level_to_pct(l)), 2),
             "usable_bcm": round(float(pct_to_bcm(level_to_pct(l))), 2)} for l in levels]


# --------------------------------------------------------------------------------------
# Lake levels (G-REALM)
# --------------------------------------------------------------------------------------
def load_levels() -> pd.DataFrame:
    """10-day G-REALM levels (m above EGM2008 geoid)."""
    d = pd.read_csv(RAW / "kariba_grealm_10day_levels.csv", parse_dates=["date"])
    d = d.rename(columns={"level_m_egm2008": "level_m"}).sort_values("date").reset_index(drop=True)
    d["usable_pct"] = level_to_pct(d["level_m"])
    return d


def daily_level(levels: pd.DataFrame) -> pd.Series:
    """Daily level by linear interpolation between passes (gaps are at most ~60 days)."""
    s = levels.set_index("date")["level_m"]
    s = s[~s.index.duplicated()]
    idx = pd.date_range(s.index.min(), s.index.max(), freq="D")
    return s.reindex(s.index.union(idx)).interpolate("time").reindex(idx)


def monthly_levels(levels: pd.DataFrame) -> pd.DataFrame:
    """Monthly mean level from the daily interpolation, with the number of real passes in
    the month and a gap flag when no pass fell in the month."""
    dl = daily_level(levels)
    m = dl.resample("MS").mean().to_frame("level_m")
    n = levels.set_index("date")["level_m"].resample("MS").count().reindex(m.index).fillna(0)
    m["n_obs"] = n.astype(int)
    m["gap"] = m["n_obs"] == 0
    m["usable_pct"] = level_to_pct(m["level_m"])
    # first month is partial (starts 22 Nov 1992); keep but it is flagged by n_obs
    return m


def month_end_level(levels: pd.DataFrame) -> pd.Series:
    dl = daily_level(levels)
    return dl.resample("ME").last().rename(lambda t: t.to_period("M").to_timestamp())


# --------------------------------------------------------------------------------------
# Catchment above Kariba dam (HydroBASINS level 5)
# --------------------------------------------------------------------------------------
KARIBA_DAM = (28.76, -16.52)


@lru_cache(maxsize=1)
def catchment_polygon():
    import geopandas as gpd
    from shapely.geometry import Point
    g = gpd.read_file(RAW / "hydrobasins" / "hybas_af_lev05_v1c.shp")
    root = g[g.contains(Point(*KARIBA_DAM))]["HYBAS_ID"].iloc[0]
    up = {}
    for h, d in zip(g.HYBAS_ID, g.NEXT_DOWN):
        up.setdefault(d, []).append(h)
    ids, stack = set(), [root]
    while stack:
        x = stack.pop()
        ids.add(x)
        stack += up.get(x, [])
    c = g[g.HYBAS_ID.isin(ids)]
    return c.union_all(), float(c.SUB_AREA.sum())


def catchment_points():
    """Regular 2-degree grid of POWER sample points that fall inside the catchment."""
    from shapely.geometry import Point
    poly, _ = catchment_polygon()
    pts = [(round(lo, 1), round(la, 1)) for lo in np.arange(18.5, 30.6, 2.0)
           for la in np.arange(-10.5, -20.6, -2.0) if poly.contains(Point(lo, la))]
    return pts


# --------------------------------------------------------------------------------------
# NASA POWER (daily, cached)
# --------------------------------------------------------------------------------------
POWER_DIR = CACHE / "power"
POWER_DIR.mkdir(parents=True, exist_ok=True)
POWER_PARAMS = "PRECTOTCORR,GWETROOT,GWETTOP,T2M"
POWER_END = "20261113"


def _power_daily_raw(lon: float, lat: float) -> dict:
    f = POWER_DIR / f"kariba_daily_{lon:g}_{lat:g}.json"
    if f.exists() and f.stat().st_size > 1000:
        return json.loads(f.read_text())
    url = "https://power.larc.nasa.gov/api/temporal/daily/point"
    params = {"parameters": POWER_PARAMS, "community": "AG", "longitude": lon, "latitude": lat,
              "start": "19810101", "end": POWER_END, "format": "JSON"}
    for i in range(5):  # sequential, retry with backoff
        try:
            r = requests.get(url, params=params, timeout=180)
            if r.status_code == 200:
                js = r.json()
                f.write_text(json.dumps(js))
                time.sleep(1.0)
                return js
        except requests.RequestException:
            pass
        time.sleep(2 ** (i + 1))
    raise RuntimeError(f"POWER daily request failed at {lon},{lat}")


def power_daily_catchment() -> pd.DataFrame:
    """Daily catchment-mean precipitation (mm/day) and root-zone wetness (0-1),
    equal-weighted over the POWER points inside the catchment."""
    frames = []
    for lon, lat in catchment_points():
        js = _power_daily_raw(lon, lat)
        p = js["properties"]["parameter"]
        df = pd.DataFrame({k: pd.Series(v) for k, v in p.items()})
        df.index = pd.to_datetime(df.index, format="%Y%m%d")
        df = df.replace(-999.0, np.nan)
        frames.append(df)
    allp = pd.concat(frames, keys=range(len(frames)))
    return allp.groupby(level=1).mean()


def power_monthly_catchment() -> pd.DataFrame:
    """Monthly catchment means. A month is kept only if it is complete in the daily record."""
    d = power_daily_catchment()
    cnt = d["PRECTOTCORR"].resample("MS").count()
    days = d["PRECTOTCORR"].resample("MS").size()
    m = d.resample("MS").mean()
    m["complete"] = cnt == m.index.days_in_month
    m.loc[~m["complete"], ["PRECTOTCORR", "GWETROOT", "GWETTOP", "T2M"]] = np.nan
    m["precip_mm"] = m["PRECTOTCORR"] * m.index.days_in_month
    return m


# --------------------------------------------------------------------------------------
# GRACE / GRACE-FO TWS over the catchment
# --------------------------------------------------------------------------------------
def grace_catchment() -> pd.Series:
    """Area-weighted mean TWS anomaly (cm) over 1-degree GravIS cells whose centre is inside
    the catchment. Cached to data/cache/kariba_tws_catchment.csv."""
    f = CACHE / "kariba_tws_catchment.csv"
    if f.exists():
        s = pd.read_csv(f, parse_dates=["month"]).set_index("month")["tws_cm"]
        return s
    import xarray as xr
    from shapely.geometry import Point
    poly, _ = catchment_polygon()
    ds = xr.open_dataset(RAW / "gravis_tws_grid.nc")
    sub = ds["tws"].sel(lat=slice(-10, -21.5), lon=slice(18, 32))
    lats, lons = sub["lat"].values, sub["lon"].values
    mask = np.array([[poly.contains(Point(float(lo), float(la))) for lo in lons] for la in lats])
    w = np.cos(np.deg2rad(lats))[:, None] * mask
    vals = sub.values  # (time, lat, lon)
    units = str(ds["tws"].attrs.get("units", ""))
    tws = np.nansum(vals * w[None], axis=(1, 2)) / np.sum(w)
    if units.strip().lower() in ("m", "meter", "metre", "m of equivalent water height"):
        tws = tws * 100.0
    t = pd.to_datetime(sub["time"].values).to_period("M").to_timestamp()
    s = pd.Series(tws, index=t, name="tws_cm")
    s = s[~s.index.duplicated()]
    s.rename_axis("month").to_frame().to_csv(f)
    return s


# --------------------------------------------------------------------------------------
# ONI
# --------------------------------------------------------------------------------------
SEASONS = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"]


def load_oni() -> pd.Series:
    """ONI indexed by the LAST month of its 3-month season (DJF 1951 -> Feb 1951)."""
    rows = []
    for line in (RAW / "oni.ascii.txt").read_text().splitlines()[1:]:
        p = line.split()
        if len(p) != 4:
            continue
        seas, yr, _, anom = p
        k = SEASONS.index(seas)
        last_month = k + 2  # 1-based month of the season's final month (DJF->2,...,NDJ->13)
        y, m = int(yr), last_month
        if m > 12:
            y, m = y + 1, m - 12
        rows.append((pd.Timestamp(y, m, 1), float(anom), seas, int(yr)))
    df = pd.DataFrame(rows, columns=["month", "oni", "season", "year"]).set_index("month")
    return df["oni"]


def oni_djf() -> pd.Series:
    """DJF ONI by the year of the January/February (e.g. DJF 2023/24 -> 2024)."""
    o = load_oni()
    djf = o[o.index.month == 2]
    return pd.Series(djf.values, index=djf.index.year)
