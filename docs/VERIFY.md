# How to verify a Patronus forecast

Patronus publishes its forecasts as plain JSON files in `web/public/data/`. Each file is
fingerprinted (SHA-256) and the fingerprints are timestamped, so anyone can check later
that a forecast existed, unchanged, on the date we claim. Nobody has to trust us.

There are three layers of proof:

1. **SHA-256 hash.** `web/public/data/ledger.json` lists every published file with its
   hash and the time it was logged (`logged_at`, UTC).
2. **OpenTimestamps.** The new hashes from each ledger run go into one manifest,
   `web/public/ledger/manifest-<UTC time>.txt`. That manifest is stamped with
   [OpenTimestamps](https://opentimestamps.org), which anchors it in the Bitcoin
   blockchain through free public calendar servers (no account, no key). The proof sits
   next to it as `manifest-<UTC time>.txt.ots`.
3. **Git history (fallback).** Every data file, manifest and `.ots` proof is committed to
   the public repository. The commit time is a weaker proof, because commit dates can be
   set by hand, but a commit pushed to GitHub (with its push events) is still hard to
   backdate quietly. If an entry in `ledger.json` has `"ots": null`, the calendar servers
   could not be reached at that moment and git is the only proof for that entry.

## 1. Check that a file matches the ledger

From the repository root:

```bash
sha256sum web/public/data/kariba.json
```

Compare the output with the `sha256` of the `kariba.json` entry in
`web/public/data/ledger.json`. Each entry also has a ready-made `verify` command.

To check every file in a manifest at once:

```bash
sha256sum -c web/public/ledger/manifest-20261114T200430Z.txt
```

Every line should end in `OK`. (On macOS use `shasum -a 256` and `shasum -a 256 -c`.)

You can also check a file straight from the live site, without cloning:

```bash
curl -s https://<site>/data/kariba.json | sha256sum
```

## 2. Check the OpenTimestamps proof

Install the client (Python 3, no key needed):

```bash
pip install opentimestamps-client
```

Then, from the repository root:

```bash
ots upgrade web/public/ledger/manifest-20261114T200430Z.txt.ots   # fetch the Bitcoin attestation, once available
ots verify  web/public/ledger/manifest-20261114T200430Z.txt.ots   # checks it against the manifest next to it
```

- Right after stamping, the proof is **pending**: the calendars have promised to include it
  in a Bitcoin block. That normally happens within a few hours. Until then, `ots verify`
  reports it as pending, and `ots info <file>.ots` shows which calendars hold it.
- After `ots upgrade`, the proof is self-contained. `ots verify` prints
  `Success! Bitcoin block <height> attests existence as of <date>`. That date is the
  latest moment the manifest, and so every hash in it, could have been created.
- The command-line `ots verify` checks the Bitcoin block itself, so it needs access to a
  Bitcoin node (a pruned node is enough; see `--bitcoin-node`). Without one, drop the
  manifest and its `.ots` file on <https://opentimestamps.org>, which verifies in the
  browser against public block explorers. `ots info <file>.ots` also prints the block
  height and the Merkle root it commits to, which you can compare on any block explorer.
- `pipeline/ledger.py` runs `ots upgrade` on pending proofs every time it runs and records
  `ots_status` (`pending` or `bitcoin_confirmed`) for each manifest in `ledger.json`.

## 3. Put it together

A forecast is proven to have existed, unchanged, by time T when:

1. `sha256sum` of the forecast file equals the hash in a manifest line;
2. `sha256sum -c` of that manifest passes (the manifest itself was not edited); and
3. `ots verify` on the manifest's `.ots` succeeds with a Bitcoin block dated T.

Then compare the forecast with what actually happened. For Lake Kariba, that means ZRA's
published lake levels against the probabilities in `kariba.json`.

## What the ledger cannot prove

- It proves **when** a file existed, not that the forecast is any good. Skill is shown on
  the backtest scoreboard.
- It does not stop us publishing many forecasts and showing only the good one. To guard
  against that, the ledger is append-only: changed files get new entries, and the old
  entries move to `history` with a `superseded_at` time, so every earlier version stays
  listed.
- If a manifest's `ots` is `null`, only the git commit time backs it.

## Maintainers: updating the ledger

Run this after all data files are final:

```bash
python3 -m pipeline.ledger
```

Files whose hash has not changed keep their original entry and proof. New or changed
files go into a new manifest, which is stamped. Commit `web/public/data/ledger.json` and
`web/public/ledger/` together with the data files.
