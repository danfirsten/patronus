"""Trend Detective data: small monthly series per region, so the browser can run the trend statistics live.

Answers the Space Apps "Be An Earth System Trend Detective!" challenge directly: the user picks a region and a
variable, the web page (web/src/pages/Explore.tsx) removes the seasonal cycle, fits Sen's slope, runs Mann-Kendall
(optionally with the Hamed-Rao autocorrelation correction) and puts a 95% confidence interval on the slope.

Regions
  * river basins: the HydroBASINS level-4 basins whose series trends.json publishes (the largest by hydro GW, plus
    the Kariba basin), same GRACE cells and GPCP weights as pipeline.trends
  * the upper Zambezi catchment draining into Kariba (pipeline.trends.upstream_catchment)
  * the 24 tier-1 country grids (capacity-weighted sampling points near the hydro plants, pipeline.gen_points)
  * reservoirs with a G-REALM satellite lake-level record (pipeline.reservoir_catalog.LAKES, plus any extra
    reservoirs in web/public/data/reservoirs.json if that file exists)

Variables: GRACE/GRACE-FO TWS, GPCP rain, MERRA-2 (NASA POWER) root-zone and surface soil wetness, 2 m temperature
and rain, G-REALM lake level, Ember hydro generation (tier-1 grids), and the ONI ENSO index (global).

Writes web/public/data/explorer/index.json, explorer/global.json and explorer/r/{region_id}.json.
index.json carries a `validation` block: the browser's statistics, reimplemented here line by line
(`browser_stats`), against trends.json for five basins.

    python3 -m pipeline.explorer
"""
from __future__ import annotations

import json
import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import shapely

from pipeline import trends as T
from pipeline.basins import load_basins
from pipeline.paths import OUT, RAW
from pipeline.power import monthly_point

OUTDIR = OUT / "explorer"
RDIR = OUTDIR / "r"
AXIS_START = "1981-01"
POWER_LAND_END = "2026-09"   # POWER soil wetness / temperature step change from 2026-10 (see DESIGN.md section 12)
RAIN_STABLE_END = "2019-12"  # GPCP drifts dry after 2019 (pipeline.trends.RAIN_END)
# Reservoirs impounded after G-REALM's record began: earlier "levels" are the river or a filling lake, which would
# give a huge, meaningless rising trend. Start each lake series at the first year it reached its normal pool
# (read off the G-REALM record itself; Three Gorges first reached 175 m in Oct 2010).
FILLED_FROM = {"001992": "2012-01", "004034": "2008-01", "001619": "2010-11"}

VARIABLES = [
    {"id": "tws", "name": "Total water storage", "short": "Water storage",
     "definition": "All the water stored on and under the land (lakes, rivers, soil moisture, groundwater, snow and ice), "
                   "weighed from space by how much it pulls on two satellites. Shown as the difference from the long-term average.",
     "units": "cm of water", "unit_short": "cm", "rate_unit": "cm of water per decade", "rate_mode": "abs", "decimals": 1,
     "source": "GRACE / GRACE-FO satellites (NASA, DLR, GFZ); GFZ GravIS Level-3 grid", "mission": "GRACE/GRACE-FO",
     "nasa": True, "default_period": ["2002-04", None],
     "caveats": ["No data between GRACE and GRACE-FO (2017-07 to 2018-05) and a few other single months; gaps are left empty, not filled.",
                 "The satellites see blobs about 300 km across, so small basins and reservoirs blur into their surroundings."]},
    {"id": "rain", "name": "Rainfall (GPCP)", "short": "Rainfall",
     "definition": "How much rain and snow falls, averaged over each month, from a blend of satellite and rain-gauge measurements.",
     "units": "mm per day", "unit_short": "mm/day", "rate_unit": "% of average rain per decade", "rate_mode": "pct", "decimals": 2,
     "source": "GPCP v2.3 monthly precipitation (NASA GSFC / GEWEX, served by NOAA PSL)", "mission": "GPCP",
     "nasa": True, "default_period": ["2002-01", RAIN_STABLE_END],
     "caveats": ["GPCP reads too dry after 2019 in several regions (we checked it against MERRA-2 and against Lake Kariba's "
                 "satellite water level). The default window stops at 2019 for that reason."],
     "warning": "GPCP drifts dry after 2019. Trends that include 2020 onwards can show a drying that is not real."},
    {"id": "rain_m2", "name": "Rainfall (MERRA-2 model)", "short": "Rainfall (model)",
     "definition": "Monthly rainfall from NASA's MERRA-2 reanalysis: a weather model that is constantly corrected with observations.",
     "units": "mm per day", "unit_short": "mm/day", "rate_unit": "% of average rain per decade", "rate_mode": "pct", "decimals": 2,
     "source": "NASA MERRA-2 via NASA POWER (PRECTOTCORR)", "mission": "MERRA-2", "nasa": True, "default_period": ["2002-01", None],
     "caveats": ["At a few places MERRA-2 rainfall has artificial jumps (for example Colombia in 2008 and 2021, Vietnam from 2016-17). "
                 "Compare with GPCP before trusting a trend.", "Sampled at a few points inside the region, not a full area average."]},
    {"id": "soil_root", "name": "Root-zone soil wetness", "short": "Root-zone soil",
     "definition": "How wet the soil is down to about 1 metre, where plant roots drink: 0% is bone dry, 100% is fully soaked.",
     "units": "% wetness", "unit_short": "%", "rate_unit": "percentage points per decade", "rate_mode": "abs", "decimals": 1,
     "source": "NASA MERRA-2 via NASA POWER (GWETROOT)", "mission": "MERRA-2", "nasa": True, "default_period": ["1981-01", POWER_LAND_END],
     "caveats": ["NASA POWER soil wetness has a step change from October 2026, so the series stops at September 2026.",
                 "Model output, sampled at a few points inside the region."]},
    {"id": "soil_top", "name": "Surface soil wetness", "short": "Surface soil",
     "definition": "How wet the top 5 cm of soil is: 0% is bone dry, 100% is fully soaked. It reacts within days to rain and heat.",
     "units": "% wetness", "unit_short": "%", "rate_unit": "percentage points per decade", "rate_mode": "abs", "decimals": 1,
     "source": "NASA MERRA-2 via NASA POWER (GWETTOP)", "mission": "MERRA-2", "nasa": True, "default_period": ["1981-01", POWER_LAND_END],
     "caveats": ["NASA POWER soil wetness has a step change from October 2026, so the series stops at September 2026.",
                 "Model output, sampled at a few points inside the region."]},
    {"id": "t2m", "name": "Air temperature", "short": "Temperature",
     "definition": "The average air temperature 2 metres above the ground, the height of a weather station.",
     "units": "°C", "unit_short": "°C", "rate_unit": "°C per decade", "rate_mode": "abs", "decimals": 2,
     "source": "NASA MERRA-2 via NASA POWER (T2M)", "mission": "MERRA-2", "nasa": True, "default_period": ["1981-01", POWER_LAND_END],
     "caveats": ["The series stops at September 2026 because of a step change in NASA POWER land fields from October 2026.",
                 "Model output, sampled at a few points inside the region."]},
    {"id": "lake", "name": "Lake water level", "short": "Lake level",
     "definition": "The height of the reservoir's surface, measured by radar satellites that pass overhead every 10 days.",
     "units": "m above sea level (EGM2008 geoid)", "unit_short": "m", "rate_unit": "m per decade", "rate_mode": "abs", "decimals": 2,
     "source": "G-REALM satellite radar altimetry (USDA FAS / NASA; TOPEX/Poseidon, Jason-1/2/3, Sentinel-6)", "mission": "G-REALM",
     "nasa": True, "default_period": ["1993-01", None],
     "caveats": ["Reservoir levels are set by people as well as by climate: dam releases and allocation rules move them.",
                 "Monthly means of 10-day passes; months without a pass are left empty."]},
    {"id": "hydro", "name": "Hydropower generation", "short": "Hydro output",
     "definition": "Electricity produced by the grid's hydropower plants each month. This is the consequence: what the water does to the lights.",
     "units": "TWh per month", "unit_short": "TWh", "rate_unit": "% of average output per decade", "rate_mode": "pct", "decimals": 3,
     "source": "Ember monthly electricity data (not NASA)", "mission": "Ember", "nasa": False, "default_period": [None, None],
     "caveats": ["New dams raise output over time, so a rising trend can mean more dams, not more water.",
                 "Monthly records start in 2010-2019 depending on the country, so many are short."]},
    {"id": "oni", "name": "El Niño index (ONI)", "short": "El Niño index",
     "definition": "How much warmer (El Niño, positive) or cooler (La Niña, negative) than normal the central Pacific Ocean is. "
                   "It shifts rain around the world.",
     "units": "°C anomaly", "unit_short": "°C", "rate_unit": "°C per decade", "rate_mode": "abs", "decimals": 2,
     "source": "NOAA Climate Prediction Center Oceanic Niño Index (not NASA)", "mission": "NOAA CPC", "nasa": False,
     "global": True, "default_period": ["2002-01", None], "seasonal": False,
     "caveats": ["The same global series for every region: it is context, not a measurement of the region.",
                 "Already an anomaly (no seasonal cycle), and a 3-month running mean, so neighbouring months are strongly linked."]},
]
VAR_IDS = [v["id"] for v in VARIABLES]
ROUND = {"tws": 2, "rain": 3, "rain_m2": 3, "soil_root": 1, "soil_top": 1, "t2m": 2, "lake": 2, "hydro": 4, "oni": 2}


# ------------------------------------------------------------------------------------------------ helpers
def _r(v, n):
    if v is None:
        return None
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v):
        return None
    out = round(v, n)
    return int(out) if n == 0 else out


def _months(end: str) -> pd.PeriodIndex:
    return pd.period_range(AXIS_START, end, freq="M")


def _on_axis(s: pd.Series, axis: pd.PeriodIndex) -> np.ndarray:
    """Series indexed by Period/Timestamp -> float array on `axis` (NaN where missing)."""
    if s is None or len(s) == 0:
        return np.full(len(axis), np.nan)
    idx = s.index
    if not isinstance(idx, pd.PeriodIndex):
        idx = pd.DatetimeIndex(idx).to_period("M")
    s = pd.Series(np.asarray(s.values, dtype=float), index=idx)
    s = s[~s.index.duplicated()]
    return s.reindex(axis).to_numpy(dtype=float)


def _trends_months_to_axis(x: np.ndarray, axis: pd.PeriodIndex) -> np.ndarray:
    return _on_axis(pd.Series(x, index=T.MONTHS), axis)


def _cut_after(x: np.ndarray, axis: pd.PeriodIndex, end: str) -> np.ndarray:
    x = x.copy()
    x[np.array([m > pd.Period(end, "M") for m in axis])] = np.nan
    return x


# ------------------------------------------------------------------------------------------------ sources
def oni_monthly() -> pd.Series:
    """ONI 3-month seasons -> centre month (DJF y -> Jan y, ..., NDJ y -> Dec y)."""
    from pipeline.enso import load_oni
    o = load_oni()
    seas = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"]
    pos = {s: i + 1 for i, s in enumerate(seas)}
    idx = [pd.Period(year=int(y), month=pos[s], freq="M") for s, y in zip(o["SEAS"], o["YR"])]
    return pd.Series(o["ANOM"].astype(float).values, index=pd.PeriodIndex(idx))


def ember_hydro() -> dict[str, pd.Series]:
    from pipeline.gen_data import _ember_monthly, _sichuan_monthly
    m = pd.concat([_ember_monthly(), _sichuan_monthly()])
    return {iso: g.set_index("month")["twh"].astype(float).sort_index() for iso, g in m.groupby("iso3")}


def power_mean(points: list[tuple[float, float, float]]) -> dict[str, pd.Series]:
    """Weighted mean of NASA POWER monthly fields over (lon, lat, weight) points. A month needs every point."""
    def one(p):
        try:
            return monthly_point(p[0], p[1], fill_recent=False)
        except Exception as e:  # noqa: BLE001
            print(f"  [explorer] POWER failed at {p[:2]}: {e}")
            return None
    with ThreadPoolExecutor(max_workers=6) as ex:
        frames = list(ex.map(one, points))
    out = {}
    for prm in ("PRECTOTCORR", "GWETROOT", "GWETTOP", "T2M"):
        parts, ws = [], []
        for p, f in zip(points, frames):
            if f is not None and prm in f:
                parts.append(f[prm].astype(float) * p[2])
                ws.append(p[2])
        if not parts:
            continue
        df = pd.concat(parts, axis=1)
        s = df.sum(axis=1, min_count=len(parts)) / sum(ws)
        s.index = pd.DatetimeIndex(s.index).to_period("M")
        out[prm] = s.dropna()
    return out


def power_series(points, axis) -> dict[str, np.ndarray]:
    pw = power_mean(points)
    res = {}
    if "PRECTOTCORR" in pw:
        res["rain_m2"] = _on_axis(pw["PRECTOTCORR"], axis)
    if "GWETROOT" in pw:
        res["soil_root"] = _cut_after(_on_axis(pw["GWETROOT"] * 100, axis), axis, POWER_LAND_END)
    if "GWETTOP" in pw:
        res["soil_top"] = _cut_after(_on_axis(pw["GWETTOP"] * 100, axis), axis, POWER_LAND_END)
    if "T2M" in pw:
        res["t2m"] = _cut_after(_on_axis(pw["T2M"], axis), axis, POWER_LAND_END)
    return res


class Gpcp:
    """GPCP on its own full time axis (1979+), so rain series are not cut to the GRACE period."""
    def __init__(self):
        import xarray as xr
        d = xr.open_dataset(T.GPCP, decode_times=False, drop_variables=["time_bnds"])
        self.per = (pd.Timestamp("1800-01-01") + pd.to_timedelta(d["time"].values, "D")).to_period("M")
        pr = d["precip"].values.astype(float)
        pr[(pr < 0) | (pr > 1e3)] = np.nan
        self.pr = pr
        self.lat = d["lat"].values.astype(float)
        lon = d["lon"].values.astype(float)
        self.lon = np.where(lon > 180, lon - 360, lon)

    def area(self, geom) -> pd.Series:
        ii, jj, ww = T.gpcp_weights(geom, self.lat, self.lon)
        v = self.pr[:, ii, jj]
        w = ww[None, :] * ~np.isnan(v)
        with np.errstate(invalid="ignore", divide="ignore"):
            x = np.where(w.sum(1) > 0, np.nansum(v * w, 1) / w.sum(1), np.nan)
        return pd.Series(x, index=self.per)

    def points(self, pts) -> pd.Series:
        acc, wsum = np.zeros(len(self.per)), 0.0
        for x, y, w in pts:
            i = int(np.abs(self.lat - y).argmin())
            j = int(np.abs(((self.lon - x + 180) % 360) - 180).argmin())
            acc = acc + self.pr[:, i, j] * w
            wsum += w
        return pd.Series(acc / wsum, index=self.per)


class Grace:
    def __init__(self):
        self.tws, self.lat, self.lon, self.notes = T.load_gravis()
        self.land = ~np.all(np.isnan(self.tws), axis=0)

    def cells_mean(self, ii, jj) -> np.ndarray:
        return T.area_mean(self.tws, self.lat, np.asarray(ii), np.asarray(jj))

    def _nearest_land(self, x, y):
        li, lj = np.nonzero(self.land)
        dx = ((self.lon[lj] - x + 180) % 360) - 180
        d = dx ** 2 + (self.lat[li] - y) ** 2
        k = int(d.argmin())
        return li[k], lj[k]

    def points(self, pts) -> np.ndarray:
        """Weighted mean of the 1-degree cells holding each (lon, lat, w) point (nearest land cell if ocean)."""
        acc, wsum = np.zeros(self.tws.shape[0]), np.zeros(self.tws.shape[0])
        for x, y, w in pts:
            i = int(np.abs(self.lat - y).argmin())
            j = int(np.abs(((self.lon - x + 180) % 360) - 180).argmin())
            if not self.land[i, j]:
                i, j = self._nearest_land(x, y)
            v = self.tws[:, i, j]
            ok = ~np.isnan(v)
            acc[ok] += v[ok] * w
            wsum[ok] += w
        with np.errstate(invalid="ignore", divide="ignore"):
            return np.where(wsum > 0, acc / wsum, np.nan)

    def box(self, x, y, half=1) -> np.ndarray:
        """Cos-lat mean of land cells in a (2*half+1)^2 block around (x, y)."""
        i0 = int(np.abs(self.lat - y).argmin())
        j0 = int(np.abs(((self.lon - x + 180) % 360) - 180).argmin())
        ii, jj = [], []
        for di in range(-half, half + 1):
            for dj in range(-half, half + 1):
                i, j = i0 + di, (j0 + dj) % len(self.lon)
                if 0 <= i < len(self.lat) and self.land[i, j]:
                    ii.append(i), jj.append(j)
        if not ii:
            i, j = self._nearest_land(x, y)
            ii, jj = [i], [j]
        return self.cells_mean(ii, jj)


def grealm_header_latlon(lake_id: str) -> tuple[float, float] | None:
    f = RAW / "grealm" / f"lake{lake_id}.10d.2.txt"
    if not f.exists():
        return None
    for line in f.read_text(errors="ignore").splitlines()[:6]:
        if "Latitude and longitude" in line:
            p = line.split()
            return float(p[0]), float(p[1])
    return None


def lake_monthly(lake_id: str) -> pd.Series | None:
    if lake_id == "000394" and (RAW / "kariba_grealm_10day_levels.csv").exists():
        df = pd.read_csv(RAW / "kariba_grealm_10day_levels.csv", parse_dates=["date"])
        df = df.rename(columns={"level_m_egm2008": "level_m"})
    else:
        from pipeline.kariba_reservoirs import read_grealm
        f = RAW / "grealm" / f"lake{lake_id}.10d.2.txt"
        if not f.exists():
            return None
        df = read_grealm(lake_id)
    if df.empty:
        return None
    return df.groupby(df["date"].dt.to_period("M"))["level_m"].mean()


# ------------------------------------------------------------------------------------------------ browser maths
# A line-by-line Python copy of web/src/components/explore/stats.ts, used to cross-check against trends.json.
def _erfc(x: float) -> float:
    """Numerical Recipes erfcc (fractional error < 1.2e-7); the same approximation the browser uses."""
    z = abs(x)
    t = 1 / (1 + 0.5 * z)
    r = t * math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (
        0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))))
    return r if x >= 0 else 2 - r


def _rank(v: np.ndarray) -> np.ndarray:
    order = np.argsort(v, kind="mergesort")
    r = np.empty(len(v))
    i = 0
    while i < len(v):
        j = i
        while j + 1 < len(v) and v[order[j + 1]] == v[order[i]]:
            j += 1
        r[order[i:j + 1]] = (i + j) / 2 + 1
        i = j + 1
    return r


def _acf(x: np.ndarray) -> np.ndarray:
    y = x - x.mean()
    n = len(y)
    c0 = float(np.dot(y, y)) / n
    return np.array([float(np.dot(y[:n - k], y[k:])) / n / c0 for k in range(n)])


def browser_stats(values: list, months: list[str], start: str, end: str, deseason: bool = True, hamed_rao: bool = True) -> dict | None:
    sel = [i for i, m in enumerate(months) if start <= m <= end]
    v = np.array([np.nan if values[i] is None else values[i] for i in sel], dtype=float)
    mo = np.array([int(months[i][5:7]) for i in sel])
    if deseason:
        v = v.copy()
        for m in range(1, 13):
            k = mo == m
            ok = k & ~np.isnan(v)
            if ok.any():
                v[k] = v[k] - v[ok].mean()
    ok = ~np.isnan(v)
    x = v[ok]
    t = np.arange(len(v), dtype=float)[ok]
    n = len(x)
    if n < 24:
        return None
    i, j = np.triu_indices(n, k=1)
    s = float(np.sign(x[j] - x[i]).sum())
    _, cnt = np.unique(x, return_counts=True)
    var_s = (n * (n - 1) * (2 * n + 5) - float(np.sum(cnt * (cnt - 1) * (2 * cnt + 5)))) / 18
    test = "mann_kendall"
    if hamed_rao:
        b_idx = float(np.median((x[j] - x[i]) / (j - i)))
        rk = _rank(x - np.arange(1, n + 1) * b_idx)
        acf = _acf(rk)
        bound = 1.959963984540054 / math.sqrt(n)
        k = np.arange(1, n)
        sig = np.abs(acf[1:]) > bound
        sni = float(np.sum(((n - k) * (n - k - 1) * (n - k - 2) * acf[1:])[sig]))
        corr = 1 + 2 / (n * (n - 1) * (n - 2)) * sni
        test = "hamed_rao"
        if not corr > 0:  # same fallback as pipeline.trends: Yue-Wang effective sample size
            acf2 = _acf(x - np.arange(1, n + 1) * b_idx)
            corr = 1 + 2 * float(np.sum((1 - k / n) * acf2[1:]))
            test = "yue_wang"
        var_s = var_s * corr
    z = 0.0 if s == 0 else (s - np.sign(s)) / math.sqrt(var_s)
    p = _erfc(abs(z) / math.sqrt(2))
    slopes = np.sort((x[j] - x[i]) / (t[j] - t[i]))
    b = float(np.median(slopes))
    N = len(slopes)
    c = 1.959963984540054 * math.sqrt(var_s)
    lo = slopes[max(0, min(N - 1, int(round((N - c) / 2)) - 1))]
    hi = slopes[max(0, min(N - 1, int(round((N + c) / 2))))]
    return {"n": n, "s": s, "z": z, "p": p, "slope_per_month": b, "lo": float(lo), "hi": float(hi), "test": test}


# ------------------------------------------------------------------------------------------------ build
def main() -> None:
    t0 = time.time()
    notes: list[str] = []
    RDIR.mkdir(parents=True, exist_ok=True)
    for f in RDIR.glob("*.json"):
        f.unlink()

    trends = json.loads((OUT / "trends.json").read_text())
    tb = {b["basin_id"]: b for b in trends["basins"]}
    series_ids = [b["basin_id"] for b in trends["basins"] if b.get("series")]

    grace = Grace()
    notes += grace.notes
    gp = Gpcp()
    oni = oni_monthly()
    hydro = ember_hydro()
    end = max(str(T.MONTHS[-1]), str(gp.per.max()), str(oni.index.max()),
              max(str(s.index.max()) for s in hydro.values()))
    axis = _months(end)
    months = [str(m) for m in axis]
    print(f"[explorer] sources loaded; axis {months[0]}..{months[-1]} ({time.time() - t0:.0f}s)")

    regions: list[dict] = []
    payload: dict[str, dict[str, np.ndarray]] = {}

    # --- river basins (same cells / weights as pipeline.trends)
    basins = load_basins()
    basins = basins[basins["basin_id"].isin(series_ids)].copy()
    basins = basins.set_index("basin_id").loc[series_ids].reset_index()
    cells = T.basin_cells(basins, grace.land, grace.lat, grace.lon)
    for r in basins.itertuples():
        b = tb[r.basin_id]
        ii, jj, _ = cells[r.basin_id]
        s = {"tws": _trends_months_to_axis(grace.cells_mean(ii, jj), axis),
             "rain": _on_axis(gp.area(r.geometry), axis)}
        pts = [(x, y, 1.0) for x, y in T.grid_points(r.geometry, 3)]
        s |= power_series(pts, axis)
        rid = f"b{r.basin_id}"
        payload[rid] = s
        regions.append({"id": rid, "name": b["name"], "type": "basin", "countries": b["countries"],
                        "lat": b["centroid"][1], "lon": b["centroid"][0], "hydro_gw": b["hydro_gw"],
                        "area_km2": b.get("area_km2"), "basin_id": r.basin_id,
                        "plants": [p["name"] for p in b.get("major_plants", [])],
                        "note": "Small basin: GRACE sees it blurred with its neighbours." if b.get("low_resolution") else None})
    print(f"[explorer] {len(series_ids)} basins ({time.time() - t0:.0f}s)")

    # --- upper Zambezi catchment above Kariba
    try:
        up_ids, up_geom, up_area = T.upstream_catchment(T.KARIBA_BASIN)
        lon2, lat2 = np.meshgrid(grace.lon, grace.lat)
        ii, jj = np.nonzero(shapely.contains_xy(up_geom, lon2, lat2) & grace.land)
        s = {"tws": _trends_months_to_axis(grace.cells_mean(ii, jj), axis), "rain": _on_axis(gp.area(up_geom), axis)}
        s |= power_series([(x, y, 1.0) for x, y in T.grid_points(up_geom, 6)], axis)
        c = up_geom.centroid
        payload["upper-zambezi"] = s
        regions.append({"id": "upper-zambezi", "name": "Upper Zambezi catchment (above Kariba)", "type": "basin",
                        "countries": ["ZMB", "AGO", "NAM", "BWA", "ZWE"], "lat": round(c.y, 3), "lon": round(c.x, 3),
                        "hydro_gw": None, "area_km2": round(up_area), "basin_id": None, "plants": [],
                        "note": f"All {len(up_ids)} HydroBASINS level-4 basins draining into Lake Kariba."})
    except Exception as e:  # noqa: BLE001
        notes.append(f"Upper Zambezi catchment skipped: {e}")

    # --- tier-1 country grids
    from pipeline.gen_data import tier1_codes
    from pipeline.gen_points import plant_centroid, points_for
    clist = {c["iso3"]: c for c in json.loads((OUT / "countries.json").read_text())["countries"]}
    for iso in tier1_codes():
        pts = points_for(iso)
        if not pts:
            notes.append(f"{iso}: no hydro plant points; skipped.")
            continue
        s = {"tws": _trends_months_to_axis(grace.points(pts), axis), "rain": _on_axis(gp.points(pts), axis)}
        s |= power_series(pts, axis)
        if iso in hydro:
            s["hydro"] = _on_axis(hydro[iso], axis)
        info = clist.get(iso, {})
        lat, lon, _ = plant_centroid(iso)
        rid = f"c-{iso.lower()}"
        payload[rid] = s
        regions.append({"id": rid, "name": f"{info.get('name', iso)} grid", "type": "country",
                        "countries": [iso.split("-")[0]], "iso3": iso,
                        "lat": _r(info.get("lat", lat), 3), "lon": _r(info.get("lon", lon), 3),
                        "hydro_gw": info.get("hydro_gw"), "area_km2": None, "plants": [],
                        "note": f"Climate variables are sampled at {len(pts)} points near the country's largest hydro plants, "
                                f"weighted by capacity; not a whole-country average."})
    print(f"[explorer] countries done ({time.time() - t0:.0f}s)")

    # --- reservoirs (G-REALM)
    from pipeline.reservoir_catalog import LAKES, match_plants
    lakes = [(key, gid, name, ctry, dams) for key, gid, name, ctry, dams, _c, _n in LAKES]
    extra = OUT / "reservoirs.json"
    if extra.exists():
        try:
            rj = json.loads(extra.read_text())
            items = rj.get("reservoirs", rj) if isinstance(rj, dict) else rj
            have = {g for _, g, *_ in lakes}
            for it in items if isinstance(items, list) else []:
                gid = str(it.get("grealm_id") or it.get("grealm") or "").zfill(6)
                if gid and gid not in have and (RAW / "grealm" / f"lake{gid}.10d.2.txt").exists():
                    lakes.append((str(it.get("id", gid)), gid, it.get("name", gid), it.get("countries") or [it.get("iso3")], []))
                    have.add(gid)
        except Exception as e:  # noqa: BLE001
            notes.append(f"reservoirs.json present but not read: {e}")
    for key, gid, name, ctry, dams in lakes:
        ll = grealm_header_latlon(gid)
        lv = lake_monthly(gid)
        if ll is None or lv is None:
            notes.append(f"{name}: no G-REALM file; skipped.")
            continue
        lat, lon = ll
        lnote = ""
        if gid in FILLED_FROM:
            lv = lv[lv.index >= pd.Period(FILLED_FROM[gid], "M")]
            lnote = f" Lake level starts in {FILLED_FROM[gid]}: before that the dam was still filling."
        pts = [(lon, lat, 1.0)]
        s = {"lake": _on_axis(lv, axis), "tws": _trends_months_to_axis(grace.box(lon, lat), axis),
             "rain": _on_axis(gp.points(pts), axis)}
        s |= power_series(pts, axis)
        mw = sum(p["mw"] for p in match_plants(dams)[0]) if dams else 0
        rid = f"l-{key.replace('_', '-')}"
        payload[rid] = s
        regions.append({"id": rid, "name": name, "type": "reservoir", "countries": [c for c in ctry if c],
                        "lat": round(lat, 3), "lon": round(lon, 3), "hydro_gw": round(mw / 1000, 3) if mw else None,
                        "area_km2": None, "grealm_id": gid, "plants": [d[1] for d in dams],
                        "note": "Water storage and climate are for the area around the lake (GRACE: 3x3 one-degree cells; "
                                "rain and MERRA-2: the lake point)." + lnote})
    print(f"[explorer] reservoirs done ({time.time() - t0:.0f}s)")

    # --- write region files
    total = 0
    matrix = {}
    for reg in regions:
        s = payload[reg["id"]]
        series, have = {}, []
        for vid in VAR_IDS:
            if vid not in s or vid == "oni":
                continue
            arr = s[vid]
            ok = ~np.isnan(arr)
            if ok.sum() < 24:
                continue
            first, last = int(np.argmax(ok)), len(ok) - 1 - int(np.argmax(ok[::-1]))
            series[vid] = [_r(v, ROUND[vid]) for v in arr]
            have.append(vid)
            reg.setdefault("span", {})[vid] = [months[first], months[last]]
        # trim leading/trailing months where no variable has data
        anyok = np.zeros(len(months), bool)
        for vid in series:
            anyok |= np.array([v is not None for v in series[vid]])
        a, b = int(np.argmax(anyok)), len(anyok) - 1 - int(np.argmax(anyok[::-1]))
        body = {"id": reg["id"], "months": months[a:b + 1], "series": {k: v[a:b + 1] for k, v in series.items()}}
        txt = json.dumps(body, separators=(",", ":"), allow_nan=False)
        (RDIR / f"{reg['id']}.json").write_text(txt)
        total += len(txt)
        matrix[reg["id"]] = have + ["oni"]

    oni_arr = _on_axis(oni, axis)
    g = {"months": months, "series": {"oni": [_r(v, 2) for v in oni_arr]}}
    gtxt = json.dumps(g, separators=(",", ":"), allow_nan=False)
    (OUTDIR / "global.json").write_text(gtxt)
    total += len(gtxt)

    # --- validation: browser maths vs trends.json (pymannkendall Hamed-Rao + Sen on the real time axis)
    val_ids = ["4040794730", T.KARIBA_BASIN, "6040280410", series_ids[0], series_ids[1]]
    val_ids = list(dict.fromkeys(v for v in val_ids if v in tb))[:5]
    rows = []
    for bid in val_ids:
        body = json.loads((RDIR / f"b{bid}.json").read_text())
        st = browser_stats(body["series"]["tws"], body["months"], str(T.MONTHS[0]), str(T.MONTHS[-1]), True, True)
        ref = tb[bid]
        slope = st["slope_per_month"] * 120 if st else None
        rows.append({"basin_id": bid, "region_id": f"b{bid}", "name": ref["name"],
                     "browser_slope_cm_per_decade": _r(slope, 3),
                     "browser_ci95_cm_per_decade": [_r(st["lo"] * 120, 3), _r(st["hi"] * 120, 3)] if st else None,
                     "browser_p": _r(st["p"], 6) if st else None, "browser_test": st["test"] if st else None,
                     "browser_n": st["n"] if st else None,
                     "trends_slope_cm_per_decade": ref["tws_slope_cm_per_decade"], "trends_p": ref["tws_p"],
                     "trends_n": ref["tws_n_months"],
                     "slope_abs_diff": _r(abs(slope - ref["tws_slope_cm_per_decade"]), 4) if st else None,
                     "p_abs_diff": _r(abs(st["p"] - ref["tws_p"]), 6) if st else None,
                     "same_verdict_at_0_05": bool(st and ((st["p"] < 0.05) == (ref["tws_p"] < 0.05))
                                                  and (np.sign(slope) == np.sign(ref["tws_slope_cm_per_decade"])))})
    validation = {
        "what": "GRACE TWS, window 2002-04..2026-08, seasonal cycle removed, Hamed-Rao on. 'browser_*' is "
                "pipeline.explorer.browser_stats (a line-by-line copy of web/src/components/explore/stats.ts) run on the "
                "rounded values in explorer/r/*.json; 'trends_*' is trends.json (pymannkendall Hamed-Rao, Sen's slope on "
                "the real time axis). Small differences come from rounding the published values to 0.01 cm (more ties) "
                "and from trends.json rounding p to 5 decimals.",
        "rows": rows,
        "all_same_verdict": all(r["same_verdict_at_0_05"] for r in rows),
        "max_slope_abs_diff_cm_per_decade": max((r["slope_abs_diff"] or 0) for r in rows) if rows else None,
        "max_p_abs_diff": max((r["p_abs_diff"] or 0) for r in rows) if rows else None,
    }

    counts = {t: sum(r["type"] == t for r in regions) for t in ("basin", "country", "reservoir")}
    var_out = []
    for v in VARIABLES:
        v2 = dict(v)
        dp = list(v2["default_period"])
        v2["default_period"] = dp
        v2["n_regions"] = sum(v["id"] in m for m in matrix.values())
        var_out.append(v2)
    index = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "description": "Trend Detective: monthly series per region for live trend statistics in the browser.",
        "axis": {"from": months[0], "to": months[-1]},
        "counts": counts | {"regions": len(regions), "variables": len(VARIABLES)},
        "total_bytes": total,
        "regions": regions,
        "variables": var_out,
        "matrix": matrix,
        "methods": {
            "deseasonalize": "Subtract each calendar month's mean over the chosen window (as pipeline.trends does).",
            "sen_slope": "Median of all pairwise slopes on the real time axis (gaps do not compress time).",
            "mann_kendall": "Two-sided Mann-Kendall S with tie correction; Hamed-Rao (1998) variance correction for "
                            "autocorrelation using significant rank-autocorrelation lags of the Sen-detrended series; "
                            "Yue-Wang fallback if the corrected variance is not positive (as pipeline.trends).",
            "ci": "95% confidence interval on Sen's slope by the Gilbert (1987) rank method, using the (corrected) variance of S.",
        },
        "validation": validation,
        "notes": notes,
    }
    (OUTDIR / "index.json").write_text(json.dumps(index, separators=(",", ":"), ensure_ascii=False, allow_nan=False))
    print(f"[explorer] {len(regions)} regions {counts}, {total / 1024:.0f} KB of series, validation "
          f"max |dslope| {validation['max_slope_abs_diff_cm_per_decade']} max |dp| {validation['max_p_abs_diff']} "
          f"({time.time() - t0:.0f}s)")
    for r in rows:
        print("   ", r["name"], r["browser_slope_cm_per_decade"], r["trends_slope_cm_per_decade"], r["browser_p"], r["trends_p"], r["browser_test"])


if __name__ == "__main__":
    main()
