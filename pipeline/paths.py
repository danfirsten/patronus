"""Shared paths for the Patronus pipeline."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"            # downloaded source data (gitignored)
CACHE = ROOT / "data" / "cache"        # API caches (gitignored)
REFERENCE = ROOT / "data" / "reference" / "forecast"  # checked-in inputs the forecast pipeline reads
REMEDIATION = ROOT / "data" / "reference" / "remediation"  # crisis actions, costs, ZRA readings
OUT = ROOT / "web" / "public" / "data"   # JSON consumed by the web app

for p in (CACHE, OUT):
    p.mkdir(parents=True, exist_ok=True)

ISSUE_DATE = "2026-11-15"   # the date the live forecast is issued
