#!/usr/bin/env python3
"""Match Goodreads books with library-details and fill bookId field."""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path


def normalize_text(value: object) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("&", " and ")
    text = re.sub(r"\([^)]*\)", " ", text)  # remove parenthetical info
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def token_set(value: str) -> set[str]:
    return {tok for tok in normalize_text(value).split(" ") if tok}


def author_compatible(details_author: str, gr_author: str) -> bool:
    da = token_set(details_author)
    ga = token_set(gr_author)
    if not da or not ga:
        return False
    if da & ga:
        return True
    # fallback: containment on normalized text
    d = normalize_text(details_author)
    g = normalize_text(gr_author)
    return bool(d and g and (d in g or g in d))


def build_indexes(goodreads_books: list[dict]) -> tuple[dict[str, list[dict]], dict[str, list[dict]]]:
    by_title_author: dict[str, list[dict]] = {}
    by_title: dict[str, list[dict]] = {}

    for row in goodreads_books:
        title = normalize_text(row.get("title"))
        author = normalize_text(row.get("author"))
        book_id = str(row.get("bookId") or "").strip()
        if not title or not book_id:
            continue
        key_ta = f"{title}|{author}"
        by_title_author.setdefault(key_ta, []).append(row)
        by_title.setdefault(title, []).append(row)
    return by_title_author, by_title


def choose_by_date(candidates: list[dict]) -> dict:
    # Prefer most recently read when ambiguous.
    return sorted(
        candidates,
        key=lambda x: str(x.get("dateRead") or ""),
        reverse=True,
    )[0]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fill bookId in info/library-details.json using info/library.json matches.",
    )
    parser.add_argument("--library-json", default="info/library.json", help="Goodreads library JSON path.")
    parser.add_argument(
        "--library-details-json",
        default="info/library-details.json",
        help="Detailed books JSON path to update.",
    )
    args = parser.parse_args()

    library_path = Path(args.library_json)
    details_path = Path(args.library_details_json)

    if not library_path.exists():
        raise SystemExit(f"File not found: {library_path}")
    if not details_path.exists():
        raise SystemExit(f"File not found: {details_path}")

    with library_path.open("r", encoding="utf-8") as f:
        library_data = json.load(f)
    with details_path.open("r", encoding="utf-8") as f:
        details_data = json.load(f)

    goodreads_books = list(library_data.get("books") or [])

    if isinstance(details_data, dict):
        details_books = details_data.get("books")
        if not isinstance(details_books, list):
            raise SystemExit("Invalid library-details.json: expected {'books': [...]}.")
    elif isinstance(details_data, list):
        details_books = details_data
    else:
        raise SystemExit("Invalid library-details.json format.")

    by_title_author, by_title = build_indexes(goodreads_books)

    matched = 0
    unmatched = 0

    for row in details_books:
        if not isinstance(row, dict):
            continue

        d_title = str(row.get("Title") or row.get("title") or "").strip()
        d_author = str(row.get("Author") or row.get("author") or "").strip()

        n_title = normalize_text(d_title)
        n_author = normalize_text(d_author)

        chosen = None

        # 1) Exact normalized title+author
        if n_title:
            key = f"{n_title}|{n_author}"
            cands = by_title_author.get(key, [])
            if cands:
                chosen = choose_by_date(cands)

        # 2) Same title and compatible author
        if chosen is None and n_title:
            cands = by_title.get(n_title, [])
            filtered = [c for c in cands if author_compatible(d_author, c.get("author"))]
            if filtered:
                chosen = choose_by_date(filtered)

        # 3) No match => blank
        if chosen is None:
            row["bookId"] = ""
            unmatched += 1
        else:
            row["bookId"] = str(chosen.get("bookId") or "")
            matched += 1

    with details_path.open("w", encoding="utf-8") as f:
        json.dump(details_data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Matched: {matched}")
    print(f"Unmatched: {unmatched}")
    print(f"Updated: {details_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

