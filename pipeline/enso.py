"""ENSO fingerprint layer (6-18 month horizon) -> web/public/data/enso.json

For every hydro-dependent grid (48 countries + Sichuan) we measure how its hydro basins historically respond
to El Nino and La Nina, then combine that fingerprint with the official ENSO outlook (NOAA CPC) and the
NASA GEOS-S2S Nino-3.4 plume.

Method (see `METHOD` below for the published wording):
  * ENSO year y = the event that peaks in Nov(y)-Jan(y+1). Phase from ONI NDJ(y): El Nino >= +0.5, La Nina <= -0.5.
  * basin_precip: NASA POWER (MERRA-2) PRECTOTCORR at capacity-weighted points near each country's hydro plants
    (WRI GPPD). Two candidate windows per country:
        A) 12-month water year Oct(y)-Sep(y+1);
        B) the country's climatologically wettest 6 consecutive months, assigned to the ENSO year whose
           peak it is closest to (window centred Jun-Dec -> year y, centred Jan-May -> year y+1).
    Effect = % difference of mean precipitation in El Nino (La Nina) years vs neutral years.
    The window with the larger |effect| is chosen separately per phase, and the permutation test (5,000
    shuffles of the phase labels) repeats that choice inside every shuffle (max-statistic), so the p-value is
    corrected for picking the better window.
  * hydro_generation (Ember monthly, tier 1): water-year hydro TWh, linearly detrended (capacity growth),
    % residual in El Nino / La Nina vs neutral years. Low confidence (few events); primary only when the
    record is long (>= 10 water years, >= 3 events per phase, >= 4 neutral years).
  * reservoir_level (ZMB, ZWE): G-REALM Kariba level rise over the rainy season, from the Oct-Nov(y) mean to
    the Jun-Jul(y+1) mean, El Nino vs neutral.
  * Exposure: loser in a phase if effect <= -5 % and p < 0.1 (on the primary variable).

Run:  python3 -m pipeline.enso
"""
from __future__ import annotations

import html
import json
import math
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import requests

from pipeline.basins import country_points, load_plants
from pipeline.paths import CACHE, OUT, RAW, REFERENCE
from pipeline.power import monthly_point

RNG_SEED = 20261115
N_PERM = 5000
EN_T, LN_T = 0.5, -0.5
STRONG_T = 1.5
LOSER_EFFECT, LOSER_P = -5.0, 0.1
CPC_URL = "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml"
GEOS_URL = "https://portal.nccs.nasa.gov/datashare/gmao/geos-s2s-3/NRT/IRI/IRI_{ym}.txt"
ECACHE = CACHE / "enso"
ECACHE.mkdir(parents=True, exist_ok=True)
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
SEASONS = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"]

# Sichuan: GPPD has no province field, so we use a bounding box around the province (approximate: it also
# catches a few plants on the Yunnan/Chongqing/Gansu borders, e.g. the Jinsha cascade on the SC/YN border).
SICHUAN_BBOX = (97.3, 108.6, 26.0, 34.4)

# Regions whose ENSO sign is well established in the literature; we check that our data reproduce them.
VALIDATION = [
    {"region": "Southern Africa / Zambezi", "expect": "El Nino dry", "phase": "el_nino", "sign": -1,
     "iso3": ["ZMB", "ZWE", "MOZ", "MWI"]},
    {"region": "Northern South America / Colombia", "expect": "El Nino dry", "phase": "el_nino", "sign": -1,
     "iso3": ["COL", "VEN"]},
    {"region": "Southern Brazil and Uruguay", "expect": "El Nino wet", "phase": "el_nino", "sign": +1,
     "iso3": ["BRA-S", "URY"]},
    {"region": "Southeast Asia incl. Vietnam", "expect": "El Nino dry", "phase": "el_nino", "sign": -1,
     "iso3": ["VNM", "LAO", "MMR"]},
]

PROJECTIONS = {
    "text": ("Extreme El Nino events are projected to roughly double in frequency under greenhouse warming, from "
             "about one every 20 years to about one every 10 years (Cai et al. 2014, 20 CMIP models). The increase "
             "continues for about a century even after global warming is stabilised at 1.5 C (Wang et al. 2017). "
             "Grids that lose hydropower under El Nino therefore face a structural, not only a seasonal, risk."),
    "extreme_el_nino_per_20yr_now": 1,
    "extreme_el_nino_per_20yr_future": 2,
    "refs": [
        {"title": "Cai et al. 2014, Increasing frequency of extreme El Nino events due to greenhouse warming, "
                  "Nature Climate Change 4, 111-116", "url": "https://centaur.reading.ac.uk/51601",
         "doi": "10.1038/nclimate2100"},
        {"title": "NOAA PMEL: Frequency of extreme El Ninos to double in the 21st century",
         "url": "https://www.pmel.noaa.gov/news-and-media/highlights/frequency-extreme-el-ninos-double-21st-century"},
        {"title": "Wang et al. 2017, Continued increase of extreme El Nino frequency long after 1.5 C warming "
                  "stabilization, Nature Climate Change 7, 568-572", "url": "https://doi.org/10.1038/nclimate3351",
         "doi": "10.1038/nclimate3351"},
        {"title": "Ng, Turner & Galelli 2017, Influence of El Nino Southern Oscillation on global hydropower "
                  "production, Environmental Research Letters 12, 034010",
         "url": "https://doaj.org/article/d8f85ff82c534a1a93f2e3b15421c51e", "doi": "10.1088/1748-9326/aa5ef8"},
    ],
}

METHOD = (
    "ENSO fingerprint per grid. ENSO year y = event peaking Nov(y)-Jan(y+1); El Nino if ONI NDJ(y) >= +0.5, "
    "La Nina if <= -0.5, otherwise neutral (NOAA ONI). basin_precip: NASA POWER (MERRA-2) PRECTOTCORR at "
    "capacity-weighted points near each grid's hydro plants (WRI GPPD), water years 1981/82 onward. Two windows "
    "are tested: the Oct-Sep water year and the climatologically wettest 6 months; effect = % difference of mean "
    "precipitation in El Nino (La Nina) years vs neutral years; the window with the larger |effect| is kept per "
    "phase and the 5,000-shuffle permutation test repeats that choice in every shuffle (corrects for "
    "cherry-picking). hydro_generation: Ember monthly hydro TWh per water year, linearly detrended, same "
    "composite (low confidence; primary only with >= 10 water years, >= 3 events per phase and >= 4 neutral years). "
    "reservoir_level (Zambia, Zimbabwe): G-REALM Kariba level rise from Oct-Nov(y) to Jun-Jul(y+1). "
    "Loser in a phase if effect <= -5% with permutation p < 0.1 on the primary variable. Two-sided p-values."
)

LIMITATIONS = [
    "Few events: about 15 El Nino and 16 La Nina years since 1981 for rainfall, and only 2-5 per phase in the "
    "Ember generation records (mostly 2015/2019 onward). p-values are permutation-based but effect sizes are noisy.",
    "Rainfall is a proxy for hydropower: reservoirs buffer one bad season (Ng et al. 2017 found production "
    "anomalies smaller than inflow anomalies), and snowmelt, glaciers and upstream catchments are not captured.",
    "Rainfall is sampled at up to 8 grid points near the largest plants, not over the full upstream catchment "
    "(e.g. Namibia's Ruacana is fed from Angola; Tajikistan's Vakhsh from high-mountain snow).",
    "MERRA-2 is a reanalysis: rainfall is a model estimate constrained by observations, not a gauge record.",
    "Non-stationarity: ENSO teleconnections vary between decades and between El Nino flavours (Eastern vs "
    "Central Pacific); a historical fingerprint does not guarantee the response of the 2026/27 event.",
    "Neutral-year baseline includes trends (climate change, land use); no detrending is applied to rainfall.",
    "Power-plant locations come from WRI GPPD v1.3 (2021); newer plants are missing.",
    "Kariba level is managed (releases, allocation rules), so it mixes climate and operating decisions.",
]


# --------------------------------------------------------------------------------------------- inputs
def load_oni() -> pd.DataFrame:
    p = RAW / "oni.ascii.txt"
    if not p.exists():
        p = REFERENCE / "oni.ascii.txt"
    df = pd.read_csv(p, sep=r"\s+")
    df.columns = [c.strip().upper() for c in df.columns]
    return df


def enso_years(oni: pd.DataFrame) -> pd.Series:
    """ONI NDJ by ENSO year y (NDJ y = Nov y, Dec y, Jan y+1)."""
    s = oni[oni["SEAS"] == "NDJ"].set_index("YR")["ANOM"].astype(float)
    return s


def phase_of(v: float) -> str:
    return "el_nino" if v >= EN_T else ("la_nina" if v <= LN_T else "neutral")


def load_countries() -> pd.DataFrame:
    t = pd.read_csv(REFERENCE / "hydro_dependent_countries_ember.csv")
    t = t.rename(columns={"Area": "name", "ISO 3 code": "iso3", "hydro_capacity_GW": "gw", "Continent": "continent"})
    t["gw_source"] = np.where(t["gw"].notna(), "ember_yearly_latest_year", None)
    # Fill missing capacity with the latest non-empty Ember yearly hydro capacity, else GPPD.
    miss = t["gw"].isna()
    if miss.any():
        y = pd.read_csv(RAW / "ember_release_generation_yearly_global.csv",
                        usecols=["ISO 3 code", "Year", "Electricity source", "Capacity (GW)"])
        y = y[(y["Electricity source"] == "Hydro") & y["Capacity (GW)"].notna()]
        last = y.sort_values("Year").groupby("ISO 3 code").last()
        plants = None
        for i in t.index[miss]:
            iso = t.at[i, "iso3"]
            if iso in last.index:
                t.at[i, "gw"] = float(last.at[iso, "Capacity (GW)"])
                t.at[i, "gw_source"] = f"ember_yearly_{int(last.at[iso, 'Year'])}"
            else:
                plants = load_plants() if plants is None else plants
                gw = plants.loc[plants["iso3"] == iso, "capacity_mw"].sum() / 1000
                t.at[i, "gw"] = round(float(gw), 2) if gw > 0 else None
                t.at[i, "gw_source"] = "gppd" if gw > 0 else None
    return t


def sichuan_points(max_points: int = 8, coverage: float = 0.9) -> list[tuple[float, float, float]]:
    x0, x1, y0, y1 = SICHUAN_BBOX
    p = load_plants()
    p = p[(p["iso3"] == "CHN") & p["longitude"].between(x0, x1) & p["latitude"].between(y0, y1)]
    return _points_from_plants(p, max_points, coverage)


def brazil_south_points(max_points: int = 8, coverage: float = 0.9) -> list[tuple[float, float, float]]:
    """Validation only: Brazilian hydro plants south of 23 S (Parana, Santa Catarina, Rio Grande do Sul)."""
    p = load_plants()
    p = p[(p["iso3"] == "BRA") & (p["latitude"] < -23.0)]
    return _points_from_plants(p, max_points, coverage)


def _points_from_plants(p, max_points, coverage):
    p = p.sort_values("capacity_mw", ascending=False)
    if p.empty:
        return []
    cum = p["capacity_mw"].cumsum() / p["capacity_mw"].sum()
    p = p[cum.shift(fill_value=0) < coverage]
    p = p.assign(gx=(p["longitude"] - 0.5).round() + 0.5, gy=(p["latitude"] - 0.5).round() + 0.5)
    g = p.groupby(["gx", "gy"])["capacity_mw"].sum().sort_values(ascending=False).head(max_points)
    w = g / g.sum()
    return [(float(x), float(y), float(v)) for (x, y), v in w.items()]


def fetch_precip(points_by_unit: dict[str, list]) -> dict[str, pd.Series]:
    """Capacity-weighted monthly PRECTOTCORR (mm/day) per unit."""
    uniq = sorted({(x, y) for pts in points_by_unit.values() for x, y, _ in pts})

    def one(pt):
        try:
            return pt, monthly_point(pt[0], pt[1], fill_recent=False)["PRECTOTCORR"]
        except Exception as e:  # noqa: BLE001
            print(f"  POWER failed at {pt}: {e}")
            return pt, None

    with ThreadPoolExecutor(max_workers=6) as ex:
        series = dict(ex.map(one, uniq))
    out = {}
    for unit, pts in points_by_unit.items():
        parts, ws = [], []
        for x, y, w in pts:
            s = series.get((x, y))
            if s is not None:
                parts.append(s * w)
                ws.append(w)
        if not parts:
            continue
        df = pd.concat(parts, axis=1)
        # require all points present for a month; renormalise weights (always 1 if all present)
        s = df.sum(axis=1, min_count=len(parts)) / sum(ws)
        out[unit] = s.dropna()
    return out


# --------------------------------------------------------------------------------------------- stats
def window_totals(s: pd.Series, start_month: int, length: int, year_offset: int) -> pd.Series:
    """Sum of monthly mean rate x days over a window starting in `start_month` of year (y + year_offset),
    indexed by ENSO year y. Only complete windows are kept."""
    s = s.copy()
    s.index = pd.DatetimeIndex(s.index)
    days = s.index.days_in_month
    mm = s * days  # mm per month
    res = {}
    years = range(s.index.year.min() - 1, s.index.year.max() + 1)
    for y in years:
        start = pd.Timestamp(year=y + year_offset, month=start_month, day=1)
        idx = pd.date_range(start, periods=length, freq="MS")
        if all(i in mm.index for i in idx):
            res[y] = float(mm.loc[idx].sum())
    return pd.Series(res, dtype=float)


def wet_window(s: pd.Series, length: int = 6) -> tuple[int, int]:
    """(start_month, year_offset) of the wettest `length` consecutive months, anchored to the ENSO year."""
    clim = s.groupby(pd.DatetimeIndex(s.index).month).mean().reindex(range(1, 13))
    best, best_start = -1.0, 1
    for st in range(1, 13):
        tot = sum(clim[((st - 1 + k) % 12) + 1] for k in range(length))
        if tot > best:
            best, best_start = tot, st
    centre = ((best_start - 1 + (length - 1) / 2.0) % 12) + 1  # e.g. Nov-Apr -> 1.5 (Jan/Feb)
    # centred Jun-Dec -> developing year y; centred Jan-May -> decaying year y+1
    if 5.5 <= centre <= 12.5:
        off = 0
    else:
        off = 1
    # if the window starts late in year y and wraps (e.g. Nov-Apr, centre ~Jan) start is in year y
    if off == 1 and best_start >= 7:
        off = 0
    return best_start, off


def window_label(start: int, length: int, off: int, y: int | None = None) -> str:
    end = ((start - 1 + length - 1) % 12) + 1
    if y is None:
        return f"{MON[start - 1]}-{MON[end - 1]}"
    y0 = y + off
    y1 = y0 + (1 if start + length - 1 > 12 else 0)
    return f"{MON[start - 1]} {y0}-{MON[end - 1]} {y1}"


def _effects(vals: np.ndarray, labels: np.ndarray, scale: str = "neutral") -> tuple[np.ndarray, np.ndarray]:
    """vals: (n,), labels: (k, n) int 0 neutral / 1 el nino / 2 la nina. Returns % effects (k,), (k,).
    scale="neutral": % of the neutral-year mean (the reported effect).
    scale="all": difference of means as % of the all-years mean, which does not change under permutation, so it is
    a plain difference-of-means statistic (used for the permutation test and window choice)."""
    neu = labels == 0
    en = labels == 1
    ln = labels == 2
    with np.errstate(invalid="ignore", divide="ignore"):
        mn = (neu * vals).sum(1) / neu.sum(1)
        me = (en * vals).sum(1) / en.sum(1)
        ml = (ln * vals).sum(1) / ln.sum(1)
        den = np.abs(mn) if scale == "neutral" else abs(float(np.mean(vals)))
        return 100 * (me - mn) / den, 100 * (ml - mn) / den


def composite(window_series: list[pd.Series], ndj: pd.Series, rng: np.random.Generator,
              n_perm: int = N_PERM, extra_strong: bool = True) -> dict:
    """Effects for one or more candidate windows (all indexed by ENSO year). Per phase, the window with the
    larger |effect| is chosen, and permutations repeat that choice (max-|effect| statistic)."""
    years = sorted(set.intersection(*[set(w.dropna().index) for w in window_series]) & set(ndj.index))
    if len(years) < 8:
        return {}
    lab = np.array([{"el_nino": 1, "la_nina": 2, "neutral": 0}[phase_of(ndj[y])] for y in years])
    V = [np.array([w[y] for y in years], dtype=float) for w in window_series]
    perm = np.stack([rng.permutation(lab) for _ in range(n_perm)])
    obs = [_effects(v, lab[None, :]) for v in V]
    obs_all = [_effects(v, lab[None, :], "all") for v in V]
    prm = [_effects(v, perm, "all") for v in V]
    out = {"years": years, "n_el_nino": int((lab == 1).sum()), "n_la_nina": int((lab == 2).sum()),
           "n_neutral": int((lab == 0).sum())}
    for k, name in ((0, "el_nino"), (1, "la_nina")):
        o = np.array([ob[k][0] for ob in obs])
        oa = np.array([ob[k][0] for ob in obs_all])
        wi = int(np.nanargmax(np.abs(oa)))
        stat_obs = np.nanmax(np.abs(oa))
        stat_perm = np.nanmax(np.abs(np.stack([p[k] for p in prm])), axis=0)
        p = (1 + np.sum(stat_perm >= stat_obs - 1e-12)) / (n_perm + 1)
        out[f"{name}_effect_pct"] = float(o[wi])
        out[f"{name}_p"] = float(p)
        out[f"{name}_window_index"] = wi
        out[f"{name}_effect_by_window"] = [float(x) for x in o]
    if extra_strong:
        # strong El Nino years (NDJ >= 1.5) vs neutral, on the El Nino window
        wi = out["el_nino_window_index"]
        v = V[wi]
        slab = np.where(np.array([ndj[y] for y in years]) >= STRONG_T, 1, np.where(lab == 0, 0, 3))
        if (slab == 1).sum() >= 2:
            se, _ = _effects(v, slab[None, :])
            sa, _ = _effects(v, slab[None, :], "all")
            sp = np.stack([rng.permutation(slab) for _ in range(n_perm)])
            pe, _ = _effects(v, sp, "all")
            out["strong_el_nino_effect_pct"] = float(se[0])
            out["strong_el_nino_p"] = float((1 + np.sum(np.abs(pe) >= abs(sa[0]) - 1e-12)) / (n_perm + 1))
            out["n_strong_el_nino"] = int((slab == 1).sum())
            out["strong_el_nino_years"] = [y for y, s in zip(years, slab) if s == 1]
    return out


# --------------------------------------------------------------------------------------------- generation
def ember_wy_generation() -> dict[str, pd.Series]:
    d = pd.read_csv(RAW / "ember_release_generation_monthly_global.csv",
                    usecols=["ISO 3 code", "Date", "Electricity source", "Generation (TWh)"])
    d = d[d["Electricity source"] == "Hydro"].dropna(subset=["ISO 3 code"])
    out = {iso: g.set_index(pd.to_datetime(g["Date"]))["Generation (TWh)"].sort_index()
           for iso, g in d.groupby("ISO 3 code")}
    c = pd.read_csv(RAW / "ember_release_chn_subnational_generation_monthly.csv",
                    usecols=["Province", "Date", "Electricity source", "Generation (TWh)"])
    c = c[(c["Province"] == "Sichuan") & (c["Electricity source"] == "Hydro")]
    out["CHN-SC"] = c.set_index(pd.to_datetime(c["Date"]))["Generation (TWh)"].sort_index()
    return out


def generation_fingerprint(monthly: pd.Series, ndj: pd.Series, rng) -> dict:
    monthly = monthly.dropna()
    wy = {}
    for y in range(monthly.index.year.min() - 1, monthly.index.year.max() + 1):
        idx = pd.date_range(f"{y}-10-01", periods=12, freq="MS")
        if all(i in monthly.index for i in idx):
            wy[y] = float(monthly.loc[idx].sum())
    s = pd.Series(wy, dtype=float)
    if len(s) < 5:
        return {"n_years": int(len(s))}
    x = np.array(s.index, dtype=float)
    b = np.polyfit(x, s.values, 1)
    fit = np.polyval(b, x)
    resid_pct = pd.Series(100 * (s.values - fit) / fit, index=s.index)
    years = [y for y in s.index if y in ndj.index]
    lab = np.array([{"el_nino": 1, "la_nina": 2, "neutral": 0}[phase_of(ndj[y])] for y in years])
    out = {"n_years": len(years), "record": f"WY {years[0]}/{str(years[0] + 1)[-2:]}-{years[-1]}/{str(years[-1] + 1)[-2:]}",
           "n_el_nino": int((lab == 1).sum()), "n_la_nina": int((lab == 2).sum()), "n_neutral": int((lab == 0).sum()),
           "el_nino_years": [y for y, l in zip(years, lab) if l == 1],
           "la_nina_years": [y for y, l in zip(years, lab) if l == 2]}
    v = resid_pct.loc[years].values
    if out["n_neutral"] < 2:
        return out
    perm = np.stack([rng.permutation(lab) for _ in range(N_PERM)])
    neu = lab == 0
    for code, name in ((1, "el_nino"), (2, "la_nina")):
        m = lab == code
        if m.sum() < 2:
            out[f"{name}_effect_pct"] = None
            out[f"{name}_p"] = None
            continue
        # effect in percentage points of detrended generation (~ % of normal)
        eff = v[m].mean() - v[neu].mean()
        pe = ((perm == code) * v).sum(1) / (perm == code).sum(1) - ((perm == 0) * v).sum(1) / np.maximum((perm == 0).sum(1), 1)
        out[f"{name}_effect_pct"] = float(eff)
        out[f"{name}_p"] = float((1 + np.sum(np.abs(pe) >= abs(eff) - 1e-12)) / (N_PERM + 1))
    return out


# --------------------------------------------------------------------------------------------- Kariba
def kariba_fingerprint(ndj: pd.Series, rng) -> dict:
    p = RAW / "kariba_grealm_10day_levels.csv"
    if not p.exists():
        p = REFERENCE / "kariba_grealm_10day_levels.csv"
    k = pd.read_csv(p, parse_dates=["date"])
    k = k[k["level_m_egm2008"].between(470, 495)]
    m = k.set_index("date")["level_m_egm2008"].resample("MS").mean()
    clim = m.groupby(m.index.month).mean()
    rise = {}
    for y in range(m.index.year.min(), m.index.year.max() + 1):
        a = m.reindex(pd.date_range(f"{y}-10-01", periods=2, freq="MS")).dropna()
        b = m.reindex(pd.date_range(f"{y + 1}-06-01", periods=2, freq="MS")).dropna()
        if len(a) >= 1 and len(b) >= 1:
            rise[y] = float(b.mean() - a.mean())
    s = pd.Series(rise)
    years = [y for y in s.index if y in ndj.index]
    lab = np.array([{"el_nino": 1, "la_nina": 2, "neutral": 0}[phase_of(ndj[y])] for y in years])
    v = s.loc[years].values
    perm = np.stack([rng.permutation(lab) for _ in range(N_PERM)])
    out = {"years": years, "n_el_nino": int((lab == 1).sum()), "n_la_nina": int((lab == 2).sum()),
           "n_neutral": int((lab == 0).sum()),
           "record": f"WY {years[0]}/{str(years[0] + 1)[-2:]}-{years[-1]}/{str(years[-1] + 1)[-2:]}",
           "mean_rise_neutral_m": float(v[lab == 0].mean()),
           "mean_rise_el_nino_m": float(v[lab == 1].mean()),
           "mean_rise_la_nina_m": float(v[lab == 2].mean()),
           "mean_rise_other_m": float(v[lab != 1].mean()),
           "el_nino_years": [y for y, l in zip(years, lab) if l == 1],
           "rise_by_year_m": {str(y): round(float(r), 2) for y, r in zip(years, v)},
           "climatology_month_of_min": MON[int(clim.idxmin()) - 1],
           "climatology_month_of_max": MON[int(clim.idxmax()) - 1]}
    mn = v[lab == 0].mean()
    for code, name in ((1, "el_nino"), (2, "la_nina")):
        d = v[lab == code].mean() - mn
        eff = 100 * d / abs(mn)
        # test the difference in metres (the ratio's denominator is too unstable to permute)
        pe = ((perm == code) * v).sum(1) / (perm == code).sum(1) - ((perm == 0) * v).sum(1) / (perm == 0).sum(1)
        out[f"{name}_effect_pct"] = float(eff)
        out[f"{name}_p"] = float((1 + np.sum(np.abs(pe) >= abs(d) - 1e-12)) / (N_PERM + 1))
        out[f"{name}_effect_m"] = float(v[lab == code].mean() - mn)
    # El Nino vs all other years, in metres (contract field for kariba.json style)
    other = lab != 1
    d_obs = v[lab == 1].mean() - v[other].mean()
    d_perm = ((perm == 1) * v).sum(1) / (perm == 1).sum(1) - ((perm != 1) * v).sum(1) / (perm != 1).sum(1)
    out["el_nino_vs_other_m"] = float(d_obs)
    out["el_nino_vs_other_p"] = float((1 + np.sum(np.abs(d_perm) >= abs(d_obs) - 1e-12)) / (N_PERM + 1))
    return out


# --------------------------------------------------------------------------------------------- outlook
def _get_text(url: str, cache_name: str, notes: list) -> tuple[str | None, str]:
    f = ECACHE / cache_name
    try:
        r = requests.get(url, timeout=60)
        if r.status_code == 200 and len(r.text) > 50:
            f.write_text(r.text)
            return r.text, "live"
        notes.append(f"{url} returned HTTP {r.status_code}")
    except requests.RequestException as e:
        notes.append(f"{url} fetch failed: {type(e).__name__}")
    if f.exists():
        return f.read_text(), "cache"
    return None, "none"


def parse_cpc(raw: str) -> dict:
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", raw, flags=re.S | re.I)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    t = re.sub(r"\s+", " ", t)
    out = {}
    m = re.search(r"NCEP/NWS\s+(\d{1,2} \w+ \d{4})", t)
    if m:
        out["issued_date"] = datetime.strptime(m.group(1), "%d %B %Y").strftime("%Y-%m-%d")
    m = re.search(r"ENSO Alert System Status:\s*(.+?)\s+Synopsis:", t)
    if m:
        out["status"] = m.group(1).strip()
    m = re.search(r"Synopsis:\s*(.+?\.)(?=\s+[A-Z])", t)
    if m:
        syn = m.group(1).strip()
        # a parenthetical can contain the sentence end, e.g. "(... 79% chance)."
        out["synopsis"] = syn
    probs = re.findall(r"(greater than|better than|about|~|less than)?\s*a?\s*(\d{1,3})%\s*chance", t)
    out["probabilities_pct"] = sorted({int(p[1]) for p in probs})
    m = re.search(r"Chances for a historic event.*?(~?\d{1,3})%.*?periods", t)
    if m:
        out["historic_event_text"] = m.group(0).strip()
    m = re.search(r"reaching \+?([\d.]+)\s*°?C in Ni[nñ]o-3\.4", t)
    if m:
        out["nino34_weekly_c"] = float(m.group(1))
    m = re.search(r"next ENSO Diagnostics Discussion is scheduled for (\d{1,2} \w+ \d{4})", t)
    if m:
        out["next_discussion"] = datetime.strptime(m.group(1), "%d %B %Y").strftime("%Y-%m-%d")
    return out


def parse_geos(raw: str) -> dict:
    lines = [l for l in raw.splitlines() if l.strip()]
    out = {"forecast": []}
    m = re.search(r"Ensemble Mean\s+(\w+)\s+(\d{4})", raw)
    if m:
        out["init"] = f"{m.group(2)}-{datetime.strptime(m.group(1)[:3].title(), '%b').month:02d}"
    for i, l in enumerate(lines):
        toks = l.split()
        if toks and all(tk in SEASONS for tk in toks) and i + 1 < len(lines):
            vals = lines[i + 1].split()
            try:
                vals = [float(v) for v in vals]
            except ValueError:
                continue
            out["forecast"] = [{"season": s, "value": round(v, 2)} for s, v in zip(toks, vals)]
            break
    return out


def outlook(oni: pd.DataFrame, notes: list) -> dict:
    last = oni.iloc[-1]
    o = {"source": "NOAA CPC + NASA GEOS-S2S", "issued": None,
         "oni_latest": {"season": f"{last['SEAS']} {int(last['YR'])}", "value": float(last["ANOM"])},
         "status": None, "summary": None, "geos_nino34_forecast": []}
    raw, how = _get_text(CPC_URL, "cpc_ensodisc.html", notes)
    if raw:
        c = parse_cpc(raw)
        o["status"] = c.get("status")
        o["summary"] = c.get("synopsis")
        o["cpc"] = {**c, "url": CPC_URL, "retrieved": how}
        if c.get("issued_date"):
            o["issued"] = c["issued_date"][:7]
    else:
        notes.append("CPC ENSO discussion unavailable; status/summary null.")
    now = datetime.now(timezone.utc)
    tried = []
    for k in range(0, 3):
        y, mth = now.year, now.month - k
        while mth <= 0:
            mth += 12
            y -= 1
        ym = f"{y}{mth:02d}"
        url = GEOS_URL.format(ym=ym)
        tried.append(url)
        raw, how = _get_text(url, f"geos_iri_{ym}.txt", [])
        if raw and "Forecast" in raw:
            g = parse_geos(raw)
            if g["forecast"]:
                o["geos_nino34_forecast"] = g["forecast"]
                o["geos"] = {"init": g.get("init"), "url": url, "retrieved": how,
                             "note": "GEOS-S2S ensemble-mean Nino-3.4 SST anomaly (C), 3-month seasons from the init month"}
                break
    if not o["geos_nino34_forecast"]:
        notes.append(f"GEOS Nino-3.4 plume unavailable (tried {', '.join(tried)}).")
    if o["issued"] is None:
        o["issued"] = now.strftime("%Y-%m")
    return o


def la_nina_after_strong(ndj: pd.Series) -> dict:
    strong = [int(y) for y in ndj.index if ndj[y] >= STRONG_T and (y + 1) in ndj.index]
    follow = [y for y in strong if ndj[y + 1] <= LN_T]
    return {"strong_el_nino_years": strong, "followed_by_la_nina": follow,
            "text": f"Since 1950, {len(follow)} of {len(strong)} strong El Ninos (ONI NDJ >= {STRONG_T}) were followed by "
                    f"La Nina conditions the next winter (ONI NDJ <= {LN_T})."}


# --------------------------------------------------------------------------------------------- main
def _r(x, n=1):
    if x is None:
        return None
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return None
    return round(float(x), n)


def classify(en, en_p, ln, ln_p) -> str:
    a = en is not None and en_p is not None and en <= LOSER_EFFECT and en_p < LOSER_P
    b = ln is not None and ln_p is not None and ln <= LOSER_EFFECT and ln_p < LOSER_P
    return "both" if a and b else ("el_nino_loser" if a else ("la_nina_loser" if b else "neutral"))


def main() -> None:
    t0 = time.time()
    notes: list[str] = []
    rng = np.random.default_rng(RNG_SEED)
    oni = load_oni()
    ndj = enso_years(oni)
    countries = load_countries()

    # ---- points and precipitation
    pts = {r.iso3: country_points(r.iso3) for r in countries.itertuples()}
    pts["CHN-SC"] = sichuan_points()
    pts["BRA-S"] = brazil_south_points()
    pts["URY"] = country_points("URY")
    print(f"fetching NASA POWER for {sum(len(v) for v in pts.values())} points ...")
    precip = fetch_precip({k: v for k, v in pts.items() if v})
    print(f"  precip ready ({time.time() - t0:.0f}s)")

    gen = ember_wy_generation()
    kar = kariba_fingerprint(ndj, rng)

    units = [(r.iso3, r.name, r.gw, r.gw_source, r.continent, bool(r.has_monthly)) for r in countries.itertuples()]
    units.append(("CHN-SC", "Sichuan (China)", None, None, "Asia", True))
    validation_units = {"BRA-S": "Southern Brazil (plants south of 23 S)", "URY": "Uruguay"}

    rows, extra = [], {}
    for iso, name, gw, gw_src, cont, has_monthly in units + [(k, v, None, None, None, False) for k, v in validation_units.items()]:
        s = precip.get(iso)
        row = {"iso3": iso, "name": name}
        pr = None
        if s is not None and len(s) > 120:
            st, off = wet_window(s)
            wA = window_totals(s, 10, 12, 0)
            wB = window_totals(s, st, 6, off)
            pr = composite([wA, wB], ndj, rng)
            wins = [("Oct-Sep water year", 10, 12, 0), (f"{window_label(st, 6, off)} wet season", st, 6, off)]
            if pr:
                yrs = pr["years"]
                pr["record"] = f"WY {yrs[0]}/{str(yrs[0] + 1)[-2:]}-{yrs[-1]}/{str(yrs[-1] + 1)[-2:]}"
                pr["windows"] = [w[0] for w in wins]
                pr["wet_season"] = window_label(st, 6, off)
                pr["wet_season_offset"] = off
                pr["wet_season_start"] = st
                pr["el_nino_window"] = wins[pr["el_nino_window_index"]]
                pr["la_nina_window"] = wins[pr["la_nina_window_index"]]
        if iso in validation_units:
            extra[iso] = pr
            continue
        g = None
        if has_monthly and iso in gen:
            g = generation_fingerprint(gen[iso], ndj, rng)

        # choose primary variable
        variables = {}
        if pr:
            variables["basin_precip"] = {
                "el_nino_effect_pct": _r(pr["el_nino_effect_pct"]), "el_nino_p": _r(pr["el_nino_p"], 4),
                "la_nina_effect_pct": _r(pr["la_nina_effect_pct"]), "la_nina_p": _r(pr["la_nina_p"], 4),
                "n_el_nino": pr["n_el_nino"], "n_la_nina": pr["n_la_nina"], "n_neutral": pr["n_neutral"],
                "record": pr["record"],
                "el_nino_window": pr["el_nino_window"][0], "la_nina_window": pr["la_nina_window"][0],
                "effect_by_window_el_nino_pct": dict(zip(pr["windows"], [_r(x) for x in pr["el_nino_effect_by_window"]])),
                "effect_by_window_la_nina_pct": dict(zip(pr["windows"], [_r(x) for x in pr["la_nina_effect_by_window"]])),
                "strong_el_nino_effect_pct": _r(pr.get("strong_el_nino_effect_pct")),
                "strong_el_nino_p": _r(pr.get("strong_el_nino_p"), 4),
                "n_strong_el_nino": pr.get("n_strong_el_nino"),
                "strong_el_nino_years": pr.get("strong_el_nino_years"),
                "n_points": len(pts.get(iso, [])),
                "confidence": "medium",
            }
        if g and g.get("el_nino_effect_pct") is not None or (g and g.get("la_nina_effect_pct") is not None):
            long_rec = g["n_years"] >= 10 and g["n_el_nino"] >= 3 and g["n_la_nina"] >= 3 and g["n_neutral"] >= 4
            variables["hydro_generation"] = {
                "el_nino_effect_pct": _r(g.get("el_nino_effect_pct")), "el_nino_p": _r(g.get("el_nino_p"), 4),
                "la_nina_effect_pct": _r(g.get("la_nina_effect_pct")), "la_nina_p": _r(g.get("la_nina_p"), 4),
                "n_el_nino": g["n_el_nino"], "n_la_nina": g["n_la_nina"], "n_neutral": g["n_neutral"],
                "record": g["record"], "el_nino_years": g["el_nino_years"], "la_nina_years": g["la_nina_years"],
                "confidence": "medium" if long_rec else "low",
                "note": "Water-year (Oct-Sep) Ember hydro TWh, linearly detrended; effect in % of trend.",
            }
        elif g is not None:
            variables["hydro_generation"] = None
        if iso in ("ZMB", "ZWE"):
            variables["reservoir_level"] = {
                "el_nino_effect_pct": _r(kar["el_nino_effect_pct"]), "el_nino_p": _r(kar["el_nino_p"], 4),
                "la_nina_effect_pct": _r(kar["la_nina_effect_pct"]), "la_nina_p": _r(kar["la_nina_p"], 4),
                "n_el_nino": kar["n_el_nino"], "n_la_nina": kar["n_la_nina"], "n_neutral": kar["n_neutral"],
                "record": kar["record"], "confidence": "medium",
                "el_nino_effect_m": _r(kar["el_nino_effect_m"], 2), "la_nina_effect_m": _r(kar["la_nina_effect_m"], 2),
                "mean_rise_neutral_m": _r(kar["mean_rise_neutral_m"], 2),
                "note": "Lake Kariba (G-REALM) level rise from Oct-Nov(y) to Jun-Jul(y+1); effect = % difference in "
                        "that rise vs neutral years.",
            }

        if "reservoir_level" in variables:
            prim = "reservoir_level"
        elif variables.get("hydro_generation") and variables["hydro_generation"]["confidence"] == "medium":
            prim = "hydro_generation"
        elif "basin_precip" in variables:
            prim = "basin_precip"
        elif variables.get("hydro_generation"):
            prim = "hydro_generation"
        else:
            prim = None

        if prim is None:
            notes.append(f"{iso}: no usable record (no hydro plants in GPPD or POWER failed); exposure null.")
            row.update({"variable": None, "el_nino_effect_pct": None, "el_nino_p": None, "la_nina_effect_pct": None,
                        "la_nina_p": None, "n_el_nino": None, "n_la_nina": None, "record": None, "exposure": None,
                        "season_note": None})
        else:
            v = variables[prim]
            row.update({"variable": prim, "el_nino_effect_pct": v["el_nino_effect_pct"], "el_nino_p": v["el_nino_p"],
                        "la_nina_effect_pct": v["la_nina_effect_pct"], "la_nina_p": v["la_nina_p"],
                        "n_el_nino": v["n_el_nino"], "n_la_nina": v["n_la_nina"], "record": v["record"],
                        "exposure": classify(v["el_nino_effect_pct"], v["el_nino_p"], v["la_nina_effect_pct"], v["la_nina_p"]),
                        "confidence": v["confidence"]})
            # season note
            if pr:
                wet = pr["wet_season"]
                ew = pr["el_nino_window"][0]
                lw = pr["la_nina_window"][0]
                sn = f"Hydro basins' wettest 6 months: {wet}. Rainfall El Nino signal strongest in the {ew}" \
                     + (f"; La Nina signal in the {lw}." if lw != ew else "; same window for La Nina.")
                if prim == "reservoir_level":
                    sn = f"Kariba fills Dec-Jul from the {wet} rains; " + sn
                if prim == "hydro_generation":
                    sn = "Primary: Ember generation (water years). " + sn
                row["season_note"] = sn
            else:
                row["season_note"] = None
        # exploratory: does the grid lose in STRONG El Ninos (ONI NDJ >= 1.5, n=5)? The current event is very strong.
        bp0 = variables.get("basin_precip") or {}
        se, sp_ = bp0.get("strong_el_nino_effect_pct"), bp0.get("strong_el_nino_p")
        row["strong_el_nino_loser"] = (None if se is None or sp_ is None
                                       else bool(se <= LOSER_EFFECT and sp_ < LOSER_P))
        row["hydro_gw"] = _r(gw, 2) if gw is not None else None
        row["gw_source"] = gw_src
        row["continent"] = cont
        row["variables"] = variables
        # 6-18 month impact window for the current event (ENSO year 2026)
        if pr:
            ewin = pr["el_nino_window"]
            row["impact_window_current_event"] = (
                "Oct 2026-Sep 2027" if ewin[2] == 12 else window_label(ewin[1], 6, ewin[3], 2026))
        rows.append(row)

    # ---- outlook and implications
    out_look = outlook(oni, notes)
    out_look["la_nina_after_strong_el_nino"] = la_nina_after_strong(ndj)
    status_short = (out_look.get("status") or "El Nino status unknown")
    for r in rows:
        if r.get("exposure") in ("el_nino_loser", "both"):
            v = r["variables"].get(r["variable"], {})
            bp = r["variables"].get("basin_precip") or {}
            if r["variable"] == "reservoir_level":
                core = (f"in past El Nino years Lake Kariba rose {abs(v['el_nino_effect_m']):.1f} m less over the "
                        f"rainy season than in neutral years ({r['el_nino_effect_pct']:+.0f}%, p={r['el_nino_p']:.2f})")
            elif r["variable"] == "hydro_generation":
                core = f"hydro output was {r['el_nino_effect_pct']:+.0f}% vs trend in past El Nino water years (p={r['el_nino_p']:.2f})"
            else:
                core = (f"this grid's hydro basins historically get {abs(r['el_nino_effect_pct']):.0f}% less rain in the "
                        f"{bp.get('el_nino_window', '')} of El Nino years (p={r['el_nino_p']:.2f}, n={r['n_el_nino']})")
            strong = bp.get("strong_el_nino_effect_pct")
            st_txt = f"; {strong:+.0f}% in the {bp.get('n_strong_el_nino')} strong El Ninos" if strong is not None else ""
            r["current_implication"] = (f"{status_short}: El Nino is forecast through early 2027; {core}{st_txt}. "
                                        f"Window to watch: {r.get('impact_window_current_event')}.")
        elif r.get("exposure") == "la_nina_loser":
            r["current_implication"] = ("Loses under La Nina, which is not forecast for the next 6 months; "
                                        "La Nina often follows strong El Ninos, so watch late 2027.")
        elif r.get("exposure") == "neutral":
            r["current_implication"] = "No reliable ENSO signal in this grid's hydro record; rely on the 0-6 month water layer."

    # ---- summary
    nat = [r for r in rows if r["iso3"] != "CHN-SC"]
    enl = [r for r in nat if r.get("exposure") in ("el_nino_loser", "both")]
    lnl = [r for r in nat if r.get("exposure") in ("la_nina_loser", "both")]
    gw_en = sum(r["hydro_gw"] or 0 for r in enl)
    gw_ln = sum(r["hydro_gw"] or 0 for r in lnl)
    gw_all = sum(r["hydro_gw"] or 0 for r in nat)
    sc = next(r for r in rows if r["iso3"] == "CHN-SC")
    summary = {
        "gw_el_nino_losers": round(gw_en, 1), "gw_la_nina_losers": round(gw_ln, 1),
        "n_el_nino_losers": len(enl), "n_la_nina_losers": len(lnl),
        "n_both": sum(1 for r in nat if r.get("exposure") == "both"),
        "n_neutral": sum(1 for r in nat if r.get("exposure") == "neutral"),
        "n_countries": len(nat), "gw_total": round(gw_all, 1),
        "el_nino_losers": [r["iso3"] for r in sorted(enl, key=lambda r: r["el_nino_effect_pct"])],
        "la_nina_losers": [r["iso3"] for r in sorted(lnl, key=lambda r: r["la_nina_effect_pct"])],
        "sichuan_exposure": sc.get("exposure"),
        "strong_el_nino_losers": [r["iso3"] for r in nat if r.get("strong_el_nino_loser")],
        "gw_strong_el_nino_losers": round(sum(r["hydro_gw"] or 0 for r in nat if r.get("strong_el_nino_loser")), 1),
        "strong_el_nino_note": "Exploratory: basin rainfall in the 5 strong El Ninos (1982, 1997, 2009, 2015, 2023) vs "
                               "neutral years, on the El Nino window; not used for the exposure class.",
        "scope_note": "Totals cover the 48 hydro-dependent countries; Sichuan is reported separately (part of China). "
                      "GW is installed hydro capacity from Ember (latest year; GPPD where Ember has none).",
        "headline": (f"{gw_en:.0f} GW of hydropower sits in {len(enl)} grids that lose output under El Nino "
                     f"({gw_ln:.0f} GW in {len(lnl)} grids lose under La Nina), and extreme El Ninos are projected "
                     f"to come about twice as often."),
    }

    # ---- validation
    byiso = {r["iso3"]: r for r in rows}
    val = []
    for v in VALIDATION:
        items = []
        for iso in v["iso3"]:
            if iso in extra:
                pr = extra[iso]
                eff, p = (pr["el_nino_effect_pct"], pr["el_nino_p"]) if pr else (None, None)
                bw = {k: _r(x) for k, x in zip(pr["windows"], pr["el_nino_effect_by_window"])} if pr else None
                nm = validation_units[iso]
            else:
                bp = byiso[iso]["variables"].get("basin_precip")
                eff, p = (bp["el_nino_effect_pct"], bp["el_nino_p"]) if bp else (None, None)
                bw = bp["effect_by_window_el_nino_pct"] if bp else None
                nm = byiso[iso]["name"]
            ok = None if eff is None else (np.sign(eff) == v["sign"])
            items.append({"iso3": iso, "name": nm, "el_nino_precip_effect_pct": _r(eff), "p": _r(p, 4),
                          "effect_by_window_pct": bw, "sign_matches": None if ok is None else bool(ok),
                          "significant_p_lt_0_1": None if p is None else bool(p < 0.1)})
        n_ok = sum(1 for i in items if i["sign_matches"])
        val.append({"region": v["region"], "expected": v["expect"], "units": items,
                    "result": f"{n_ok}/{len(items)} with expected sign; "
                              f"{sum(1 for i in items if i['sign_matches'] and i['significant_p_lt_0_1'])} also p<0.1"})
    if extra.get("BRA-S") is not None or extra.get("URY") is not None:
        notes.append("Southern Brazil (GPPD plants south of 23 S) and Uruguay are computed for validation only; "
                     "they are not in the 48-country list.")
    notes.append("Sichuan rainfall points come from GPPD Chinese hydro plants in a bounding box around the province "
                 f"(lon {SICHUAN_BBOX[0]}-{SICHUAN_BBOX[1]}, lat {SICHUAN_BBOX[2]}-{SICHUAN_BBOX[3]}).")
    notes.append("Ng, Turner & Galelli 2017 (ERL) is the 1,593-dam ENSO-hydropower study; 'more than one third' of "
                 "dams show significant anomalies in at least one phase.")

    res = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": ["oni", "cpc_enso", "geos_s2s", "power", "gppd", "ember_monthly", "ember_yearly", "ember_china",
                    "grealm"],
        "method": METHOD,
        "summary": summary,
        "countries": sorted(rows, key=lambda r: (r["iso3"] == "CHN-SC", -(r["hydro_gw"] or 0))),
        "outlook": out_look,
        "projections": PROJECTIONS,
        "enso_years": {"definition": f"ONI NDJ(y) >= {EN_T} El Nino, <= {LN_T} La Nina",
                       "el_nino": [int(y) for y in ndj.index if y >= 1981 and ndj[y] >= EN_T],
                       "la_nina": [int(y) for y in ndj.index if y >= 1981 and ndj[y] <= LN_T],
                       "strong_el_nino": [int(y) for y in ndj.index if y >= 1981 and ndj[y] >= STRONG_T]},
        "kariba": {k: kar[k] for k in ("record", "n_el_nino", "n_la_nina", "n_neutral", "el_nino_years",
                                        "mean_rise_neutral_m", "mean_rise_el_nino_m", "mean_rise_la_nina_m",
                                        "mean_rise_other_m", "el_nino_vs_other_m", "el_nino_vs_other_p",
                                        "rise_by_year_m")},
        "validation": val,
        "context": {"literature": "Ng, Turner & Galelli 2017: more than a third of 1,593 simulated dams show "
                                  "significant annual production anomalies in at least one ENSO phase; effects are "
                                  "strong regionally and partly cancel globally; reservoirs dampen them.",
                    "both_phases": "Both phases matter: El Nino 2023/24 drained Lake Kariba; Brazil's 2021 "
                                   "hydro crisis happened under La Nina."},
        "limitations": LIMITATIONS,
        "notes": notes,
        "runtime_s": None,
    }
    res["runtime_s"] = round(time.time() - t0, 1)

    def clean(o):
        if isinstance(o, dict):
            return {str(k): clean(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [clean(v) for v in o]
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating, float)):
            return None if (math.isnan(o) or math.isinf(o)) else float(o)
        if isinstance(o, np.bool_):
            return bool(o)
        return o

    (OUT / "enso.json").write_text(json.dumps(clean(res), indent=1, ensure_ascii=False))
    print(f"wrote {OUT / 'enso.json'} in {res['runtime_s']}s")
    print(summary["headline"])
    for r in res["countries"]:
        print(f"  {r['iso3']:7s} {str(r['variable']):16s} EN {r['el_nino_effect_pct']!s:>7} p={r['el_nino_p']!s:7} "
              f"LN {r['la_nina_effect_pct']!s:>7} p={r['la_nina_p']!s:7} {r['exposure']}")
    for v in val:
        print(" VALIDATION", v["region"], "->", v["result"],
              [(i["iso3"], i["el_nino_precip_effect_pct"], i["p"]) for i in v["units"]])


if __name__ == "__main__":
    main()
