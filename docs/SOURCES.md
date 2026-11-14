# Data sources and references

Generated from `web/public/data/meta.json` (rebuild with `python3 -m pipeline.meta`). NASA and partner-agency sources are listed first.

| Source | Provider | NASA | Coverage | Licence | How Patronus uses it |
|---|---|---|---|---|---|
| [G-REALM global reservoir and lake levels (satellite radar altimetry)](https://earth.gsfc.nasa.gov/gwm/lake/Index) | NASA GSFC / USDA FAS (TOPEX/Poseidon, Jason-1/2/3, Sentinel-6) | yes | Kariba 1992-11-22..2026-11-09, 10-day | Free and open (NASA/USDA public data; cite G-REALM) | Lake Kariba water level from space, converted to % usable storage: the reservoir forecast target. |
| [GPCP v2.3 monthly precipitation (satellite + gauge)](https://psl.noaa.gov/data/gridded/data.gpcp.html) | NASA GSFC / GEWEX; distributed by NOAA PSL | yes | 1979-01..2026-10, 2.5 degree grid (months after 2021-11 are interim) | Public domain (US Government work) | Main rainfall record for the ENSO fingerprints and basin rainfall trends. It drifts dry after 2019 in many regions, so rain trends use 2002-2019 and the ENSO result is checked on 1981-2019. |
| [GRACE/GRACE-FO terrestrial water storage (GFZ GravIS Level-3 TWS grid, RL06)](https://isdc-data.gfz.de/grace/GravIS/GFZ/Level-3/TWS/GRAVIS-3_GFZOP_0600_TWS_GRID_GFZ_0006.nc) | NASA/DLR/GFZ (GRACE, GRACE-FO); gridded by GFZ GravIS | yes | 2002-04..2026-08, monthly (with the 2017-2018 gap between GRACE and GRACE-FO) | CC BY 4.0 | Water stored in each hydropower basin: drying trends since 2002 and a predictor for the shortfall models. |
| [NASA Black Marble night lights (VNP46A2, Suomi NPP VIIRS) via NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/) | NASA (LAADS DAAC product, GIBS imagery) | yes | daily 2012-01..present (with gaps); frames used 2023-02-08..2026-11-02 | Free and open (NASA Earth science data policy) | Night-lights replay of Zambia 2024 and Ecuador 2024; approximate brightness change from display imagery. |
| [NASA GEOS-S2S-3 subseasonal-to-seasonal forecasts (near real time)](https://portal.nccs.nasa.gov/datashare/gmao/geos-s2s-3/NRT/) | NASA GMAO | yes | current monthly forecast runs | Free and open (NASA Earth science data policy) | Seasonal outlook for the coming months over the basins, shown alongside the forecast (not backtested). |
| [NASA POWER (MERRA-2 based meteorology and soil wetness)](https://power.larc.nasa.gov/) | NASA LaRC | yes | monthly 1981..; daily to about 3 days ago | Free and open (NASA Earth science data policy; cite NASA POWER) | Basin precipitation, root-zone and surface soil wetness and temperature (stand-ins for GPM and SMAP) for trends, ENSO fingerprints and model features. |
| [CPC ENSO diagnostic discussion (official ENSO outlook)](https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml) | NOAA Climate Prediction Center / IRI |  | monthly issues | Public domain (US Government work) | The official ENSO forecast that the 6-18 month horizon consumes (Patronus does not forecast ENSO itself). |
| [Ember China provincial monthly generation](https://files.ember-energy.org/public-downloads/generation/outputs/release_chn_subnational_generation_monthly.csv) | Ember |  | 2016-01..2026-09, monthly | CC BY 4.0 | Sichuan province monthly hydro generation, treated as its own grid (CHN-SC). |
| [Ember monthly electricity data (global)](https://files.ember-energy.org/public-downloads/generation/outputs/release_generation_monthly_global.csv) | Ember |  | 1998-12..2026-10, monthly (start varies by country) | CC BY 4.0 | Monthly hydro generation by country: the label for the tier-1 shortfall forecasts and backtests. |
| [Ember yearly electricity data (global)](https://files.ember-energy.org/public-downloads/generation/outputs/release_generation_yearly_global.csv) | Ember |  | 1985..2025, yearly | CC BY 4.0 | Hydro share and TWh by country: selects the 48 hydro-dependent countries (hydro >= 30% and >= 1 TWh). |
| [Global Power Plant Database v1.3](https://wri-dataportal-prod.s3.amazonaws.com/manual/global_power_plant_database_v_1_3.zip) | World Resources Institute |  | snapshot 2021 | CC BY 4.0 | Locations and capacities of hydro plants, used to pick basins and capacity-weight them per country. Newer plants (e.g. Coca Codo Sinclair) may be missing. |
| [HydroBASINS (HydroSHEDS) level-4 basins](https://www.hydrosheds.org/products/hydrobasins) | WWF / HydroSHEDS |  | static | CC BY 4.0 (HydroSHEDS licence since 2022) | River basin polygons that hold the hydro plants; the unit for trends and features. |
| [IMF press release 24/413: Zambia, staff-level agreement on the 4th ECF review (11 Nov 2024)](https://www.imf.org/en/news/articles/2024/11/11/pr-24413-zambia-imf-reaches-agreement-on-4th-review-of-ecf) | International Monetary Fund |  | Nov 2024 | Copyright IMF (cited, not redistributed) | Macroeconomic impact of Zambia's 2024 drought and power crisis. |
| News reports and official statements (crisis timelines) | Various (cited per item) |  | 2021..2026 | Cited per item; not redistributed | Dates of warnings, cuts and recoveries for the crisis timelines and night-lights captions; each item carries its own link. |
| [ONS open data: daily stored energy (EAR) and natural inflow energy (ENA) by subsystem](https://dados.ons.org.br) | Operador Nacional do Sistema Eletrico (Brazil) |  | daily; in use 2026-01-01..2026-11-13 | CC BY (Creative Commons Atribuicao, as listed on the portal) | Brazil reservoir storage and inflows, as a ground-truth check on the Brazil forecast. |
| [Oceanic Nino Index (ONI)](https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt) | NOAA Climate Prediction Center |  | DJF 1950..ASO 2026, 3-month seasons | Public domain (US Government work) | El Nino / La Nina phase for the ENSO fingerprints and the ENSO-only baseline. |
| [World Bank, Vietnam Macro Monitoring / Taking Stock, August 2023](https://openknowledge.worldbank.org/bitstreams/824de743-3c02-4123-8f30-35f1e6236b78/download) | World Bank |  | Aug 2023 | CC BY 3.0 IGO | Preliminary cost of Vietnam's 2023 power shortage (about $1.4B, roughly 0.3% of GDP). |
| [ZESCO tariff application to the Energy Regulation Board (July 2024)](https://www.erb.org.zm/wp-content/uploads/files/ZESCO-Tarrif-Application-Submission.pdf) | ZESCO / Energy Regulation Board of Zambia |  | Jul 2024 | Public regulatory filing (cited) | Replacement power costs for Zambia (Eskom 17c, Mozambique/Karpowership 22c, diesel 26c, blended 23.2c per kWh) in the cost model. |
| [Zambezi River Authority: Kariba lake levels, allocations and press statements](https://www.zambezira.org/hydrology/lake-levels) | Zambezi River Authority |  | weekly levels; press statements | Public web pages, copyright ZRA (cited, not redistributed) | Kariba operating range (475.50-488.50 m), usable storage, the 2027 allocation cut and ZRA's own projection. |

## NASA missions and models used

- {'mission': 'GRACE / GRACE-FO', 'what': 'Terrestrial water storage (via GFZ GravIS)', 'source_id': 'gravis'}
- {'mission': 'MERRA-2 (via NASA POWER)', 'what': 'Precipitation, soil wetness, temperature', 'source_id': 'power'}
- {'mission': 'TOPEX/Poseidon, Jason-1/2/3, Sentinel-6 (via G-REALM)', 'what': 'Reservoir water levels (Lake Kariba)', 'source_id': 'grealm'}
- {'mission': 'Suomi NPP VIIRS Black Marble (via NASA GIBS)', 'what': 'Night lights during blackouts', 'source_id': 'gibs_blackmarble'}
- {'mission': 'GEOS-S2S (NASA GMAO)', 'what': 'Seasonal forecasts', 'source_id': 'geos_s2s'}

## Scientific references

- Ng, J.Y., Turner, S.W.D. & Galelli, S. (2017). Influence of El Niño Southern Oscillation on global hydropower production. *Environmental Research Letters* 12, 034010. doi:10.1088/1748-9326/aa5ef8
- Cai, W. et al. (2014). Increasing frequency of extreme El Niño events due to greenhouse warming. *Nature Climate Change* 4, 111-116. doi:10.1038/nclimate2100
- Wang, G. et al. (2017). Continued increase of extreme El Niño frequency long after 1.5 °C warming stabilization. *Nature Climate Change* 7, 568-572. doi:10.1038/nclimate3351
- Hamed, K.H. & Rao, A.R. (1998). A modified Mann-Kendall trend test for autocorrelated data. *Journal of Hydrology* 204, 182-196.
- Benjamini, Y. & Hochberg, Y. (1995). Controlling the false discovery rate. *Journal of the Royal Statistical Society B* 57, 289-300.

## Crisis facts

Every crisis date and cost, with its source link, is in `web/public/data/crises.json` (built by `pipeline/crises.py`).

## AI use (Super Intelligence) statement

AI tools (Claude) were used for research, critique, coding, and drafting the written briefs. The project concept came from the team. All numbers come from the data pipeline and cited sources.
