"""Run the whole Patronus pipeline in order: `python3 -m pipeline.run_all`.

Order matters: basins -> (trends, enso, generation, kariba) -> crises -> scoreboard -> nightlights -> meta -> ledger (last).
"""
import importlib
import time

STEPS = ["basins", "trends", "enso", "generation", "kariba", "kariba_sim", "crises", "scoreboard", "nightlights", "meta", "ledger"]

if __name__ == "__main__":
    for s in STEPS:
        t = time.time()
        print(f"== {s}")
        importlib.import_module(f"pipeline.{s}").main() if hasattr(importlib.import_module(f"pipeline.{s}"), "main") \
            else importlib.import_module(f"pipeline.{s}").build()
        print(f"   {time.time() - t:.0f}s")
