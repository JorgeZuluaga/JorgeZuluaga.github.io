#!/usr/bin/env python3
"""Import BookBuddy CSV rows into info/library-details.json without duplicates."""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path


def norm(value: object) -> str:
    return str(value or "").strip()


def canonical_key(row: dict) -> str:
    """Build a stable dedupe key using the strongest available identifiers."""
    isbn = norm(row.get("ISBN"))
    if isbn:
        return f"isbn:{isbn.lower()}"

    google_id = norm(row.get("Google VolumeID"))
    if google_id:
        return f"google:{google_id.lower()}"

    user_id = norm(row.get("User Supplied ID"))
    if user_id:
        return f"user_id:{user_id.lower()}"

    title = norm(row.get("Title")).lower()
    author = norm(row.get("Author")).lower()
    year = norm(row.get("Year Published")).lower()
    return f"title_author_year:{title}|{author}|{year}"


def load_output(path: Path) -> tuple[dict, list[dict], str]:
    """
    Load output JSON in a backward-compatible way.

    Returns:
      root_object, books_list, mode
      mode == "dict_books" if root has {"books": [...]}
      mode == "list" if root is directly a list
    """
    if not path.exists():
        root = {
            "generatedAt": "",
            "source": {
                "file": "info/bookbuddy.csv",
                "type": "bookbuddy_export",
            },
            "books": [],
        }
        return root, root["books"], "dict_books"

    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, dict):
        books = data.get("books")
        if not isinstance(books, list):
            books = []
            data["books"] = books
        return data, books, "dict_books"

    if isinstance(data, list):
        return {}, data, "list"

    # Unexpected structure: reset to canonical dict.
    root = {
        "generatedAt": "",
        "source": {
            "file": "info/bookbuddy.csv",
            "type": "bookbuddy_export",
        },
        "books": [],
    }
    return root, root["books"], "dict_books"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Import info/bookbuddy.csv into info/library-details.json."
    )
    parser.add_argument(
        "--csv",
        default="info/bookbuddy.csv",
        help="Path to the BookBuddy CSV file.",
    )
    parser.add_argument(
        "--out",
        default="info/library-details.json",
        help="Path to output JSON file.",
    )
    args = parser.parse_args()

    csv_path = Path(args.csv)
    out_path = Path(args.out)

    print(f"[bookbuddy-import] CSV: {csv_path} → {out_path}", flush=True)

    if not csv_path.exists():
        raise SystemExit(f"CSV file not found: {csv_path}")

    root, books, mode = load_output(out_path)

    existing_keys = {canonical_key(row) for row in books if isinstance(row, dict)}
    added = 0

    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for raw_row in reader:
            row = {k: norm(v) for k, v in (raw_row or {}).items() if k}
            if not row:
                continue
            key = canonical_key(row)
            if key in existing_keys:
                continue
            books.append(row)
            existing_keys.add(key)
            added += 1

    now = datetime.now(timezone.utc).isoformat()
    if mode == "dict_books":
        root["generatedAt"] = now
        root.setdefault("source", {})
        if isinstance(root["source"], dict):
            root["source"]["file"] = str(csv_path)
            root["source"]["type"] = "bookbuddy_export"
        out_data = root
    else:
        out_data = books

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(out_data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Imported rows: {added}")
    print(f"Total rows in JSON: {len(books)}")
    print(f"Output: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

