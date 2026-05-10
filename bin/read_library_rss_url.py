#!/usr/bin/env python3
"""Print RSS URL from info/library.json source (for Make/shell wrappers)."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    lib_path = root / "info" / "library.json"
    if not lib_path.exists():
        print("", end="")
        return 1
    try:
        data = json.loads(lib_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        print("", end="")
        return 1
    rss = str((data.get("source") or {}).get("rssUrl") or "").strip()
    if not rss:
        return 1
    print(rss, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
