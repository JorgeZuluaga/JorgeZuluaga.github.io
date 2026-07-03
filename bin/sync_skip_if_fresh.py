#!/usr/bin/env python3
"""Exit 0 if periodic sync already succeeded today (skip redundant launchd run)."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sync_state import load_state  # noqa: E402


def main() -> int:
    source = (os.environ.get("SYNC_SOURCE") or "launchd").strip() or "launchd"
    state = load_state()
    source_key = f"lastPeriodicSyncSuccessAt_{source}"
    last = str(state.get(source_key) or "")
    if not last and source == "launchd":
        # Compatibilidad con estado anterior (solo aplica al job local).
        last = str(state.get("lastPeriodicSyncSuccessAt") or state.get("lastDailyGoodreadsSuccessAt") or "")
    if not last:
        return 1
    try:
        dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
    except ValueError:
        return 1
    if dt.astimezone(timezone.utc).date() == datetime.now(timezone.utc).date():
        print(f"[sync] Ya hubo sync exitoso hoy para {source} ({last}); se omite esta corrida.")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(0 if main() == 0 else 1)
