# data/reference

- `forecast/`: small checked-in inputs the prediction pipeline reads (`pipeline/paths.py` `REFERENCE`): Ember hydro-dependent countries, Kariba G-REALM levels, NOAA ONI, Upper Zambezi GRACE (GRAVIS) box.
- `remediation/`: sourced crisis actions, costs and ZRA Kariba readings for the replay and plan views (`pipeline/paths.py` `REMEDIATION`). See `docs/REMEDIATION-DATA.md`.

Pipeline outputs are not here: they are written to `web/public/data/`, which the site reads.
