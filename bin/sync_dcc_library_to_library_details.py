#!/usr/bin/env python3
"""Copy dcc_classes, dcc_codes, dcc_notes from library.json into library-details.json.

Matches each antibiblioteca row to a Goodreads book when:
  - the same non-empty bookId appears in both files, or
  - library.json has `isbn` and library-details has the same ISBN (digits only).

Does not add or remove books; only aligns Dewey metadata on linked rows.
"""

from __future__ import annotations

import argparse
import copy
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
LIBRARY_JSON = ROOT / "info" / "library.json"
DETAILS_JSON = ROOT / "info" / "library-details.json"

DCC_KEYS = ("dcc_classes", "dcc_codes", "dcc_notes")


def norm_book_id(value: object) -> str:
    return str(value or "").strip()


def norm_isbn_digits(value: object) -> str:
    return "".join(c for c in str(value or "") if c.isdigit()).upper()


def pick_library_book(
    lib_by_id: dict[str, dict],
    lib_by_isbn: dict[str, dict],
    row: dict,
) -> tuple[dict | None, str]:
    bid = norm_book_id(row.get("bookId"))
    if bid and bid in lib_by_id:
        return lib_by_id[bid], "bookId"

    isbn = norm_isbn_digits(row.get("ISBN"))
    if len(isbn) >= 10 and isbn in lib_by_isbn:
        return lib_by_isbn[isbn], "isbn"

    return None, ""


def apply_dcc_from_library(target: dict, source: dict) -> bool:
    """Mutate target's DCC fields to match source. Returns True if anything changed."""
    changed = False
    for key in DCC_KEYS:
        if key in source:
            new_val = copy.deepcopy(source[key])
            if target.get(key) != new_val:
                target[key] = new_val
                changed = True
        else:
            if key in target:
                del target[key]
                changed = True
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library-json", type=Path, default=LIBRARY_JSON)
    parser.add_argument("--library-details", type=Path, default=DETAILS_JSON)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    with args.library_json.open(encoding="utf-8") as f:
        lib_root = json.load(f)
    with args.library_details.open(encoding="utf-8") as f:
        det_root = json.load(f)

    lib_books = list(lib_root.get("books") or [])
    det_books = list(det_root.get("books") or [])

    lib_by_id: dict[str, dict] = {}
    lib_by_isbn: dict[str, dict] = {}
    for book in lib_books:
        if not isinstance(book, dict):
            continue
        bid = norm_book_id(book.get("bookId"))
        if bid:
            lib_by_id[bid] = book
        isbn = norm_isbn_digits(book.get("isbn") or book.get("ISBN"))
        if len(isbn) >= 10 and isbn not in lib_by_isbn:
            lib_by_isbn[isbn] = book

    updated = 0
    by_book_id = 0
    by_isbn = 0
    unchanged_linked = 0

    for row in det_books:
        if not isinstance(row, dict):
            continue
        lib, mode = pick_library_book(lib_by_id, lib_by_isbn, row)
        if not lib:
            continue
        if args.dry_run:
            probe = copy.deepcopy(row)
            changed = apply_dcc_from_library(probe, lib)
        else:
            changed = apply_dcc_from_library(row, lib)
        if changed:
            updated += 1
            if mode == "bookId":
                by_book_id += 1
            else:
                by_isbn += 1
        else:
            unchanged_linked += 1

    print(
        json.dumps(
            {
                "linked_rows_updated": updated,
                "via_bookId": by_book_id,
                "via_isbn": by_isbn,
                "linked_rows_already_aligned": unchanged_linked,
                "dry_run": args.dry_run,
            },
            indent=2,
        )
    )

    if args.dry_run:
        return 0

    det_root["generatedAt"] = datetime.now(timezone.utc).isoformat()
    args.library_details.write_text(
        json.dumps(det_root, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
