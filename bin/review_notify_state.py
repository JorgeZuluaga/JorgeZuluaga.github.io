#!/usr/bin/env python3
"""Persistencia de info/review-notify-state.json (enviadas + cola de reenvío)."""

from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LEGACY_NOTIFY_STATE = REPO / ".secrets" / "last-notified-reviews.json"
DEFAULT_NOTIFY_STATE = REPO / "info" / "review-notify-state.json"


def resolve_notify_state_path() -> Path:
    raw = os.environ.get("NOTIFY_STATE_FILE", "").strip()
    if raw:
        return Path(raw)
    if not DEFAULT_NOTIFY_STATE.exists() and LEGACY_NOTIFY_STATE.exists():
        DEFAULT_NOTIFY_STATE.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(LEGACY_NOTIFY_STATE, DEFAULT_NOTIFY_STATE)
    return DEFAULT_NOTIFY_STATE


def _normalize_id_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in value:
        review_id = str(item or "").strip()
        if not review_id or review_id in seen:
            continue
        seen.add(review_id)
        out.append(review_id)
    return out


def load_state() -> dict:
    state_path = resolve_notify_state_path()
    if not state_path.exists():
        return {"notifiedReviewIds": [], "queuedReviewIds": []}
    try:
        with state_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"notifiedReviewIds": [], "queuedReviewIds": []}
    if not isinstance(data, dict):
        return {"notifiedReviewIds": [], "queuedReviewIds": []}
    return {
        "notifiedReviewIds": _normalize_id_list(data.get("notifiedReviewIds")),
        "queuedReviewIds": _normalize_id_list(data.get("queuedReviewIds")),
        "updatedAt": str(data.get("updatedAt") or "").strip(),
    }


def save_state(
    *,
    notified_ids: list[str] | None = None,
    queued_ids: list[str] | None = None,
) -> Path:
    current = load_state()
    state_path = resolve_notify_state_path()
    state_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "notifiedReviewIds": sorted(
            set(notified_ids if notified_ids is not None else current["notifiedReviewIds"]),
        ),
        "queuedReviewIds": _normalize_id_list(
            queued_ids if queued_ids is not None else current["queuedReviewIds"],
        ),
    }
    with state_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return state_path


def enqueue_review_ids(review_ids: list[str]) -> tuple[list[str], Path]:
    """Añade IDs a la cola de envío del próximo notify diario."""
    incoming = _normalize_id_list(review_ids)
    if not incoming:
        return [], resolve_notify_state_path()
    current = load_state()
    queued = list(current["queuedReviewIds"])
    added: list[str] = []
    queued_set = set(queued)
    for review_id in incoming:
        if review_id in queued_set:
            continue
        queued.append(review_id)
        queued_set.add(review_id)
        added.append(review_id)
    path = save_state(queued_ids=queued)
    return added, path


def dequeue_review_ids(review_ids: list[str]) -> None:
    remove = set(_normalize_id_list(review_ids))
    if not remove:
        return
    current = load_state()
    queued = [rid for rid in current["queuedReviewIds"] if rid not in remove]
    save_state(queued_ids=queued)
