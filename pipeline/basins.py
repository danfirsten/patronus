"""Hydropower basins: WRI GPPD hydro plants joined to HydroBASINS level-4 basins.

Shared by the trend, generation and ENSO steps.

    from pipeline.basins import load_basins, load_plants, country_basins
    basins = load_basins()          # GeoDataFrame: basin_id, geometry, hydro_gw, n_plants, countries, centroid_lon/lat
    plants = load_plants()          # GeoDataFrame of hydro plants with basin_id
    country_basins("ECU")           # DataFrame: basin_id, gw, weight (sums to 1)

Run `python3 -m pipeline.basins` to (re)build the cache in data/cache/.
"""
from __future__ import annotations

import json

import geopandas as gpd
import pandas as pd

from pipeline.paths import CACHE, RAW

CONTINENTS = ["af", "eu", "si", "as", "au", "na", "ar", "sa"]
BASINS_CACHE = CACHE / "hydro_basins_lev04.gpkg"
PLANTS_CACHE = CACHE / "hydro_plants.gpkg"


def _read_all_basins() -> gpd.GeoDataFrame:
    parts = []
    for c in CONTINENTS:
        shp = RAW / "hydrobasins" / f"hybas_{c}_lev04_v1c.shp"
        g = gpd.read_file(shp, columns=["HYBAS_ID", "SUB_AREA"])
        parts.append(g)
    g = pd.concat(parts, ignore_index=True)
    g = gpd.GeoDataFrame(g, geometry="geometry", crs="EPSG:4326")
    g["basin_id"] = g["HYBAS_ID"].astype("int64").astype(str)
    g = g.rename(columns={"SUB_AREA": "area_km2"})
    return g[["basin_id", "area_km2", "geometry"]]


def _read_plants() -> gpd.GeoDataFrame:
    df = pd.read_csv(RAW / "gppd" / "global_power_plant_database.csv", low_memory=False)
    df = df[df["primary_fuel"] == "Hydro"].copy()
    df = df.rename(columns={"country": "iso3", "country_long": "country_name"})
    g = gpd.GeoDataFrame(
        df[["iso3", "country_name", "name", "gppd_idnr", "capacity_mw", "latitude", "longitude", "commissioning_year"]],
        geometry=gpd.points_from_xy(df["longitude"], df["latitude"]),
        crs="EPSG:4326",
    )
    return g


def build() -> None:
    basins = _read_all_basins()
    plants = _read_plants()
    joined = gpd.sjoin(plants, basins[["basin_id", "geometry"]], how="left", predicate="within")
    # Plants on coastlines/edges: snap to nearest basin.
    miss = joined["basin_id"].isna()
    if miss.any():
        near = gpd.sjoin_nearest(
            plants.loc[miss[miss].index].to_crs("EPSG:3857"),
            basins[["basin_id", "geometry"]].to_crs("EPSG:3857"),
            how="left",
        )
        joined.loc[miss[miss].index, "basin_id"] = near["basin_id"].values
    joined = joined.drop(columns=[c for c in joined.columns if c.startswith("index_")])
    joined.to_file(PLANTS_CACHE, driver="GPKG")

    agg = (
        joined.assign(gw=joined["capacity_mw"] / 1000.0, wlon=joined["longitude"] * joined["capacity_mw"],
                      wlat=joined["latitude"] * joined["capacity_mw"])
        .groupby("basin_id")
        .agg(hydro_gw=("gw", "sum"), n_plants=("name", "count"), cap=("capacity_mw", "sum"),
             wlon=("wlon", "sum"), wlat=("wlat", "sum"))
    )
    agg["plant_lon"] = agg["wlon"] / agg["cap"].where(agg["cap"] > 0)
    agg["plant_lat"] = agg["wlat"] / agg["cap"].where(agg["cap"] > 0)
    countries = (
        joined.groupby(["basin_id", "iso3"])["capacity_mw"].sum().div(1000).round(3)
        .reset_index().groupby("basin_id")
        .apply(lambda d: json.dumps(dict(zip(d["iso3"], d["capacity_mw"]))), include_groups=False)
        .rename("countries_gw")
    )
    b = basins.merge(agg.drop(columns=["wlon", "wlat", "cap"]), left_on="basin_id", right_index=True, how="inner")
    b = b.merge(countries, left_on="basin_id", right_index=True, how="left")
    rp = b.geometry.representative_point()
    b["centroid_lon"] = rp.x
    b["centroid_lat"] = rp.y
    b.to_file(BASINS_CACHE, driver="GPKG")
    print(f"basins with hydro: {len(b)}, plants: {len(joined)}, GW: {b.hydro_gw.sum():.0f}")


def load_basins() -> gpd.GeoDataFrame:
    """Level-4 basins that contain at least one GPPD hydro plant."""
    if not BASINS_CACHE.exists():
        build()
    g = gpd.read_file(BASINS_CACHE)
    g["countries"] = g["countries_gw"].map(lambda s: json.loads(s) if isinstance(s, str) else {})
    return g


def load_plants() -> gpd.GeoDataFrame:
    if not PLANTS_CACHE.exists():
        build()
    return gpd.read_file(PLANTS_CACHE)


def country_basins(iso3: str, min_share: float = 0.0) -> pd.DataFrame:
    """Basins feeding a country's hydro fleet, weighted by that country's capacity in each basin."""
    b = load_basins()
    rows = [(r.basin_id, r.countries.get(iso3, 0.0)) for r in b.itertuples()]
    df = pd.DataFrame(rows, columns=["basin_id", "gw"])
    df = df[df["gw"] > 0].sort_values("gw", ascending=False)
    if df.empty:
        return df.assign(weight=[])
    df["weight"] = df["gw"] / df["gw"].sum()
    df = df[df["weight"] >= min_share]
    df["weight"] = df["gw"] / df["gw"].sum()
    return df.reset_index(drop=True)


def basin_sample_points(basin_id: str, max_points: int = 5) -> list[tuple[float, float]]:
    """Points (lon, lat) inside a basin for sampling gridded climate: a ~1 degree grid clipped to the polygon,
    thinned to at most `max_points`; always includes the basin's representative point."""
    import numpy as np
    from shapely.geometry import Point

    b = load_basins()
    geom = b.loc[b.basin_id == basin_id, "geometry"].iloc[0]
    minx, miny, maxx, maxy = geom.bounds
    pts = [(p.x, p.y) for p in [geom.representative_point()]]
    for x in np.arange(np.floor(minx) + 0.5, maxx, 1.0):
        for y in np.arange(np.floor(miny) + 0.5, maxy, 1.0):
            if geom.contains(Point(x, y)):
                pts.append((float(x), float(y)))
    if len(pts) > max_points:
        idx = np.linspace(0, len(pts) - 1, max_points).round().astype(int)
        pts = [pts[i] for i in sorted(set(idx))]
    return pts


if __name__ == "__main__":
    build()


def country_points(iso3: str, max_points: int = 8, coverage: float = 0.9) -> list[tuple[float, float, float]]:
    """Capacity-weighted sampling points for a country's hydro fleet: (lon, lat, weight).

    Level-4 basins can be huge (e.g. the whole western Amazon), so for climate inputs we sample
    near the plants instead: plants covering `coverage` of capacity, snapped to a 1-degree grid,
    plus the grid cell 1 degree upstream-agnostic neighbours are NOT added (keep it simple and local).
    Weights sum to 1."""
    p = load_plants()
    p = p[p["iso3"] == iso3].sort_values("capacity_mw", ascending=False)
    if p.empty:
        return []
    cum = p["capacity_mw"].cumsum() / p["capacity_mw"].sum()
    p = p[cum.shift(fill_value=0) < coverage]
    p = p.assign(gx=(p["longitude"] - 0.5).round() + 0.5, gy=(p["latitude"] - 0.5).round() + 0.5)
    g = p.groupby(["gx", "gy"])["capacity_mw"].sum().sort_values(ascending=False).head(max_points)
    w = g / g.sum()
    return [(float(x), float(y), float(v)) for (x, y), v in w.items()]
