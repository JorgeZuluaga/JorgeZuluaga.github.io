#!/usr/bin/env python3
"""Load review-notification credentials from env or .secrets/."""

from __future__ import annotations

import os
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

ENV_BY_FILE = {
    "gmail-smtp-user": "GMAIL_SMTP_USER",
    "gmail-app-password": "GMAIL_APP_PASSWORD",
    "review-notify-token": "REVIEW_NOTIFY_TOKEN",
    "review-notify-worker-url": "REVIEW_NOTIFY_WORKER_URL",
    "cookie": "GOODREADS_COOKIE",
    "log_read_token": "LOG_READ_TOKEN",
    "rss": "RSS_URL",
}


def normalize_credential(raw: str, *, strip_spaces: bool = False) -> str:
    text = raw.replace("\ufeff", "")
    line = next((ln for ln in text.splitlines() if ln.strip()), text).strip()
    for ch in ("\u00a0", "\u202f", "\u2007"):
        line = line.replace(ch, " " if not strip_spaces else "")
    if strip_spaces:
        line = "".join(line.split())
    return line.strip()


def load_secret(name: str, *, strip_spaces: bool = False) -> str:
    env_key = ENV_BY_FILE.get(name)
    if env_key:
        raw = os.environ.get(env_key, "").strip()
        if raw:
            return normalize_credential(raw, strip_spaces=strip_spaces)
    path = REPO / ".secrets" / name
    if not path.exists():
        label = env_key or name
        raise FileNotFoundError(f"Falta {path} o variable de entorno {label}.")
    return normalize_credential(path.read_text(encoding="utf-8"), strip_spaces=strip_spaces)
