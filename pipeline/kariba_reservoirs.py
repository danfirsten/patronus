"""Other major hydro reservoirs from the G-REALM 10-day archive (NASA/USDA).

Files are extracted from https://earth.gsfc.nasa.gov/gwm/zip/lake.10.tar.gz into
data/raw/grealm/ (only the lakes listed below). For each lake: latest level and its anomaly
against the mean of the same calendar month in all earlier years.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.paths import RAW

LAKES = [  # (G-REALM id, name, ISO3 of the main hydro owner, dam)
    ("000414", "Cahora Bassa", "MOZ", "Cahora Bassa"),
    ("000393", "Volta", "GHA", "Akosombo"),
    ("000432", "Guri", "VEN", "Guri (Simon Bolivar)"),
    ("000331", "Nasser", "EGY", "Aswan High Dam"),
    ("000417", "Kainji", "NGA", "Kainji"),
    ("000501", "Itaipu", "PRY", "Itaipu (shared with Brazil)"),
    ("000345", "Sobradinho", "BRA", "Sobradinho"),
    ("000625", "Tarbela", "PAK", "Tarbela"),
]


def read_grealm(lake_id: str) -> pd.DataFrame:
    """Parse a G-REALM .10d.2.txt file; column 15 is the level above the EGM2008 geoid."""
    f = RAW / "grealm" / f"lake{lake_id}.10d.2.txt"
    rows = []
    for line in f.read_text(errors="ignore").splitlines():
        p = line.split()
        if len(p) != 16 or not p[2].isdigit() or p[2] == "99999999":
            continue
        lvl = float(p[14])
        if lvl > 9000:
            continue
        rows.append((pd.to_datetime(p[2], format="%Y%m%d"), p[0], lvl, float(p[6]), int(p[15])))
    return pd.DataFrame(rows, columns=["date", "mission", "level_m", "err_m", "igdr_flag"])


def summarize_lake(lake_id, name, iso3, dam):
    try:
        d = read_grealm(lake_id)
    except FileNotFoundError:
        return {"name": name, "country": iso3, "dam": dam, "grealm_id": lake_id,
                "latest_level_m": None, "anomaly_m": None, "note": "G-REALM file not available"}
    if d.empty:
        return {"name": name, "country": iso3, "dam": dam, "grealm_id": lake_id,
                "latest_level_m": None, "anomaly_m": None, "note": "no valid passes"}
    last = d.iloc[-1]
    m = d.set_index("date")["level_m"].resample("MS").mean().dropna()
    cal = last["date"].month
    lm = last["date"].to_period("M").to_timestamp()
    same = m[(m.index.month == cal) & (m.index < lm)]
    cur = m.get(lm, last["level_m"])
    anom = cur - same.mean() if len(same) >= 5 else np.nan
    pct = float((same < cur).mean() * 100) if len(same) >= 5 else np.nan
    yago = m.get(lm - pd.DateOffset(years=1), np.nan)
    return {"name": name, "country": iso3, "dam": dam, "grealm_id": lake_id,
            "latest_date": last["date"].strftime("%Y-%m-%d"),
            "latest_level_m": round(float(last["level_m"]), 2),
            "month_mean_level_m": round(float(cur), 2),
            "anomaly_m": None if np.isnan(anom) else round(float(anom), 2),
            "percentile_same_month": None if np.isnan(pct) else round(pct, 0),
            "change_vs_year_ago_m": None if np.isnan(yago) else round(float(cur - yago), 2),
            "n_years_baseline": int(len(same)), "record_from": d["date"].min().strftime("%Y-%m"),
            "datum": "m above EGM2008 geoid (satellite altimetry; not the operator's gauge datum)"}


def other_reservoirs():
    return [summarize_lake(*x) for x in LAKES]


if __name__ == "__main__":
    import json
    print(json.dumps(other_reservoirs(), indent=1))
