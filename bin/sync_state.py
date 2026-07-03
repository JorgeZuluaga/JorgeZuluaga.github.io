#!/usr/bin/env python3
"""Read/write cv-data-sync state (.secrets/cv-data-sync-state.json)."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_STATE_PATH = Path("info/sync-state.json")
LEGACY_STATE_PATH = Path(".secrets/cv-data-sync-state.json")


def resolve_state_path() -> Path:
    raw = os.environ.get("SYNC_STATE_FILE", "").strip()
    if raw:
        return Path(raw)
    if not DEFAULT_STATE_PATH.exists() and LEGACY_STATE_PATH.exists():
        DEFAULT_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(LEGACY_STATE_PATH, DEFAULT_STATE_PATH)
    return DEFAULT_STATE_PATH


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def default_state() -> dict[str, Any]:
    return {
        "updatedAt": "",
        "lastAttemptAt": "",
        "lastAttemptSource": "",
        "lastDailyGoodreadsSuccessAt": "",
        "lastPeriodicSyncSuccessAt": "",
        "lastGitCommitAt": "",
        "lastGitCommitSha": "",
        "lastFailureAt": "",
        "lastFailureReason": "",
        "lastFailureStep": "",
        "consecutiveFailures": 0,
        "lastAttemptNumber": 0,
        "lastAttemptMax": 0,
        "autoRuns": [],
    }


def load_state(path: Path | None = None) -> dict[str, Any]:
    state_path = path or resolve_state_path()
    if not state_path.exists():
        return default_state()
    try:
        with state_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return default_state()
    if not isinstance(data, dict):
        return default_state()
    merged = default_state()
    merged.update(data)
    return merged


def save_state(state: dict[str, Any], path: Path | None = None) -> None:
    state_path = path or resolve_state_path()
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state["updatedAt"] = utc_now()
    with state_path.open("w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
        f.write("\n")


def merge_state(path: Path | None = None, **fields: Any) -> dict[str, Any]:
    state_path = path or resolve_state_path()
    state = load_state(state_path)
    state.update({k: v for k, v in fields.items() if v is not None})
    save_state(state, state_path)
    return state


def cmd_set(args: argparse.Namespace) -> int:
    path = Path(args.state_file) if args.state_file else resolve_state_path()
    fields: dict[str, Any] = {}
    for item in args.field:
        key, _, value = item.partition("=")
        if not key:
            print(f"Campo inválido: {item}", file=sys.stderr)
            return 1
        fields[key] = value
    merge_state(path, **fields)
    return 0


def append_auto_run(
    path: Path | None = None,
    *,
    started_at: str,
    finished_at: str = "",
    success: bool,
    reason: str,
    max_runs: int = 60,
) -> None:
    state_path = path or resolve_state_path()
    state = load_state(state_path)
    runs = list(state.get("autoRuns") or [])
    runs.append(
        {
            "startedAt": started_at,
            "finishedAt": finished_at,
            "success": success,
            "reason": reason,
        }
    )
    state["autoRuns"] = runs[-max(1, max_runs) :]
    save_state(state, state_path)


def cmd_get(args: argparse.Namespace) -> int:
    state = load_state(Path(args.state_file) if args.state_file else None)
    if args.key:
        print(state.get(args.key, ""))
        return 0
    print(json.dumps(state, ensure_ascii=False, indent=2))
    return 0


def cmd_record_run(args: argparse.Namespace) -> int:
    path = Path(args.state_file) if args.state_file else resolve_state_path()
    append_auto_run(
        path,
        started_at=args.started_at,
        finished_at=args.finished_at or "",
        success=args.success.lower() in ("1", "true", "yes", "ok"),
        reason=args.reason or "",
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage cv-data-sync state file.")
    parser.add_argument(
        "--state-file",
        default="",
        help="Path to state JSON (default: info/sync-state.json).",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_set = sub.add_parser("set", help="Set one or more key=value fields.")
    p_set.add_argument("field", nargs="+", help="Fields as key=value.")
    p_set.set_defaults(func=cmd_set)

    p_get = sub.add_parser("get", help="Print state or a single key.")
    p_get.add_argument("--key", default="", help="Optional key to print.")
    p_get.set_defaults(func=cmd_get)

    p_run = sub.add_parser("record-run", help="Append one automatic run to autoRuns history.")
    p_run.add_argument("--started-at", required=True)
    p_run.add_argument("--finished-at", default="")
    p_run.add_argument("--success", required=True, help="true|false")
    p_run.add_argument("--reason", default="")
    p_run.set_defaults(func=cmd_record_run)

    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
