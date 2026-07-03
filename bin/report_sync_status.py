#!/usr/bin/env python3
"""Últimas corridas del sync automático (make status)."""

from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT_LOG = REPO / ".secrets" / "cv-data-sync.out.log"
STATE_PATH = REPO / "info" / "sync-state.json"
LEGACY_STATE_PATH = REPO / ".secrets" / "cv-data-sync-state.json"

RUN_START = re.compile(
    r"\[([^\]]+)\] (?:Goodreads \(likes \+ reseñas recientes \+ stats\)\.\.\."
    r"|Starting periodic data sync\.\.\.)"
)
PERIODIC_OK = re.compile(r"\[([^\]]+)\] Periodic data sync completed\.")
SKIP_FRESH = re.compile(r"\[([^\]]+)\] Periodic sync skipped \(already synced today\)\.")


def parse_iso(value: str) -> datetime | None:
    raw = (value or "").strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def fmt_local(value: str) -> str:
    dt = parse_iso(value)
    if not dt:
        return value or "?"
    return dt.astimezone().strftime("%Y-%m-%d %H:%M %Z")


def classify_chunk(chunk: str) -> tuple[bool, str]:
    if PERIODIC_OK.search(chunk):
        return True, "completo"
    if SKIP_FRESH.search(chunk):
        return True, "omitido (ya sincronizado hoy)"
    if "Another sync is already running" in chunk:
        return True, "omitido (corrida en curso)"
    if "Goodreads daily sync failed" in chunk:
        return False, "Goodreads"
    if "git push falló" in chunk:
        return False, "git push"
    if "git commit falló" in chunk:
        return False, "git commit"
    if "make: ***" in chunk or "Error 1" in chunk:
        return False, "error en pipeline"
    if "[daily-goodreads] Completado." in chunk:
        return False, "incompleto tras Goodreads"
    return False, "incompleto"


def parse_log_runs(text: str) -> list[dict]:
    starts: list[tuple[int, str]] = [(m.start(), m.group(1)) for m in RUN_START.finditer(text)]
    if not starts:
        return []

    runs: list[dict] = []
    for i, (pos, started_at) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(text)
        chunk = text[pos:end]
        ok, reason = classify_chunk(chunk)
        finished_match = PERIODIC_OK.search(chunk) or SKIP_FRESH.search(chunk)
        runs.append(
            {
                "startedAt": started_at,
                "finishedAt": finished_match.group(1) if finished_match else "",
                "success": ok,
                "reason": reason,
            }
        )
    return runs


def load_state_runs() -> list[dict]:
    path = STATE_PATH if STATE_PATH.exists() else LEGACY_STATE_PATH
    if not path.exists():
        return []
    try:
        import json

        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return []
    runs = data.get("autoRuns") if isinstance(data, dict) else None
    if not isinstance(runs, list):
        return []
    out: list[dict] = []
    for run in runs:
        if not isinstance(run, dict):
            continue
        out.append(
            {
                "startedAt": str(run.get("startedAt") or ""),
                "finishedAt": str(run.get("finishedAt") or ""),
                "success": bool(run.get("success")),
                "reason": str(run.get("reason") or ""),
            }
        )
    return out


def merge_runs(log_runs: list[dict], state_runs: list[dict]) -> list[dict]:
    by_start: dict[str, dict] = {}
    for run in log_runs + state_runs:
        key = run.get("startedAt") or ""
        if not key:
            continue
        prev = by_start.get(key)
        if prev is None or (run.get("finishedAt") and not prev.get("finishedAt")):
            by_start[key] = run
    merged = list(by_start.values())
    merged.sort(key=lambda r: parse_iso(str(r.get("startedAt") or "")) or datetime.min.replace(tzinfo=timezone.utc))
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description="Últimas corridas del sync automático.")
    parser.add_argument(
        "--limit",
        type=int,
        default=14,
        help="Número de corridas a mostrar (default: 14).",
    )
    args = parser.parse_args()

    text = ""
    if OUT_LOG.exists():
        try:
            text = OUT_LOG.read_text(encoding="utf-8", errors="replace")
        except OSError:
            print("No se pudo leer el log del sync automático.", file=sys.stderr)
            return 1

    runs = merge_runs(parse_log_runs(text), load_state_runs())
    if not runs:
        print("Sin corridas registradas del sync automático.")
        print(f"(log: {OUT_LOG})")
        return 0

    limit = max(1, args.limit)
    recent = list(reversed(runs[-limit:]))

    print("Sync automático — últimas corridas")
    print("")
    for run in recent:
        when = fmt_local(str(run.get("startedAt") or ""))
        label = "exitoso" if run.get("success") else "falló"
        print(f"  {when}  {label}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
