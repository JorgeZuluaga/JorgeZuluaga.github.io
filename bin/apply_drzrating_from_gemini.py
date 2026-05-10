#!/usr/bin/env python3
"""Apply DrZRating scores produced by Gemini into info/library.json.

Gemini output format expected (JSON):
[
  {"bookId": "237811588", "DrZRating": 94},
  ...
]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def to_int(value: Any) -> int | None:
    try:
        return int(value)
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--in-json", required=True, help="Gemini output JSON file (list of {bookId, DrZRating}).")
    ap.add_argument("--library-json", default="info/library.json", help="Path to library.json.")
    ap.add_argument("--dry-run", action="store_true", help="Don't write; only report changes.")
    args = ap.parse_args()

    in_path = Path(args.in_json)
    lib_path = Path(args.library_json)
    if not in_path.exists():
        raise SystemExit(f"Not found: {in_path}")
    if not lib_path.exists():
        raise SystemExit(f"Not found: {lib_path}")

    payload = json.loads(in_path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise SystemExit("Invalid input JSON: expected a list.")

    data = json.loads(lib_path.read_text(encoding="utf-8"))
    books = data.get("books")
    if not isinstance(books, list):
        raise SystemExit("Invalid library.json: expected key 'books' as list.")

    by_id: dict[str, dict] = {}
    for b in books:
        if isinstance(b, dict):
            bid = str(b.get("bookId") or "").strip()
            if bid:
                by_id[bid] = b

    updated = 0
    skipped_missing = 0
    skipped_invalid = 0

    for row in payload:
        if not isinstance(row, dict):
            skipped_invalid += 1
            continue
        bid = str(row.get("bookId") or "").strip()
        score = to_int(row.get("DrZRating"))
        if not bid or score is None:
            skipped_invalid += 1
            continue
        if score != -1 and not (1 <= score <= 100):
            skipped_invalid += 1
            continue
        book = by_id.get(bid)
        if not book:
            skipped_missing += 1
            continue
        prev = book.get("drzrating")
        if prev != score:
            book["drzrating"] = score
            updated += 1

    if not args.dry_run:
        data["books"] = books
        lib_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Applied DrZRating rows: {len(payload)}")
    print(f"Updated books: {updated}")
    print(f"Skipped missing bookId in library: {skipped_missing}")
    print(f"Skipped invalid rows: {skipped_invalid}")
    if args.dry_run:
        print("Dry run: no file written.")
    else:
        print(f"Wrote: {lib_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

