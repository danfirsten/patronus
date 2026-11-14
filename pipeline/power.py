"""NASA POWER (MERRA-2-based) monthly climate at points, cached. No API key needed.

    from pipeline.power import monthly_point, monthly_points_mean
    df = monthly_point(lon, lat)             # index: month (Timestamp, month start); columns: PRECTOTCORR, GWETROOT, GWETTOP, T2M
    df = monthly_points_mean([(lon, lat), ...])

Coverage: 1981-01 to the latest complete month. Monthly API covers through ~2 months ago;
the most recent months are filled by averaging the daily API (about 3 days behind).
PRECTOTCORR is mm/day (monthly mean); GWETROOT/GWETTOP are 0-1 wetness; T2M is deg C.
Coordinates are snapped to 0.5 degrees so nearby requests share the cache.
"""
from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
import requests

from pipeline.paths import CACHE

PARAMS = ["PRECTOTCORR", "GWETROOT", "GWETTOP", "T2M"]
BASE = "https://power.larc.nasa.gov/api/temporal"
CDIR = CACHE / "power"
CDIR.mkdir(parents=True, exist_ok=True)
FILL = -999.0


def _snap(v: float) -> float:
    return round(v * 2) / 2


def _get(url: str, params: dict, tries: int = 5) -> dict:
    for i in range(tries):
        try:
            r = requests.get(url, params=params, timeout=120)
            if r.status_code == 200:
                return r.json()
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(2 ** i)
                continue
            r.raise_for_status()
        except requests.RequestException:
            time.sleep(2 ** i)
    raise RuntimeError(f"POWER request failed: {url} {params}")


def _monthly_raw(lon: float, lat: float) -> dict:
    f = CDIR / f"m_{lon:.1f}_{lat:.1f}.json"
    if f.exists():
        return json.loads(f.read_text())
    js = _get(f"{BASE}/monthly/point", {
        "parameters": ",".join(PARAMS), "community": "AG", "longitude": lon, "latitude": lat,
        "start": 1981, "end": 2026, "format": "JSON"})
    f.write_text(json.dumps(js))
    return js


def _daily_recent_raw(lon: float, lat: float, start: str, end: str) -> dict:
    f = CDIR / f"d_{lon:.1f}_{lat:.1f}_{start}_{end}.json"
    if f.exists():
        return json.loads(f.read_text())
    js = _get(f"{BASE}/daily/point", {
        "parameters": ",".join(PARAMS), "community": "AG", "longitude": lon, "latitude": lat,
        "start": start, "end": end, "format": "JSON"})
    f.write_text(json.dumps(js))
    return js


def monthly_point(lon: float, lat: float, fill_recent: bool = True) -> pd.DataFrame:
    lon, lat = _snap(lon), _snap(lat)
    js = _monthly_raw(lon, lat)
    p = js["properties"]["parameter"]
    rows = {}
    for prm in PARAMS:
        for k, v in p.get(prm, {}).items():
            if k[-2:] == "13":
                continue
            m = pd.Timestamp(year=int(k[:4]), month=int(k[4:]), day=1)
            rows.setdefault(m, {})[prm] = None if v == FILL else v
    df = pd.DataFrame.from_dict(rows, orient="index").sort_index()
    df.index.name = "month"
    df = df.dropna(how="all")
    if fill_recent:
        last = df.index.max()
        start = (last + pd.offsets.MonthBegin(1))
        today = pd.Timestamp.now("UTC").tz_localize(None).normalize()
        if start < today - pd.Timedelta(days=10):
            js2 = _daily_recent_raw(lon, lat, start.strftime("%Y%m%d"), today.strftime("%Y%m%d"))
            d = pd.DataFrame({prm: js2["properties"]["parameter"].get(prm, {}) for prm in PARAMS})
            d.index = pd.to_datetime(d.index, format="%Y%m%d")
            d = d.replace(FILL, float("nan"))
            g = d.groupby(d.index.to_period("M"))
            mm = g.mean()
            n = g.size()
            # keep a month only if at least 25 days are present (complete enough)
            mm = mm[n >= 25]
            mm.index = mm.index.to_timestamp()
            mm.index.name = "month"
            df = pd.concat([df, mm[~mm.index.isin(df.index)]]).sort_index()
    return df


def monthly_points_mean(points: list[tuple[float, float]], workers: int = 4) -> pd.DataFrame:
    """Mean of monthly series across points (lon, lat). Deduplicates snapped points."""
    uniq = sorted({(_snap(x), _snap(y)) for x, y in points})
    with ThreadPoolExecutor(max_workers=workers) as ex:
        frames = list(ex.map(lambda p: monthly_point(*p), uniq))
    return pd.concat(frames).groupby(level=0).mean()


if __name__ == "__main__":
    print(monthly_point(28.0, -16.5).tail(4))
