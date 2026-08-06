"""
hf_upload_boundaries.py — one-time migration of dashboard/data/boundaries/
and dashboard/data/village_profiles/ to the Hugging Face Datasets repo
vindhyaresearch/vindhya-climate (owner decision 2026-08-06, replacing the
earlier R2 plan -- see docs/DATA_SOURCES.md "Hugging Face migration").

Uploads state-by-state (or per top-level chunk) and prints progress after
each, per owner instruction. Does NOT delete anything from the local repo
-- that only happens after the owner has seen a live screenshot of the
dashboard rendering from the HF-hosted copy (step 3/4 of the instruction).

Requires HF_TOKEN in the environment (set in ~/.zprofile on this machine,
never hardcoded here, never logged).

Usage:
    python scripts/hf_upload_boundaries.py --target boundaries
    python scripts/hf_upload_boundaries.py --target village_profiles
    python scripts/hf_upload_boundaries.py --target both
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parent.parent
REPO_ID = "vindhyaresearch/vindhya-climate"
REPO_TYPE = "dataset"


def get_api() -> HfApi:
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit("HF_TOKEN not set in this shell's environment. "
                          "It lives in ~/.zprofile on this machine -- run "
                          "`source ~/.zprofile` before this script, or make "
                          "sure your shell already has it exported.")
    return HfApi(token=token)


def upload_boundaries(api: HfApi):
    base = ROOT / "dashboard" / "data" / "boundaries"

    # 1. Top-level files (small)
    print("[boundaries] top-level files (states.geojson, districts.geojson, "
          "_manifest.json, README.md)...")
    t0 = time.time()
    api.upload_folder(
        repo_id=REPO_ID, repo_type=REPO_TYPE,
        folder_path=str(base / "soi"),
        path_in_repo="boundaries/soi",
        allow_patterns=["*.geojson", "*.json", "*.md"],
        commit_message="boundaries: top-level SoI files (states, districts, manifest)",
    )
    print(f"  done in {time.time() - t0:.0f}s")

    # 2. legacy/ (small, kept per CLAUDE.md -- "never deleted, never rendered")
    legacy = base / "legacy"
    if legacy.exists():
        print("[boundaries] legacy/ (superseded, kept for record only)...")
        t0 = time.time()
        api.upload_folder(
            repo_id=REPO_ID, repo_type=REPO_TYPE,
            folder_path=str(legacy), path_in_repo="boundaries/legacy",
            commit_message="boundaries: legacy (superseded) village files",
        )
        print(f"  done in {time.time() - t0:.0f}s")

    # 3. blocks/<state>.geojson -- one file per state, progress per state
    blocks_dir = base / "soi" / "blocks"
    block_files = sorted(blocks_dir.glob("*.geojson"))
    print(f"[boundaries] blocks/: {len(block_files)} state files")
    for i, f in enumerate(block_files, 1):
        t0 = time.time()
        size_mb = f.stat().st_size / 1e6
        api.upload_file(
            repo_id=REPO_ID, repo_type=REPO_TYPE,
            path_or_fileobj=str(f), path_in_repo=f"boundaries/soi/blocks/{f.name}",
            commit_message=f"boundaries: blocks/{f.name}",
        )
        print(f"  [{i}/{len(block_files)}] {f.name} ({size_mb:.1f} MB) "
              f"in {time.time() - t0:.1f}s")

    # 4. villages/<state>/ -- one upload_folder call per state, progress per state
    villages_dir = base / "soi" / "villages"
    state_dirs = sorted(d for d in villages_dir.iterdir() if d.is_dir())
    print(f"[boundaries] villages/: {len(state_dirs)} states")
    for i, sd in enumerate(state_dirs, 1):
        t0 = time.time()
        files = list(sd.glob("*.geojson"))
        size_mb = sum(f.stat().st_size for f in files) / 1e6
        api.upload_folder(
            repo_id=REPO_ID, repo_type=REPO_TYPE,
            folder_path=str(sd), path_in_repo=f"boundaries/soi/villages/{sd.name}",
            commit_message=f"boundaries: villages/{sd.name} ({len(files)} districts)",
        )
        print(f"  [{i}/{len(state_dirs)}] {sd.name}: {len(files)} district files, "
              f"{size_mb:.1f} MB, {time.time() - t0:.0f}s")


def upload_village_profiles(api: HfApi):
    base = ROOT / "dashboard" / "data" / "village_profiles"
    state_dirs = sorted(d for d in base.iterdir() if d.is_dir())
    print(f"[village_profiles] {len(state_dirs)} states")
    for i, sd in enumerate(state_dirs, 1):
        t0 = time.time()
        files = list(sd.glob("*.json"))
        size_mb = sum(f.stat().st_size for f in files) / 1e6
        api.upload_folder(
            repo_id=REPO_ID, repo_type=REPO_TYPE,
            folder_path=str(sd), path_in_repo=f"village_profiles/{sd.name}",
            commit_message=f"village_profiles: {sd.name} ({len(files)} districts)",
        )
        print(f"  [{i}/{len(state_dirs)}] {sd.name}: {len(files)} district files, "
              f"{size_mb:.1f} MB, {time.time() - t0:.0f}s")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=["boundaries", "village_profiles", "both"],
                     required=True)
    args = ap.parse_args()
    api = get_api()
    if args.target in ("boundaries", "both"):
        upload_boundaries(api)
    if args.target in ("village_profiles", "both"):
        upload_village_profiles(api)
    print("\nDone. Nothing deleted locally -- verify the live dashboard renders "
          "from the HF-hosted copy before removing anything (step 3/4).")
