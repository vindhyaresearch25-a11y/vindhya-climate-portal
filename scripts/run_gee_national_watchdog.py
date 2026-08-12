"""
run_gee_national_watchdog.py -- keeps a national GEE fetch script running
unattended across multi-day national coverage, restarting it if it stalls.
Originally built for 08_gee_national_climate.py; generalized 2026-08-12
(--script/--heartbeat flags, both default to the original climate script's
paths for backward compatibility) to reuse the same watchdog for
10_gee_national_ndvi.py and 13_gee_national_soil_moisture.py, which follow
the identical contract: `--stage run --resume [--states ...]` CLI, and a
heartbeat JSON overwritten on every district event with a
`total_written_this_run` field.

Built 2026-08-07 after the running fetch hung for ~18 hours undetected: a
GEE getInfo() call's underlying HTTP request never returned (no per-request
deadline was set at the time -- see ee.data.setDeadline() now called in
08_gee_national_climate.py's gee_init(), the actual root-cause fix). This
watchdog is the second layer, not a replacement for that fix: even with a
90s per-request deadline, some other unforeseen hang (a library bug, a
network partition that doesn't even attempt a TCP RST, GEE-side outage)
could still stop progress without crashing the process -- this catches
that by watching for heartbeat staleness, not by trying to enumerate every
possible hang cause in advance.

How it decides something is stuck: 08_gee_national_climate.py overwrites
logs/gee_national_heartbeat.json on every district event (started/done/
error/skipped). If HEARTBEAT_STALE_SECONDS pass with no update while the
child process is still alive, that process is killed (SIGTERM, then
SIGKILL if it doesn't exit within 10s) and restarted with --resume --
which is safe by construction (each district's own output file is the
completion marker; --resume skips any district whose file already
exists, so a restart never redoes real work, only picks up where the
killed run left off).

Stops when a full pass across the given --states scope processes zero
districts that weren't already resumed (i.e. genuinely nothing left to
do) -- not just "the process exited 0", since resume-skip-everything and
resume-actually-finished both exit 0 the same way; this script tells
them apart by comparing the heartbeat's total_written_this_run to 0 for
an entire completed pass, run twice in a row (avoids declaring victory on
a fluke empty state-filter pass).

Usage:
  python scripts/run_gee_national_watchdog.py                       # climate, all states
  python scripts/run_gee_national_watchdog.py --states "Uttar Pradesh,Bihar"
  python scripts/run_gee_national_watchdog.py --script 10_gee_national_ndvi.py \\
      --heartbeat gee_ndvi_heartbeat.json --log-prefix gee_ndvi_run_attempt
  python scripts/run_gee_national_watchdog.py --script 13_gee_national_soil_moisture.py \\
      --heartbeat gee_soil_moisture_heartbeat.json --log-prefix gee_soil_moisture_run_attempt
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUN_LOG_DIR = ROOT / "logs"

HEARTBEAT_STALE_SECONDS = 15 * 60
POLL_SECONDS = 60


def read_heartbeat(heartbeat_path: Path) -> dict | None:
    if not heartbeat_path.exists():
        return None
    try:
        return json.loads(heartbeat_path.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def heartbeat_age_seconds(heartbeat_path: Path) -> float | None:
    hb = read_heartbeat(heartbeat_path)
    if not hb:
        return None
    ts = datetime.fromisoformat(hb["timestamp_utc"])
    return (datetime.now(timezone.utc) - ts).total_seconds()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--states", default=None)
    ap.add_argument("--script", default="08_gee_national_climate.py",
                     help="national fetch script filename in scripts/ (default: 08_gee_national_climate.py)")
    ap.add_argument("--heartbeat", default="gee_national_heartbeat.json",
                     help="heartbeat filename under logs/ (default: gee_national_heartbeat.json)")
    ap.add_argument("--log-prefix", default="gee_national_run_attempt",
                     help="prefix for per-attempt log files under logs/ (default: gee_national_run_attempt)")
    args = ap.parse_args()

    script_path = Path(__file__).resolve().parent / args.script
    heartbeat_path = RUN_LOG_DIR / args.heartbeat

    RUN_LOG_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [sys.executable, str(script_path), "--stage", "run", "--resume"]
    if args.states:
        cmd += ["--states", args.states]

    empty_passes = 0
    attempt = 0
    while True:
        attempt += 1
        log_path = RUN_LOG_DIR / f"{args.log_prefix}{attempt}.log"
        print(f"[watchdog] attempt {attempt}: launching {' '.join(cmd)} -> {log_path}")
        with open(log_path, "w") as logf:
            proc = subprocess.Popen(cmd, stdout=logf, stderr=subprocess.STDOUT, cwd=str(script_path.parent))

        run_start_written = None  # total_written_this_run value at this attempt's most recent heartbeat
        while True:
            time.sleep(POLL_SECONDS)
            exit_code = proc.poll()
            age = heartbeat_age_seconds(heartbeat_path)
            hb = read_heartbeat(heartbeat_path)
            if hb is not None:
                run_start_written = hb.get("total_written_this_run")

            if exit_code is not None:
                print(f"[watchdog] attempt {attempt}: process exited with code {exit_code}, "
                      f"total_written_this_run={run_start_written}")
                if run_start_written == 0:
                    empty_passes += 1
                    print(f"[watchdog] empty pass #{empty_passes} (nothing new to do this attempt)")
                    if empty_passes >= 2:
                        print("[watchdog] two consecutive empty passes -- national coverage appears complete. Stopping.")
                        return 0
                else:
                    empty_passes = 0
                break  # restart (or, if truly done, the outer loop's next attempt will confirm)

            if age is not None and age > HEARTBEAT_STALE_SECONDS:
                print(f"[watchdog] heartbeat stale for {age:.0f}s (> {HEARTBEAT_STALE_SECONDS}s) -- "
                      f"process still running (pid {proc.pid}) but stuck. Killing.")
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    print("[watchdog] SIGTERM didn't stop it within 10s, sending SIGKILL")
                    proc.kill()
                    proc.wait(timeout=10)
                empty_passes = 0  # a stall isn't evidence of "nothing left to do"
                break  # restart

        time.sleep(2)  # let the OS release the log file handle before the next attempt opens it


if __name__ == "__main__":
    raise SystemExit(main())
