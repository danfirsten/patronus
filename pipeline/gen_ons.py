"""Brazil ONS reservoir storage test (idea from the Future Detector back-test, branch fd/backtest-v2).

Data: ONS open data (no login), daily per subsystem, data/raw/ons/{EAR,ENA}_DIARIO_SUBSISTEMA_{YEAR}.csv.
  EAR: stored energy (MWmonth) and max storage per subsystem -> SIN-wide EAR % = sum(stored) / sum(max).
  ENA: natural inflow energy (MWmed) and % of long-term mean (MLT) -> SIN-wide % MLT = sum(ENA) / sum(ENA / pct).
Features for BRA only, issue month t with a 1-month publication lag (data is ~1 day behind, so conservative):
  ons_ear_pct      = monthly-mean SIN EAR % at t-1
  ons_ear_change_3m = EAR(t-1) - EAR(t-4)
  ons_ena_3m_pct_mlt = mean of monthly SIN ENA % MLT over t-3..t-1
Other countries get NaN.
"""
from __future__ import annotations

import glob

import numpy as np
import pandas as pd

from pipeline.paths import RAW

ONS_FEATURES = ["ons_ear_pct", "ons_ear_change_3m", "ons_ena_3m_pct_mlt"]


def _read(kind: str) -> pd.DataFrame:
    files = sorted(glob.glob(str(RAW / "ons" / f"{kind}_DIARIO_SUBSISTEMA_*.csv")))
    return pd.concat([pd.read_csv(f, sep=";", decimal=".") for f in files], ignore_index=True)


def ons_monthly() -> pd.DataFrame:
    e = _read("EAR")
    e["d"] = pd.to_datetime(e["ear_data"])
    e = e.dropna(subset=["ear_max_subsistema", "ear_verif_subsistema_mwmes"])
    day = e.groupby("d").agg(st=("ear_verif_subsistema_mwmes", "sum"), mx=("ear_max_subsistema", "sum"))
    ear = (day["st"] / day["mx"] * 100).groupby(day.index.to_period("M")).mean()
    a = _read("ENA")
    a["d"] = pd.to_datetime(a["ena_data"])
    a = a[(a["ena_bruta_regiao_percentualmlt"] > 0)].dropna(subset=["ena_bruta_regiao_mwmed"])
    a["mlt"] = a["ena_bruta_regiao_mwmed"] / (a["ena_bruta_regiao_percentualmlt"] / 100)
    dd = a.groupby("d").agg(v=("ena_bruta_regiao_mwmed", "sum"), m=("mlt", "sum"))
    ena = (dd["v"] / dd["m"] * 100).groupby(dd.index.to_period("M")).mean()
    out = pd.DataFrame({"ear_pct": ear, "ena_pct_mlt": ena})
    return out.reindex(pd.period_range(out.index.min(), out.index.max(), freq="M"))


def add_ons_features(D: pd.DataFrame) -> pd.DataFrame:
    m = ons_monthly()
    D = D.copy()
    for c in ONS_FEATURES:
        D[c] = np.nan
    b = D["iso3"] == "BRA"
    t = pd.PeriodIndex(D.loc[b, "issue"])
    ear, ena = m["ear_pct"], m["ena_pct_mlt"]
    D.loc[b, "ons_ear_pct"] = ear.reindex(t - 1).values
    D.loc[b, "ons_ear_change_3m"] = ear.reindex(t - 1).values - ear.reindex(t - 4).values
    D.loc[b, "ons_ena_3m_pct_mlt"] = np.nanmean(np.column_stack([ena.reindex(t - k).values for k in (1, 2, 3)]), axis=1)
    return D
