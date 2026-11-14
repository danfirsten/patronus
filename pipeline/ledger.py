"""Hashed, timestamped ledger of the published data files -> web/public/data/ledger.json.

Run from the repo root:  python3 -m pipeline.ledger

1. SHA-256 every web/public/data/*.json, web/public/data/country/*.json and
   basins.geojson (ledger.json itself is skipped).
2. Files whose hash is already in the ledger keep their original entry (and so their
   original logged_at and proof). New or changed files get a new entry; the entry
   they replace moves to "history", so nothing is ever deleted.
3. All new hashes are written to one manifest, web/public/ledger/manifest-<UTC>.txt,
   in `sha256sum` format, and that manifest is stamped with OpenTimestamps
   (`ots stamp`, no account or key). Each new entry records the manifest's .ots path.
4. Pending .ots proofs from earlier runs are upgraded (`ots upgrade`) once the
   Bitcoin attestation is available (a few hours after stamping).

If OpenTimestamps is not installed or its calendars cannot be reached, entries get
"ots": null and a note; the public git commit time is then the fallback proof.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import shutil
import subprocess

from pipeline.paths import OUT, ROOT

PUBLIC = ROOT / "web" / "public"
LEDGER_DIR = PUBLIC / "ledger"
LEDGER_JSON = OUT / "ledger.json"

# Files the contracts promise; reported as missing if absent so the gap is visible.
EXPECTED = ["meta.json", "countries.json", "basins.geojson", "trends.json", "enso.json", "watchlist.json",
            "generation_backtest.json", "kariba.json", "crises.json", "scoreboard.json", "nightlights.json"]


def sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def collect() -> list:
    files = sorted(OUT.glob("*.json")) + sorted((OUT / "country").glob("*.json"))
    for cand in (OUT / "basins.geojson", PUBLIC / "basins.geojson"):
        if cand.exists():
            files.append(cand)
            break
    return [f for f in files if f.name != "ledger.json"]


def rel_data(p) -> str:
    """Path as the contract writes it: relative to web/public/data when inside it."""
    try:
        return p.relative_to(OUT).as_posix()
    except ValueError:
        return p.relative_to(PUBLIC).as_posix()


def run(cmd: list[str], timeout: int = 120) -> tuple[int, str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=ROOT)
        return r.returncode, (r.stdout + r.stderr).strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return 1, str(e)


def ots_status(ots_path) -> str:
    code, out = run(["ots", "info", str(ots_path)], timeout=30)
    if code != 0:
        return "unknown"
    return "bitcoin_confirmed" if "BitcoinBlockHeaderAttestation" in out else "pending"


def main() -> None:
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    now_iso = now.isoformat().replace("+00:00", "Z")
    LEDGER_DIR.mkdir(parents=True, exist_ok=True)

    old = {}
    if LEDGER_JSON.exists():
        try:
            old = json.loads(LEDGER_JSON.read_text())
        except json.JSONDecodeError:
            old = {}
    entries = {e["file"]: e for e in old.get("entries", [])}
    history = list(old.get("history", []))
    manifests = list(old.get("manifests", []))
    notes: list[str] = []

    files = collect()
    present = {rel_data(f) for f in files}
    current, new = [], []
    for f in files:
        name = rel_data(f)
        digest = sha256(f)
        prev = entries.get(name)
        if prev and prev["sha256"] == digest:
            current.append(prev)
            continue
        if prev:
            history.append({**prev, "superseded_at": now_iso})
        e = {
            "file": name,
            "path": f.relative_to(ROOT).as_posix(),
            "sha256": digest,
            "bytes": f.stat().st_size,
            "logged_at": now_iso,
            "manifest": None,
            "ots": None,
            "verify": f"sha256sum {f.relative_to(ROOT).as_posix()}",
        }
        current.append(e)
        new.append(e)
    # Files that disappeared keep a history record.
    for name, e in entries.items():
        if name not in present:
            history.append({**e, "superseded_at": now_iso, "reason": "file no longer present"})

    if new:
        stamp = now.strftime("%Y%m%dT%H%M%SZ")
        manifest = LEDGER_DIR / f"manifest-{stamp}.txt"
        lines = [f"{e['sha256']}  {e['path']}" for e in sorted(new, key=lambda x: x["path"])]
        manifest.write_text("\n".join(lines) + "\n")
        mrel = manifest.relative_to(PUBLIC).as_posix()
        mrec = {"manifest": mrel, "sha256": sha256(manifest), "created_at": now_iso, "n_files": len(new),
                "ots": None, "ots_status": None,
                "verify": f"sha256sum -c web/public/{mrel}"}  # run from the repo root
        if shutil.which("ots") is None:
            notes.append("OpenTimestamps client (ots) not installed: proofs not created; git commit time is the fallback proof.")
        else:
            code, out = run(["ots", "stamp", str(manifest)])
            ots_file = manifest.with_name(manifest.name + ".ots")
            if code == 0 and ots_file.exists():
                mrec["ots"] = ots_file.relative_to(PUBLIC).as_posix()
                mrec["ots_status"] = "pending"
                mrec["ots_calendars"] = [ln.split()[-1] for ln in out.splitlines() if "calendar" in ln]
                mrec["ots_verify"] = f"ots verify web/public/{mrec['ots']}"
            else:
                notes.append("OpenTimestamps calendars unreachable from this machine at "
                             f"{now_iso} ({out[-200:]}); ots is null and the git commit time is the fallback proof.")
        for e in new:
            e["manifest"] = mrel
            e["ots"] = mrec["ots"]
        manifests.append(mrec)

    # Try to upgrade earlier pending proofs to full Bitcoin attestations.
    if shutil.which("ots"):
        for m in manifests:
            if m.get("ots") and m.get("ots_status") != "bitcoin_confirmed":
                run(["ots", "upgrade", str(PUBLIC / m["ots"])], timeout=60)
                bak = PUBLIC / (m["ots"] + ".bak")
                if bak.exists():
                    bak.unlink()  # ots upgrade keeps a .bak of the pending proof; the upgraded file supersedes it
                m["ots_status"] = ots_status(PUBLIC / m["ots"])

    missing = [f for f in EXPECTED if f not in present and not (f == "basins.geojson" and "basins.geojson" in present)]
    if missing:
        notes.append("Not yet present when the ledger ran (not hashed): " + ", ".join(missing) + ".")

    doc = {
        "generated_at": now_iso,
        "sources": [],
        "method": ("SHA-256 of each published data file. New or changed hashes are listed in a manifest "
                   "(web/public/ledger/manifest-<UTC>.txt, sha256sum format) that is stamped with OpenTimestamps, "
                   "which anchors it in the Bitcoin blockchain via public calendar servers. Unchanged files keep "
                   "their original entry; replaced entries move to history. See docs/VERIFY.md."),
        "fallback_proof": "The public git commit that adds each file and manifest.",
        "notes": notes,
        "entries": sorted(current, key=lambda e: e["file"]),
        "manifests": manifests,
        "history": history,
    }
    LEDGER_JSON.write_text(json.dumps(doc, indent=1))
    print(f"ledger: {len(current)} files, {len(new)} new/changed, {len(missing)} expected files missing")
    for m in manifests[-1:]:
        print(f"latest manifest {m['manifest']} ots={m['ots']} status={m.get('ots_status')}")
    for n in notes:
        print("note:", n)


if __name__ == "__main__":
    main()
