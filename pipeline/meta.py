"""Sources registry, AI disclosure and NASA data summary -> web/public/data/meta.json.

Run from the repo root:  python3 -m pipeline.meta

Coverage is read from the downloaded raw files where they exist; otherwise the
registry's static coverage string is kept.
"""
from __future__ import annotations

import datetime as dt
import json

from pipeline.paths import ISSUE_DATE, OUT, RAW, REFERENCE

SOURCES = [
    {
        "id": "ember_monthly", "name": "Ember monthly electricity data (global)", "provider": "Ember", "nasa": False,
        "url": "https://files.ember-energy.org/public-downloads/generation/outputs/release_generation_monthly_global.csv",
        "coverage": "monthly, varies by country", "license": "CC BY 4.0",
        "use": "Monthly hydro generation by country: the label for the tier-1 shortfall forecasts and backtests.",
    },
    {
        "id": "ember_yearly", "name": "Ember yearly electricity data (global)", "provider": "Ember", "nasa": False,
        "url": "https://files.ember-energy.org/public-downloads/generation/outputs/release_generation_yearly_global.csv",
        "coverage": "yearly", "license": "CC BY 4.0",
        "use": "Hydro share and TWh by country: selects the 48 hydro-dependent countries (hydro >= 30% and >= 1 TWh).",
    },
    {
        "id": "ember_china", "name": "Ember China provincial monthly generation", "provider": "Ember", "nasa": False,
        "url": "https://files.ember-energy.org/public-downloads/generation/outputs/release_chn_subnational_generation_monthly.csv",
        "coverage": "monthly", "license": "CC BY 4.0",
        "use": "Sichuan province monthly hydro generation, treated as its own grid (CHN-SC).",
    },
    {
        "id": "gravis", "name": "GRACE/GRACE-FO terrestrial water storage (GFZ GravIS Level-3 TWS grid, RL06)",
        "provider": "NASA/DLR/GFZ (GRACE, GRACE-FO); gridded by GFZ GravIS", "nasa": True,
        "url": "https://isdc-data.gfz.de/grace/GravIS/GFZ/Level-3/TWS/GRAVIS-3_GFZOP_0600_TWS_GRID_GFZ_0006.nc",
        "doi": "10.5880/GFZ.GRAVIS_06_L3_TWS",
        "coverage": "2002-04..2026-08, monthly", "license": "CC BY 4.0",
        "use": "Water stored in each hydropower basin: drying trends since 2002 and a predictor for the shortfall models.",
    },
    {
        "id": "power", "name": "NASA POWER (MERRA-2 based meteorology and soil wetness)", "provider": "NASA LaRC", "nasa": True,
        "url": "https://power.larc.nasa.gov/",
        "coverage": "monthly 1981..; daily to about 3 days ago",
        "license": "Free and open (NASA Earth science data policy; cite NASA POWER)",
        "use": "Basin precipitation, root-zone and surface soil wetness and temperature (stand-ins for GPM and SMAP) for trends, ENSO fingerprints and model features.",
    },
    {
        "id": "grealm", "name": "G-REALM global reservoir and lake levels (satellite radar altimetry)",
        "provider": "NASA GSFC / USDA FAS (TOPEX/Poseidon, Jason-1/2/3, Sentinel-6)", "nasa": True,
        "url": "https://earth.gsfc.nasa.gov/gwm/lake/Index",
        "coverage": "1992..present, 10-day", "license": "Free and open (NASA/USDA public data; cite G-REALM)",
        "use": "Lake Kariba water level from space, converted to % usable storage: the reservoir forecast target.",
    },
    {
        "id": "oni", "name": "Oceanic Nino Index (ONI)", "provider": "NOAA Climate Prediction Center", "nasa": False,
        "url": "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt",
        "coverage": "1950..present, 3-month seasons", "license": "Public domain (US Government work)",
        "use": "El Nino / La Nina phase for the ENSO fingerprints and the ENSO-only baseline.",
    },
    {
        "id": "cpc_enso", "name": "CPC ENSO diagnostic discussion (official ENSO outlook)", "provider": "NOAA Climate Prediction Center / IRI", "nasa": False,
        "url": "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml",
        "coverage": "monthly issues", "license": "Public domain (US Government work)",
        "use": "The official ENSO forecast that the 6-18 month horizon consumes (Patronus does not forecast ENSO itself).",
    },
    {
        "id": "geos_s2s", "name": "NASA GEOS-S2S-3 subseasonal-to-seasonal forecasts (near real time)", "provider": "NASA GMAO", "nasa": True,
        "url": "https://portal.nccs.nasa.gov/datashare/gmao/geos-s2s-3/NRT/",
        "coverage": "current monthly forecast runs", "license": "Free and open (NASA Earth science data policy)",
        "use": "Seasonal outlook for the coming months over the basins, shown alongside the forecast (not backtested).",
    },
    {
        "id": "gppd", "name": "Global Power Plant Database v1.3", "provider": "World Resources Institute", "nasa": False,
        "url": "https://wri-dataportal-prod.s3.amazonaws.com/manual/global_power_plant_database_v_1_3.zip",
        "coverage": "snapshot 2021", "license": "CC BY 4.0",
        "use": "Locations and capacities of hydro plants, used to pick basins and capacity-weight them per country. Newer plants (e.g. Coca Codo Sinclair) may be missing.",
    },
    {
        "id": "hydrobasins", "name": "HydroBASINS (HydroSHEDS) level-4 basins", "provider": "WWF / HydroSHEDS", "nasa": False,
        "url": "https://www.hydrosheds.org/products/hydrobasins",
        "coverage": "static", "license": "CC BY 4.0 (HydroSHEDS licence since 2022)",
        "use": "River basin polygons that hold the hydro plants; the unit for trends and features.",
    },
    {
        "id": "gibs_blackmarble", "name": "NASA Black Marble night lights (VNP46A2, Suomi NPP VIIRS) via NASA GIBS",
        "provider": "NASA (LAADS DAAC product, GIBS imagery)", "nasa": True,
        "url": "https://nasa-gibs.github.io/gibs-api-docs/",
        "layer": "VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance",
        "doi": "10.5067/VIIRS/VNP46A2.001",
        "coverage": "daily 2012-01..present (with gaps)", "license": "Free and open (NASA Earth science data policy)",
        "use": "Night-lights replay of Zambia 2024 and Ecuador 2024; approximate brightness change from display imagery.",
    },
    {
        "id": "ons", "name": "ONS open data: daily stored energy (EAR) and natural inflow energy (ENA) by subsystem",
        "provider": "Operador Nacional do Sistema Eletrico (Brazil)", "nasa": False,
        "url": "https://dados.ons.org.br",
        "coverage": "daily", "license": "CC BY (Creative Commons Atribuicao, as listed on the portal)",
        "use": "Brazil reservoir storage and inflows, as a ground-truth check on the Brazil forecast.",
    },
    {
        "id": "zra", "name": "Zambezi River Authority: Kariba lake levels, allocations and press statements",
        "provider": "Zambezi River Authority", "nasa": False,
        "url": "https://www.zambezira.org/hydrology/lake-levels",
        "coverage": "weekly levels; press statements", "license": "Public web pages, copyright ZRA (cited, not redistributed)",
        "use": "Kariba operating range (475.50-488.50 m), usable storage, the 2027 allocation cut and ZRA's own projection.",
    },
    {
        "id": "world_bank", "name": "World Bank, Vietnam Macro Monitoring / Taking Stock, August 2023", "provider": "World Bank", "nasa": False,
        "url": "https://openknowledge.worldbank.org/bitstreams/824de743-3c02-4123-8f30-35f1e6236b78/download",
        "coverage": "Aug 2023", "license": "CC BY 3.0 IGO",
        "use": "Preliminary cost of Vietnam's 2023 power shortage (about $1.4B, roughly 0.3% of GDP).",
    },
    {
        "id": "imf", "name": "IMF press release 24/413: Zambia, staff-level agreement on the 4th ECF review (11 Nov 2024)", "provider": "International Monetary Fund", "nasa": False,
        "url": "https://www.imf.org/en/news/articles/2024/11/11/pr-24413-zambia-imf-reaches-agreement-on-4th-review-of-ecf",
        "coverage": "Nov 2024", "license": "Copyright IMF (cited, not redistributed)",
        "use": "Macroeconomic impact of Zambia's 2024 drought and power crisis.",
    },
    {
        "id": "zesco_erb", "name": "ZESCO tariff application to the Energy Regulation Board (July 2024)", "provider": "ZESCO / Energy Regulation Board of Zambia", "nasa": False,
        "url": "https://www.erb.org.zm/wp-content/uploads/files/ZESCO-Tarrif-Application-Submission.pdf",
        "coverage": "Jul 2024", "license": "Public regulatory filing (cited)",
        "use": "Replacement power costs for Zambia (Eskom 17c, Mozambique/Karpowership 22c, diesel 26c, blended 23.2c per kWh) in the cost model.",
    },
    {
        "id": "news", "name": "News reports and official statements (crisis timelines)", "provider": "Various (cited per item)", "nasa": False,
        "url": None,
        "coverage": "2021..2026", "license": "Cited per item; not redistributed",
        "use": "Dates of warnings, cuts and recoveries for the crisis timelines and night-lights captions; each item carries its own link.",
    },
]

AI_DISCLOSURE = ("AI tools (Claude) were used for research, critique, coding, and drafting the written briefs. "
                 "The project concept came from the team. All numbers come from the data pipeline and cited sources.")

NASA_DATA_SUMMARY = [
    {"mission": "GRACE / GRACE-FO", "what": "Terrestrial water storage (via GFZ GravIS)", "source_id": "gravis"},
    {"mission": "MERRA-2 (via NASA POWER)", "what": "Precipitation, soil wetness, temperature", "source_id": "power"},
    {"mission": "TOPEX/Poseidon, Jason-1/2/3, Sentinel-6 (via G-REALM)", "what": "Reservoir water levels (Lake Kariba)", "source_id": "grealm"},
    {"mission": "Suomi NPP VIIRS Black Marble (via NASA GIBS)", "what": "Night lights during blackouts", "source_id": "gibs_blackmarble"},
    {"mission": "GEOS-S2S (NASA GMAO)", "what": "Seasonal forecasts", "source_id": "geos_s2s"},
]


def _coverage() -> dict[str, str]:
    """Read actual coverage from local raw files; skip any that are missing."""
    cov: dict[str, str] = {}

    def attempt(key, fn):
        try:
            cov[key] = fn()
        except Exception:  # noqa: BLE001 - missing or unreadable file keeps the static string
            pass

    def ember_monthly():
        import pandas as pd
        d = pd.read_csv(RAW / "ember_release_generation_monthly_global.csv", usecols=["Date"]).Date
        return f"{d.min()[:7]}..{d.max()[:7]}, monthly (start varies by country)"

    def ember_yearly():
        import pandas as pd
        y = pd.read_csv(RAW / "ember_release_generation_yearly_global.csv", usecols=["Year"]).Year
        return f"{y.min()}..{y.max()}, yearly"

    def ember_china():
        import pandas as pd
        d = pd.read_csv(RAW / "ember_release_chn_subnational_generation_monthly.csv", usecols=["Date"]).Date
        return f"{d.min()[:7]}..{d.max()[:7]}, monthly"

    def gravis():
        import pandas as pd
        d = pd.read_csv(REFERENCE / "upper_zambezi_box_gravis_tws.csv").date
        return f"{d.iloc[0][:7]}..{d.iloc[-1][:7]}, monthly (with the 2017-2018 gap between GRACE and GRACE-FO)"

    def grealm():
        import pandas as pd
        d = pd.read_csv(REFERENCE / "kariba_grealm_10day_levels.csv").date
        return f"Kariba {d.iloc[0]}..{d.iloc[-1]}, 10-day"

    def oni():
        last = [ln.split() for ln in (RAW / "oni.ascii.txt").read_text().splitlines() if ln.strip()][-1]
        return f"DJF 1950..{last[0]} {last[1]}, 3-month seasons"

    def ons():
        import pandas as pd
        d = pd.read_csv(RAW / "ons" / "EAR_DIARIO_SUBSISTEMA_2026.csv", sep=";").ear_data
        return f"daily; in use {d.min()}..{d.max()}"

    def nightlights():
        n = json.loads((OUT / "nightlights.json").read_text())
        days = sorted(d for f in n["frames"] for d in f["nights_used"])
        return f"daily 2012-01..present (with gaps); frames used {days[0]}..{days[-1]}"

    for k, fn in [("ember_monthly", ember_monthly), ("ember_yearly", ember_yearly), ("ember_china", ember_china),
                  ("gravis", gravis), ("grealm", grealm), ("oni", oni), ("ons", ons),
                  ("gibs_blackmarble", nightlights)]:
        attempt(k, fn)
    return cov


def main() -> None:
    cov = _coverage()
    sources = []
    for s in SOURCES:
        s = dict(s)
        if s["id"] in cov:
            s["coverage"] = cov[s["id"]]
        sources.append(s)
    doc = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "issue_date": ISSUE_DATE,
        "sources": sources,
        "nasa_data_summary": NASA_DATA_SUMMARY,
        "ai_disclosure": AI_DISCLOSURE,
        "notes": [
            "Licences are as stated by each provider at the time of download; check the provider page before reuse.",
            "The IMF site returns HTTP 403 to automated requests, so its URL could not be re-checked by the pipeline.",
        ],
    }
    (OUT / "meta.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False))
    print(f"wrote {OUT / 'meta.json'}: {len(sources)} sources, {sum(s['nasa'] for s in sources)} NASA")


if __name__ == "__main__":
    main()
