# Patronus data tree

Every dataset Patronus uses, grouped from broad buckets down to the actual data, in plain words. **NASA** marks NASA data or data from a NASA partner mission. Facts come from `web/public/data/meta.json`, `docs/SOURCES.md`, `web/public/data/explorer/index.json`, the `pipeline/` docstrings, and `DESIGN.md` sections 11.5, 12 and 14.

Visual version (collapsible, phone-friendly): https://claude.ai/artifact/73QZ2fNBkfWQRFfuYz7D9P

```text
Patronus data
├── Water in the ground and rivers
│   ├── Total water stored
│   │   └── GRACE / GRACE-FO water storage  [NASA]
│   └── Soil moisture
│       ├── Root-zone soil wetness  [NASA]
│       └── Surface soil wetness  [NASA]
├── Water in the lakes
│   ├── Lake levels from space
│   │   └── G-REALM satellite lake levels  [NASA]
│   └── Official lake numbers
│       └── Zambezi River Authority (ZRA) records
├── Water from the sky
│   ├── Rainfall
│   │   ├── GPCP rainfall  [NASA]
│   │   └── MERRA-2 rainfall  [NASA]
│   └── Heat
│       └── Air temperature  [NASA]
├── Climate drivers
│   ├── What happened
│   │   └── El Niño index (ONI)
│   └── What is expected
│       ├── Official El Niño outlook (CPC)
│       └── NASA GEOS-S2S seasonal forecast  [NASA]
├── Power and people
│   ├── Hydro generation
│   │   ├── Ember monthly electricity data
│   │   ├── Ember yearly electricity data
│   │   └── Ember China province data
│   ├── Where the dams are
│   │   ├── Global Power Plant Database
│   │   └── HydroBASINS river basins
│   ├── Night lights
│   │   └── Black Marble night lights  [NASA]
│   └── Crisis dates and costs
│       ├── News reports and official statements
│       ├── ZESCO's tariff filing
│       ├── IMF statement on Zambia
│       └── World Bank report on Vietnam
├── What we make from it
│   ├── Drying-trend map
│   ├── Trend Detective page
│   ├── El Niño exposure
│   ├── Kariba forecast
│   ├── Release simulator and cost of waiting
│   ├── Reservoir watch
│   ├── Country watchlist (experimental)
│   ├── Crisis scoreboard
│   └── Night-lights replay
└── Tried, not used
    ├── Tested in Patronus and dropped
    │   ├── Brazil ONS reservoir storage
    │   ├── GPCP rainfall after 2019
    │   ├── MERRA-2 rainfall for trends
    │   └── Two G-REALM lakes
    ├── Used in Sean's separate back-tests (not in the app)
    │   ├── GPM IMERG rainfall  [NASA]
    │   ├── SMAP root-zone soil moisture  [NASA]
    │   ├── JPL and CSR GRACE water storage  [NASA]
    │   ├── GRACE-DA groundwater and root-zone  [NASA]
    │   ├── MODIS snow cover  [NASA]
    │   ├── NMME / CFSv2 seasonal forecasts
    │   ├── Indian Ocean and Pacific climate indices (IOD, PDO)
    │   ├── Heatwave measures  [NASA]
    │   ├── NOAA CPC soil moisture
    │   └── US state hydro output (EIA)
    └── Checked, not used by anyone
        ├── SWOT lake heights  [NASA]
        └── Calibrated Black Marble  [NASA]
```

## Where the files live
Checked-in data sits under one parent, `data/reference/`, in two groups:

- `data/reference/forecast/`: the small inputs the prediction pipeline reads (`REFERENCE` in `pipeline/paths.py`). `hydro_dependent_countries_ember.csv` (the 48 countries), `kariba_grealm_10day_levels.csv` (G-REALM Kariba levels), `oni.ascii.txt` (El Niño index) and `upper_zambezi_box_gravis_tws.csv` (GRACE water storage for the Upper Zambezi box). The pipeline prefers a fresh download in `data/raw/` (not checked in) and falls back to these copies.
- `data/reference/remediation/`: the replay and plan data (`REMEDIATION` in `pipeline/paths.py`). `crisis_actions.csv` (sourced crisis stages, actions and costs) and `kariba_zra_statements.csv` (ZRA Kariba readings). See `docs/REMEDIATION-DATA.md`.

Pipeline outputs are not in either folder. They are the JSON files in `web/public/data/`, which the site reads.

## 1. Water in the ground and rivers
How much water a whole region holds, below and on the surface.

### GRACE / GRACE-FO water storage · NASA
- **What it is:** how much water is stored in a whole region's ground, rivers, lakes and snow. Two pairs of satellites weigh it by its pull of gravity.
- **Where it comes from:** the GRACE and GRACE-FO missions (NASA with German partners DLR and GFZ). The monthly grid is made by GFZ GravIS.
- **How much and how often:** monthly, April 2002 to August 2026. It runs about 3 months behind.
- **Watch out:**
  - There's no data from July 2017 to May 2018, the gap between the two missions. We leave it empty and never fill it.
  - The satellites see blobs about 300 km wide, so small basins blur into their surroundings.
- **Used for:** drying trends in hydro basins, and as a clue for the Kariba forecast.
- **Feeds:** the drying-trend map, Trend Detective page, Kariba forecast and country watchlist.

### Root-zone soil wetness · NASA
- **What it is:** how wet the soil is down to about 1 m, where plant roots drink. 0% is bone dry; 100% is fully soaked.
- **Where it comes from:** MERRA-2, a NASA weather model that is constantly corrected with observations, served by NASA POWER.
- **How much and how often:** monthly, January 1981 to September 2026.
- **Watch out:**
  - NASA POWER soil values jump suddenly from October 2026, so we stop at September 2026.
  - It is model output, read at a few points per region.
- **Used for:** a clue for the Kariba forecast and the country watchlist, and a Trend Detective variable.

### Surface soil wetness · NASA
- **What it is:** how wet the top 5 cm of soil is. It reacts within days to rain and heat.
- **Where it comes from:** MERRA-2, via NASA POWER.
- **How much and how often:** monthly, January 1981 to September 2026, stopping at September for the same October 2026 jump.
- **Used for:** a clue for the country watchlist, and a Trend Detective variable.

## 2. Water in the lakes
How high the water stands behind the dams.

### G-REALM satellite lake levels · NASA
- **What it is:** the height of a lake's surface, measured by radar satellites that pass overhead every 10 days.
- **Where it comes from:** G-REALM (NASA Goddard and the US Department of Agriculture), using the TOPEX/Poseidon, Jason-1/2/3 and Sentinel-6 satellites.
- **How much and how often:** every 10 days. Kariba runs from November 1992 to November 2026, and we cover 31 big hydro lakes in all.
- **Watch out:**
  - People set lake levels as well as rain does, through dam releases.
  - Some lakes have years with no satellite passes.
- **Used for:** the thing we forecast, at Kariba and at the other 30 lakes.
- **Feeds:** the Kariba forecast, release simulator, reservoir watch and Trend Detective page.

### Zambezi River Authority (ZRA) records
- **What it is:** the dam operator's own Kariba levels, how much water each country may use, and its press statements.
- **Where it comes from:** the Zambezi River Authority, which runs Kariba dam for Zambia and Zimbabwe.
- **How much and how often:** weekly levels, plus yearly allocations and statements.
- **Used for:**
  - turning satellite height into % usable water (the lake is usable between 475.5 m and 488.5 m);
  - the 2026 and 2027 water allowances in the simulator.

## 3. Water from the sky
Rain and heat over the river basins.

### GPCP rainfall · NASA
- **What it is:** how much rain and snow falls each month, from a blend of satellite and rain-gauge measurements.
- **Where it comes from:** GPCP v2.3 (NASA Goddard and the GEWEX science programme), served by NOAA.
- **How much and how often:** monthly, January 1979 to October 2026, on 2.5° squares (about 275 km wide at the equator).
- **Watch out:** it reads too dry after 2019 in many regions. We checked it against MERRA-2 and against Kariba's lake level. So rain trends use 2002–2019 only, and the El Niño result is re-checked on 1981–2019.
- **Used for:** the main rain record for El Niño exposure and rain trends.

### MERRA-2 rainfall · NASA
- **What it is:** monthly rainfall from the MERRA-2 NASA weather model.
- **Where it comes from:** MERRA-2, via NASA POWER.
- **How much and how often:** monthly since January 1981, plus daily data to about 3 days ago.
- **Watch out:** it has false jumps in a few places: Colombia in 2008 and 2021, and Vietnam from 2016–17.
- **Used for:** up-to-date rain for the Kariba forecast, and a cross-check on GPCP.

### Air temperature · NASA
- **What it is:** the average air temperature 2 m above the ground, the height of a weather station.
- **Where it comes from:** MERRA-2, via NASA POWER.
- **How much and how often:** monthly, January 1981 to September 2026, stopping at September for the October 2026 jump.
- **Used for:** a clue for the country watchlist, and a Trend Detective variable.

## 4. Climate drivers
El Niño and La Niña: ocean warming and cooling that shift rain around the world.

### El Niño index (ONI)
- **What it is:** how much warmer (El Niño) or cooler (La Niña) than normal the central Pacific Ocean is, averaged over 3 months.
- **Where it comes from:** the NOAA Climate Prediction Center.
- **How much and how often:** every 3-month season since 1950, to Aug–Oct 2026.
- **Watch out:** it is one global number, the same for every place. It is context, not a local measurement.
- **Used for:** labelling past years as El Niño, La Niña or neutral, and picking which past years the forecasts replay.

### Official El Niño outlook (CPC)
- **What it is:** the official monthly forecast of whether El Niño or La Niña is coming.
- **Where it comes from:** the NOAA Climate Prediction Center with IRI (Columbia University).
- **How much and how often:** a new issue every month.
- **Watch out:** Patronus doesn't forecast El Niño itself; it uses this outlook.
- **Used for:** deciding which kind of past years the live Kariba forecast replays.

### NASA GEOS-S2S seasonal forecast · NASA
- **What it is:** NASA's computer forecast of ocean temperatures and weather for the next few months.
- **Where it comes from:** GEOS-S2S version 3, from NASA's Global Modeling and Assimilation Office.
- **How much and how often:** the current monthly forecast runs.
- **Watch out:** it is shown next to our forecast but hasn't been tested on past years.
- **Used for:** a second El Niño outlook, beside the official one.

## 5. Power and people

### Ember monthly electricity data
- **What it is:** how much electricity each country's hydro plants made each month.
- **Where it comes from:** Ember, an independent energy think tank.
- **How much and how often:** monthly, from 1998 to October 2026. Most countries start between 2010 and 2019.
- **Watch out:** new dams raise output over time, so rising output can mean more dams, not more water.
- **Used for:** what the country watchlist predicts, and a Trend Detective variable.

### Ember yearly electricity data
- **What it is:** each country's yearly power from each source, hydro included.
- **Where it comes from:** Ember.
- **How much and how often:** yearly, 1985 to 2025.
- **Used for:** picking the 48 countries that get at least 30% of their power from hydro.

### Ember China province data
- **What it is:** monthly hydropower made in each Chinese province.
- **Where it comes from:** Ember.
- **How much and how often:** monthly, January 2016 to September 2026.
- **Used for:** treating Sichuan as its own grid.

### Global Power Plant Database
- **What it is:** a world list of power plants, with each plant's location and size.
- **Where it comes from:** the World Resources Institute, version 1.3.
- **How much and how often:** a single snapshot from 2021.
- **Watch out:** plants built later are missing, for example Ecuador's Coca Codo Sinclair.
- **Used for:** finding hydro plants, and weighting basins by the hydro capacity they hold.

### HydroBASINS river basins
- **What it is:** maps of the land that drains into each river, so we know which area feeds each dam.
- **Where it comes from:** HydroSHEDS (WWF and partners).
- **How much and how often:** fixed maps. We use the level-4 basins, plus level-5 to outline Kariba's catchment.
- **Used for:** the areas over which we average water storage and rain.

### Black Marble night lights · NASA
- **What it is:** satellite pictures of the Earth at night, cleaned of moonlight, showing where the lights are on.
- **Where it comes from:** NASA Black Marble (Suomi NPP VIIRS), shown through NASA GIBS imagery.
- **How much and how often:** nightly since 2012, with gaps. We use frames from February 2023 to November 2026.
- **Watch out:**
  - We use display pictures, not the calibrated data, so brightness changes are approximate.
  - Bright city centres max out the scale, which is why Ecuador shows no clear dip.
- **Used for:** showing Zambian cities dimming during the 2024 power cuts.

### Crisis dates and costs
- **News reports and official statements:** dated warnings, power cuts and recoveries, each with its own link. Used for the start date of each crisis we score against.
- **ZESCO's tariff filing** (to Zambia's Energy Regulation Board, July 2024): what imported and emergency power cost, 17–26 US cents/kWh. Used in the cost of waiting.
- **IMF statement on Zambia** (press release 24/413, November 2024): the economic damage of the 2024 drought.
- **World Bank report on Vietnam** (August 2023): the 2023 shortage cost about $1.4 billion, roughly 0.3% of GDP.

## 6. What we make from it

| Output | What it is | Made from | File |
|---|---|---|---|
| Drying-trend map | Which hydro basins are losing stored water since 2002, and whether each trend is real (Sen's slope + Mann-Kendall, FDR-corrected) | GRACE/GRACE-FO, GPCP, Power Plant Database, HydroBASINS | `trends.json` |
| Trend Detective page | Pick a place and one of 9 variables, then measure the trend and its significance live. The direct answer to the challenge | GRACE/GRACE-FO, soil wetness, G-REALM, GPCP, MERRA-2 rain and temperature, ONI, Ember monthly, HydroBASINS | `explorer/` |
| El Niño exposure | For 48 hydro-dependent countries plus Sichuan: does hydro water drop in El Niño or La Niña years, and what is the outlook? | GPCP, MERRA-2 rain, ONI, CPC outlook, GEOS-S2S, Ember yearly, Power Plant Database | `enso.json` |
| Kariba forecast | Lake Kariba's usable water each month to Dec 2027, with the chance of falling below 20% and 10%. Tested on every month since 2005 | GRACE/GRACE-FO, root-zone soil, G-REALM, ZRA, MERRA-2 rain, ONI, CPC outlook, HydroBASINS | `kariba.json` |
| Release simulator and cost of waiting | Try cutting releases from a chosen month; see the danger risk, energy lost and replacement cost | G-REALM, ZRA, ONI, ZESCO filing | `kariba_sim.json` |
| Reservoir watch | The Kariba method on 31 big hydro lakes on 4 continents | G-REALM, ONI, Power Plant Database, news | `reservoirs.json` |
| Country watchlist (experimental) | A monthly hydro-shortfall forecast for 23 countries plus Sichuan. Weak skill | GRACE/GRACE-FO, soil wetness, MERRA-2 rain and temperature, ONI, Ember monthly, yearly and China, Power Plant Database | `watchlist.json`, `countries.json` |
| Crisis scoreboard | Past crises and whether we warned before each began: hits, misses and false alarms | ONI, Ember monthly, news, IMF, World Bank | `scoreboard.json`, `crises.json` |
| Night-lights replay | Cities going dark in Zambia's and Ecuador's 2024 power cuts | Black Marble, news | `nightlights.json` |

## 7. Tried, not used

### Tested in Patronus and dropped
| Data | What it is | Why not used |
|---|---|---|
| Brazil ONS reservoir storage | Brazil grid operator's daily stored water and inflow | Made Brazil's forecasts slightly worse at 5 of 6 horizons under our pre-set test. Sean's back-test found it helped Brazil a little; the two tests are set up differently. (meta.json lists it as tested, not adopted.) |
| GPCP rainfall after 2019 | The newest years of GPCP | Reads too dry, so rain trends stop at 2019 |
| MERRA-2 rainfall for trends | NASA POWER rain as the main trend record | False jumps in some countries, so GPCP replaced it. Still used for Kariba and as a cross-check |
| Two G-REALM lakes | Garafiri (Guinea), Nam Ngum (Laos) | Garafiri is missing wet-season months; Nam Ngum's record ends in 2016 |

### Used in Sean's separate back-tests (not in the app)
Sean ran these in his own Future Detector repo, with an Earthdata login. The results are on the unmerged branches `fd/backtest-v2`, `fd/lead-time` and `fd/heatwave` (`docs/BACKTEST-FD.md`, `LEADTIME-FD.md`, `HEATWAVE-FD.md`). Nothing in the app reads them.

**Main finding:** pooled over 67 grids, these water signals add no skill beyond recent power output. Measured reservoir storage helps only in Brazil.

| Data | What it is | Result |
|---|---|---|
| GPM IMERG rainfall [NASA] | NASA's satellite rain record (Earthdata login) | No pooled gain |
| SMAP root-zone soil moisture [NASA] | A NASA satellite's estimate of soil moisture down to the roots (login) | No pooled gain; MERRA-2 soil stays the app's source |
| JPL and CSR GRACE water storage [NASA] | Other teams' versions of the GRACE/GRACE-FO gravity data | Used side by side; the app uses GFZ's version, which needs no login |
| GRACE-DA groundwater and root zone [NASA] | GRACE blended into a land model (login) | No pooled gain |
| MODIS snow cover [NASA] | Monthly snow-covered share, from NASA's Terra satellite | Small gain at 2–4 months in snow-fed grids, gone by 6; not adopted |
| NMME / CFSv2 seasonal forecasts | A US weather service's forecasts of rain, temperature and El Niño | No pooled gain; flagged Brazil 2021 at 3 months instead of 1 |
| IOD and PDO climate indices | Slow ocean patterns that shift rain | No gain |
| Heatwave measures [NASA] | Daily hottest temperature, heatwave days and cooling demand (NASA POWER) | No skill; Sichuan 2022 still missed |
| NOAA CPC soil moisture | A US soil-moisture model record | In the first back-test version only |
| US state hydro output (EIA) | Monthly hydropower from 10 US states | Extra test grids only |

### Checked, not used by anyone
| Data | What it is | Why not used |
|---|---|---|
| SWOT lake heights [NASA] | A new satellite mapping lake heights in detail | Starts in July 2023, too late to learn from past crises; a next step after the hackathon |
| Calibrated Black Marble [NASA] | Measured night-light values | Needs a login; display pictures stand in |

**Pitch note:** if Sean's branches are merged, these NASA datasets count as "tested and documented", which is worth a line under Validity. List IMERG, SMAP, the JPL mascons, GRACE-DA and MODIS snow in the References field too.

## Words used here
- **Sen's slope:** the typical rise or fall per decade: the middle value of the slopes between every pair of points. Outliers barely move it.
- **Mann-Kendall test:** a test for whether a trend is real or just noise.
- **FDR correction:** when you test hundreds of places at once, some look significant by luck. This keeps those false hits rare.
- **Reanalysis / weather model (MERRA-2):** a computer weather model constantly corrected with real observations, so it fills the gaps between them.
- **Usable storage:** the water in Kariba above the lowest level the turbines can use (475.5 m).
