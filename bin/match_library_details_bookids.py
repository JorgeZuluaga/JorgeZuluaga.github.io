#!/usr/bin/env python3
"""Match Goodreads books with library-details and fill bookId field."""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from datetime import datetime
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


def library_key(title: object, author: object) -> str:
    return f"{normalize_text(title)}|{normalize_text(author)}"


def choose_by_date(candidates: list[dict]) -> dict:
    # Prefer most recently read when ambiguous.
    return sorted(
        candidates,
        key=lambda x: str(x.get("dateRead") or ""),
        reverse=True,
    )[0]


def normalize_date_added(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    # BookBuddy usually exports "YYYY/MM/DD HH:MM:SS.fffffffff" (nanoseconds).
    m = re.match(r"^(\d{4})/(\d{2})/(\d{2})", raw)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    for fmt in ("%Y/%m/%d %H:%M:%S.%f", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def details_to_library_book(row: dict, fallback_book_id: str = "") -> dict:
    title = str(row.get("Title") or row.get("title") or "").strip()
    author = str(row.get("Author") or row.get("author") or "").strip()
    book_id = str(row.get("bookId") or fallback_book_id or "").strip()
    date_added = normalize_date_added(row.get("Date Added") or row.get("dateAdded"))
    return {
        "bookId": book_id,
        "title": title,
        "author": author,
        "dateRead": "",
        "dateAdded": date_added,
        "rating": 0,
        "reviewUrl": "",
        "hasReview": False,
        "reviewLikes": 0,
        "scrapeStatus": "not_in_goodreads",
        "reviewLocalStatus": "",
        "reviewDate": "",
        "reviewLocalLikes": 0,
        "drzrating": -1,
        "bookDetails": 1,
    }


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

    print(
        f"[match-details] Cruce bookId: {library_path} ↔ {details_path}",
        flush=True,
    )

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
    library_books = list(library_data.get("books") or [])
    library_books_by_id: dict[str, dict] = {}
    library_books_by_key: dict[str, dict] = {}
    for b in library_books:
        if not isinstance(b, dict):
            continue
        bid = str(b.get("bookId") or "").strip()
        if bid:
            library_books_by_id[bid] = b
        lkey = library_key(b.get("title"), b.get("author"))
        if lkey != "|":
            library_books_by_key[lkey] = b
    existing_book_ids = {
        str(b.get("bookId") or "").strip()
        for b in library_books
        if isinstance(b, dict) and str(b.get("bookId") or "").strip()
    }
    existing_title_author = {
        library_key(b.get("title"), b.get("author"))
        for b in library_books
        if isinstance(b, dict)
    }

    matched = 0
    unmatched = 0
    added_to_library = 0

    for row in details_books:
        if not isinstance(row, dict):
            continue

        d_title = str(row.get("Title") or row.get("title") or "").strip()
        d_author = str(row.get("Author") or row.get("author") or "").strip()
        d_date_added = normalize_date_added(row.get("Date Added") or row.get("dateAdded"))

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

        # Propagate Date Added from library-details into library.json entries.
        detail_book_id = str(row.get("bookId") or "").strip()
        detail_key = library_key(d_title, d_author)
        target_book = None
        if detail_book_id:
            target_book = library_books_by_id.get(detail_book_id)
        if target_book is None:
            target_book = library_books_by_key.get(detail_key)
        if target_book is not None and d_date_added:
            target_book["dateAdded"] = d_date_added

        # Add details-only books to library.json (antibiblioteca seed).
        detail_title = d_title
        detail_author = d_author
        if not detail_title:
            continue
        if detail_book_id and detail_book_id in existing_book_ids:
            continue
        if detail_key in existing_title_author:
            continue

        new_book = details_to_library_book(row=row, fallback_book_id=detail_book_id)
        library_books.append(new_book)
        if detail_book_id:
            existing_book_ids.add(detail_book_id)
        existing_title_author.add(detail_key)
        if detail_book_id:
            library_books_by_id[detail_book_id] = new_book
        library_books_by_key[detail_key] = new_book
        added_to_library += 1

    with details_path.open("w", encoding="utf-8") as f:
        json.dump(details_data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    library_data["books"] = library_books
    with library_path.open("w", encoding="utf-8") as f:
        json.dump(library_data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Matched: {matched}")
    print(f"Unmatched: {unmatched}")
    print(f"Added to library.json: {added_to_library}")
    print(f"Updated: {details_path}")
    print(f"Updated: {library_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

