"""Build scoreboard.json from the backtest outputs (generation_backtest.json, kariba.json) and crises.json.

Run after generation, kariba and crises: `python3 -m pipeline.scoreboard`.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pandas as pd

from pipeline.paths import OUT


def _load(name: str):
    p = OUT / name
    return json.loads(p.read_text()) if p.exists() else None


def _months_between(a: str | None, b: str | None):
    if not a or not b:
        return None
    pa, pb = pd.Period(a[:7], "M"), pd.Period(b[:7], "M")
    return int((pb - pa).n)


def main() -> None:
    crises = _load("crises.json")
    gen = _load("generation_backtest.json") or {}
    kar = _load("kariba.json") or {}
    leads = {c.get("crisis_id") or c.get("id"): c for c in gen.get("crisis_leads", [])}

    rows = []
    for c in crises["crises"]:
        cid = c["id"]
        warn = (c.get("official_warning") or {}).get("date")
        onset = c["onset"]["date"]
        alarm, caught_by, note = None, "missed", None
        if cid == "kariba-2024":
            k = (kar.get("backtest") or {}).get("crisis_2024") or {}
            alarm = k.get("first_warning_p_gt_0_5") or k.get("first_danger_p_gt_0_5")
            note = "Lake-level model (satellite altimetry), strictly forward test"
        else:
            # Ecuador has two entries in the generation backtest; use the first wave for onset matching.
            match = leads.get(cid) or leads.get(cid.replace("-24", "")) or next(
                (v for k, v in leads.items() if k and k.startswith(cid.split("-")[0])), None)
            if match:
                alarm = match.get("alarm_month")
                note = "Country hydro-generation model, blocked leave-one-year-out test"
        lead = _months_between(alarm, onset)
        lead_vs_official = _months_between(alarm, warn)
        if alarm and lead is not None and lead >= 0:
            caught_by = "now"
        rows.append({
            "id": cid, "name": c["name"], "countries": c["countries"], "enso": c["enso"],
            "official_warning": warn, "onset": onset,
            "patronus_alarm": alarm, "lead_months": lead if (lead is not None and lead >= 0) else None,
            "lead_vs_official_months": lead_vs_official,
            "caught_by": caught_by, "notes": note,
        })

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": ["ember_monthly", "grealm", "gravis", "power", "oni", "news"],
        "rows": rows,
        "false_alarms": gen.get("false_alarms") or {"per_country_5yr": None,
                                                     "definition": "See generation_backtest.json"},
        "notes": ["'lead_months' is months from the first Patronus alarm to the crisis onset; "
                  "'lead_vs_official_months' is positive when Patronus fired before the first official warning."],
    }
    (OUT / "scoreboard.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
