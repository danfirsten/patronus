"""Sampling points for the generation model: capacity-weighted points near each tier-1 grid's hydro plants.

Sichuan (CHN-SC) uses Chinese GPPD hydro plants inside a crude lon 97.3-108.6, lat 26.0-34.4 box. The box
also catches some plants in Yunnan, Tibet, Gansu and Chongqing (limitation, stated in outputs).
"""
from __future__ import annotations

from pipeline.basins import country_points, load_plants

SICHUAN_BOX = (97.3, 108.6, 26.0, 34.4)  # lon_min, lon_max, lat_min, lat_max


def sichuan_points(max_points: int = 8, coverage: float = 0.9) -> list[tuple[float, float, float]]:
    p = load_plants()
    lo0, lo1, la0, la1 = SICHUAN_BOX
    p = p[(p["iso3"] == "CHN") & p["longitude"].between(lo0, lo1) & p["latitude"].between(la0, la1)]
    p = p.sort_values("capacity_mw", ascending=False)
    if p.empty:
        return []
    cum = p["capacity_mw"].cumsum() / p["capacity_mw"].sum()
    p = p[cum.shift(fill_value=0) < coverage]
    p = p.assign(gx=(p["longitude"] - 0.5).round() + 0.5, gy=(p["latitude"] - 0.5).round() + 0.5)
    g = p.groupby(["gx", "gy"])["capacity_mw"].sum().sort_values(ascending=False).head(max_points)
    w = g / g.sum()
    return [(float(x), float(y), float(v)) for (x, y), v in w.items()]


def points_for(iso3: str) -> list[tuple[float, float, float]]:
    if iso3 == "CHN-SC":
        return sichuan_points()
    return country_points(iso3)


def plant_centroid(iso3: str) -> tuple[float | None, float | None, float]:
    """Capacity-weighted centroid (lat, lon) of GPPD hydro plants, and GPPD hydro GW."""
    p = load_plants()
    if iso3 == "CHN-SC":
        lo0, lo1, la0, la1 = SICHUAN_BOX
        p = p[(p["iso3"] == "CHN") & p["longitude"].between(lo0, lo1) & p["latitude"].between(la0, la1)]
    else:
        p = p[p["iso3"] == iso3]
    if p.empty or p["capacity_mw"].sum() <= 0:
        return None, None, 0.0
    w = p["capacity_mw"]
    return (float((p["latitude"] * w).sum() / w.sum()), float((p["longitude"] * w).sum() / w.sum()),
            float(w.sum() / 1000))
