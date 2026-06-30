#!/usr/bin/env python3
"""Link library-details rows to Goodreads bookIds using ISBN from library.json."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, payload: dict) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")


def normalize_isbn(value: object) -> str:
    return re.sub(r"[^0-9Xx]", "", str(value or "")).upper()


def isbn10_to_isbn13(isbn10: str) -> str:
    core = "978" + isbn10[:-1]
    total = sum(int(char) * (1 if idx % 2 == 0 else 3) for idx, char in enumerate(core))
    check = (10 - total % 10) % 10
    return core + str(check)


def canonical_isbn(value: object) -> str:
    raw = normalize_isbn(value)
    if not raw:
        return ""
    if len(raw) == 10:
        return isbn10_to_isbn13(raw)
    return raw


def normalize_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def author_compatible(details_author: str, gr_author: str) -> bool:
    da = normalize_text(details_author)
    ga = normalize_text(gr_author)
    if not da or not ga:
        return False
    if da == ga:
        return True
    return da in ga or ga in da


def choose_library_book(candidates: list[dict], details_row: dict) -> dict | None:
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    d_title = normalize_text(details_row.get("Title") or details_row.get("title"))
    d_author = normalize_text(details_row.get("Author") or details_row.get("author"))
    filtered = [
        book
        for book in candidates
        if normalize_text(book.get("title")) == d_title
        and author_compatible(d_author, str(book.get("author") or ""))
    ]
    if len(filtered) == 1:
        return filtered[0]
    title_matches = [book for book in candidates if normalize_text(book.get("title")) == d_title]
    if len(title_matches) == 1:
        return title_matches[0]
    return sorted(
        candidates,
        key=lambda book: str(book.get("dateRead") or ""),
        reverse=True,
    )[0]


def build_library_index(library_books: list[dict]) -> dict[str, list[dict]]:
    by_isbn: dict[str, list[dict]] = {}
    for book in library_books:
        if not isinstance(book, dict):
            continue
        book_id = str(book.get("bookId") or "").strip()
        isbn = canonical_isbn(book.get("isbn"))
        if not book_id or not isbn:
            continue
        by_isbn.setdefault(isbn, []).append(book)
    return by_isbn


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Asigna bookId de Goodreads en library-details.json cuando el ISBN "
            "coincide con un libro de library.json."
        )
    )
    parser.add_argument("--library-json", default="info/library.json")
    parser.add_argument("--library-details-json", default="info/library-details.json")
    parser.add_argument(
        "--book-id",
        action="append",
        default=[],
        help="Solo cruzar estos bookId de Goodreads.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Mostrar cambios sin escribir archivos.",
    )
    args = parser.parse_args()

    library_path = Path(args.library_json)
    details_path = Path(args.library_details_json)
    library = load_json(library_path)
    details = load_json(details_path)
    library_books = list(library.get("books") or [])
    details_books = list(details.get("books") or [])

    target_book_ids = {str(book_id).strip() for book_id in args.book_id if str(book_id).strip()}
    library_by_id = {
        str(book.get("bookId") or "").strip(): book
        for book in library_books
        if isinstance(book, dict) and str(book.get("bookId") or "").strip()
    }
    library_by_isbn = build_library_index(library_books)

    linked = 0
    skipped_existing = 0
    ambiguous = 0
    no_match = 0

    for row in details_books:
        if not isinstance(row, dict):
            continue
        details_isbn = canonical_isbn(row.get("ISBN") or row.get("isbn"))
        if not details_isbn:
            continue

        existing_book_id = str(row.get("bookId") or "").strip()
        if existing_book_id:
            if target_book_ids and existing_book_id not in target_book_ids:
                continue
            skipped_existing += 1
            continue

        candidates = library_by_isbn.get(details_isbn, [])
        if target_book_ids:
            candidates = [
                book
                for book in candidates
                if str(book.get("bookId") or "").strip() in target_book_ids
            ]
        chosen = choose_library_book(candidates, row)
        if not chosen:
            if target_book_ids and candidates == []:
                no_match += 1
            continue

        book_id = str(chosen.get("bookId") or "").strip()
        if not book_id:
            continue
        if len(candidates) > 1:
            ambiguous += 1

        row["bookId"] = book_id
        chosen["matched"] = True
        chosen["bookDetails"] = 1
        linked += 1
        title = str(row.get("Title") or row.get("title") or "").strip()
        print(f"LINK {book_id}  ISBN {details_isbn}  {title}")

    if target_book_ids:
        for book_id in sorted(target_book_ids):
            if book_id not in library_by_id:
                print(f"MISS library.json bookId: {book_id}")
                continue
            book = library_by_id[book_id]
            isbn = canonical_isbn(book.get("isbn"))
            if not isbn:
                print(f"MISS ISBN en library.json: {book_id} ({book.get('title')})")
                continue
            matched_rows = [
                row
                for row in details_books
                if isinstance(row, dict) and canonical_isbn(row.get("ISBN") or row.get("isbn")) == isbn
            ]
            if not matched_rows:
                print(
                    f"MISS library-details ISBN {isbn}: {book_id} ({book.get('title')})"
                )

    if not args.dry_run:
        save_json(details_path, details)
        save_json(library_path, library)
    print(
        f"\nResumen: linked={linked}, existing={skipped_existing}, "
        f"ambiguous={ambiguous}, no_match_targets={no_match}"
    )
    if args.dry_run:
        print("Dry-run: sin escribir archivos.")
    else:
        print(f"Guardado: {details_path}")
        print(f"Guardado: {library_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
