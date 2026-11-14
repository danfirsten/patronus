"""Build scoreboard.json: one row per crisis, joining both horizons' backtests.

- now model: country generation model (generation_backtest.json crisis_leads) or, for Kariba,
  the lake-level ML model (kariba.json backtest.crisis_2024.now_model).
- next model: the El Nino-conditioned water-balance ensemble (Kariba only so far), and for the
  other crises a plain statement of what the ENSO layer knew (exposure + ONI at the time).

Run after generation, kariba, enso and crises: `python3 -m pipeline.scoreboard`.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pandas as pd

from pipeline.paths import OUT, RAW


def _load(name: str):
    p = OUT / name
    return json.loads(p.read_text()) if p.exists() else {}


def _months(a, b):
    if not a or not b:
        return None
    return int((pd.Period(b[:7], "M") - pd.Period(a[:7], "M")).n)


def _oni() -> dict:
    """ONI by (season, year) -> value, from the raw NOAA table."""
    out = {}
    for line in (RAW / "oni.ascii.txt").read_text().splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 4:
            out[(parts[0], int(parts[1]))] = float(parts[3])
    return out


def main() -> None:
    crises = _load("crises.json")["crises"]
    gen = _load("generation_backtest.json")
    kar = _load("kariba.json")
    enso = _load("enso.json")
    exposure = {c["iso3"]: c for c in enso.get("countries", [])}
    oni = _oni()
    leads = {c["id"]: c for c in gen.get("crisis_leads", [])}

    rows = []
    for c in crises:
        cid = c["id"]
        warn = (c.get("official_warning") or {}).get("date")
        onset = c["onset"]["date"]
        row = {"id": cid, "name": c["name"], "countries": c["countries"], "enso": c["enso"],
               "official_warning": warn, "onset": onset}

        if cid == "kariba-2024":
            k = kar["backtest"]["crisis_2024"]
            now = k.get("now_model") or {}
            row["now_alarm"] = now.get("first_warning_p_gt_0_5")
            row["now_model"] = "Lake-level ML model (strictly forward test)"
            row["next_alarm"] = k.get("first_warning_p_gt_0_5")
            row["next_model"] = "El Nino water-balance ensemble (strictly forward, ENSO state known at the time)"
            row["notes"] = ("Ensemble first alarm Jul 2023 came from low storage under a neutral ONI; "
                            "El Nino analogs used from Aug 2023, P(below 20%) = 0.8 in Oct-Dec 2023. "
                            "The ML model expected the usual rainy-season recovery and fired only in Mar 2024.")
            row["onset_for_lead"] = onset
            parts = [("now", row["now_alarm"]), ("next", row["next_alarm"])]
        else:
            # Ecuador's crisis has two generation-model entries; the first wave is the onset here,
            # the later waves are reported in notes.
            gid = {"ecuador-2023-24": "ecuador-2023"}.get(cid, cid)
            g = leads.get(gid, {})
            row["now_alarm"] = g.get("alarm_month")
            row["now_model"] = "Country monthly generation model (blocked leave-one-year-out test)"
            iso = c["countries"][0]
            e = exposure.get(iso, {})
            # What the ENSO layer knew 6 months before onset.
            y, m = int(onset[:4]), int(onset[5:7])
            pm = pd.Period(onset[:7], "M") - 6
            seasons = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"]
            # season ending in month pm.month is centred one month earlier
            sname = seasons[(pm.month - 2) % 12]
            syear = pm.year if pm.month != 1 else pm.year - 1
            o = oni.get((sname, syear))
            row["next_alarm"] = None
            row["next_model"] = "El Nino layer (exposure x ENSO state); no reservoir ensemble for this grid yet"
            row["enso_exposure"] = e.get("exposure")
            row["oni_6m_before_onset"] = {"season": f"{sname} {syear}", "value": o}
            note = []
            if g.get("status"):
                note.append(f"Country model: {g['status']}.")
            if e.get("exposure"):
                note.append(f"ENSO layer classifies {iso} as '{e['exposure']}'.")
            if cid == "ecuador-2023-24":
                extra = [leads.get("ecuador-2024-apr", {}), leads.get("ecuador-2024-sep", {})]
                st = [x.get("status") for x in extra if x]
                if st:
                    note.append("Later 2024 waves: " + ", ".join(st) + ".")
            row["notes"] = " ".join(note) or None
            row["onset_for_lead"] = onset
            parts = [("now", row["now_alarm"]), ("next", None)]

        hit = [(name, a) for name, a in parts if a and _months(a, onset) is not None and _months(a, onset) >= 1]  # same-month alarms are not warnings
        row["caught_by"] = ("both" if len(hit) == 2 else hit[0][0]) if hit else "missed"
        best = min((a for _, a in hit), default=None)
        row["patronus_alarm"] = best
        row["lead_months"] = _months(best, onset) if best else None
        row["lead_vs_official_months"] = _months(best, warn) if (best and warn) else None
        row.pop("onset_for_lead", None)
        rows.append(row)

    alarm = gen.get("alarm") or {}
    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": ["ember_monthly", "ember_china", "grealm", "gravis", "gpcp", "power", "oni", "news"],
        "rows": rows,
        "summary": {
            "n_crises": len(rows),
            "n_caught": sum(r["caught_by"] != "missed" for r in rows),
            "headline": ("Kariba 2024 was flagged in Jul 2023 by the El Nino reservoir model, 5 months before the official "
                         "water cut; the country monthly model caught 1 of 5 other crises (Vietnam 2023). Short-range "
                         "monthly country forecasts have little skill; the early warning comes from reservoir storage "
                         "and the El Nino signal."),
        },
        "false_alarms": {
            "country_model": {k: alarm.get(k) for k in ("threshold", "threshold_rule", "false_alarms_per_country_5yr",
                                                        "hit_rate_any6") if k in alarm} or None,
            "kariba_next_model_warning": ((kar.get("backtest", {}).get("next_model") or {}).get("score") or {}).get("warning"),
            "kariba_next_model_definition": "Seasons Oct-Dec 1995-2025; alarm = P(below 20%) > 0.5 on any Oct-Dec issue; event = below 20% at any point Apr-Dec of the following year.",
        },
        "notes": [
            "lead_months = months from the first Patronus alarm (either model) to crisis onset.",
            "lead_vs_official_months is positive when Patronus fired before the first official warning.",
            "The country model's alarm threshold was chosen on the same out-of-fold predictions used to measure "
            "leads, so its catches are optimistic.",
        ],
    }
    (OUT / "scoreboard.json").write_text(json.dumps(out, indent=1, default=str))
    for r in rows:
        print(r["name"], "| now:", r["now_alarm"], "| next:", r["next_alarm"], "|", r["caught_by"], "| lead", r["lead_months"],
              "| vs official", r["lead_vs_official_months"])


if __name__ == "__main__":
    main()
