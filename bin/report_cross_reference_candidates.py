#!/usr/bin/env python3
"""Informe de cruces library.json ↔ library-details para revisión manual.

Lista libros en library.json que aún NO tienen match (matched=false) y busca
candidatos en library-details.json por título/autor normalizado. El usuario edita
`chosenDetailsRowKey` para seleccionar la fila correcta en library-details.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from match_library_details_bookids import author_compatible, normalize_date_added, normalize_text, row_match_key

def normalize_isbn(value: object) -> str:
    import re
    return re.sub(r"[^0-9Xx]", "", str(value or "")).upper()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--library-json", default="info/library.json")
    ap.add_argument("--library-details-json", default="info/library-details.json")
    ap.add_argument("--out", default="update/cross-reference-overrides.json")
    ap.add_argument(
        "--only-unmatched",
        action="store_true",
        help="Incluye solo libros de library.json con matched=false (pendientes).",
    )
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    lib_path = root / args.library_json
    det_path = root / args.library_details_json
    out_path = root / args.out

    print(f"[cross-ref] Analizando {det_path} vs {lib_path} …", flush=True)
    library_data = json.loads(lib_path.read_text(encoding="utf-8"))
    details_data = json.loads(det_path.read_text(encoding="utf-8"))

    if isinstance(details_data, dict):
        details_books = details_data.get("books") or []
    else:
        details_books = details_data if isinstance(details_data, list) else []

    # Index details rows by normalized title and title+author to surface candidates.
    by_ta: dict[str, list[dict]] = {}
    by_t: dict[str, list[dict]] = {}
    details_book_ids: set[str] = set()
    details_by_isbn: dict[str, list[dict]] = {}
    for row in details_books:
        if not isinstance(row, dict):
            continue
        title = str(row.get("Title") or row.get("title") or "").strip()
        author = str(row.get("Author") or row.get("author") or "").strip()
        nt = normalize_text(title)
        na = normalize_text(author)
        if not nt:
            continue
        by_ta.setdefault(f"{nt}|{na}", []).append(row)
        by_t.setdefault(nt, []).append(row)
        bid = str(row.get("bookId") or "").strip()
        if bid:
            details_book_ids.add(bid)
        isbn = normalize_isbn(row.get("ISBN") or row.get("isbn") or "")
        if isbn:
            details_by_isbn.setdefault(isbn, []).append(row)

    items: list[dict] = []
    books_seen = 0
    books_total = 0

    goodreads_books = list(library_data.get("books") or [])
    books_total = len(goodreads_books)
    for b in goodreads_books:
        if not isinstance(b, dict):
            continue
        book_id = str(b.get("bookId") or "").strip()
        title = str(b.get("title") or "").strip()
        author = str(b.get("author") or "").strip()
        if not book_id or not title:
            continue
        # Default: if field missing, treat as unmatched so it appears once for review.
        is_matched = bool(b.get("matched")) if "matched" in b else bool(book_id in details_book_ids)
        if args.only_unmatched and is_matched:
            continue
        if (not args.only_unmatched) and is_matched:
            continue
        books_seen += 1

        nt = normalize_text(title)
        na = normalize_text(author)
        key_ta = f"{nt}|{na}"
        cands = list(by_ta.get(key_ta, []))
        if not cands and nt:
            alt = []
            for row in by_t.get(nt, []):
                r_author = str(row.get("Author") or row.get("author") or "")
                if author_compatible(author, r_author):
                    alt.append(row)
            cands = alt

        candidates = []
        for row in cands:
            r_title = str(row.get("Title") or row.get("title") or "").strip()
            r_author = str(row.get("Author") or row.get("author") or "").strip()
            date_added_raw = row.get("Date Added") or row.get("dateAdded") or ""
            date_added_iso = normalize_date_added(date_added_raw)
            rkey = row_match_key(title=r_title, author=r_author, date_added_iso=date_added_iso)
            isbn = normalize_isbn(row.get("ISBN") or row.get("isbn") or "")
            candidates.append(
                {
                    "isbn": isbn,
                    "detailsRowKey": rkey,
                    "title": r_title,
                    "author": r_author,
                    "dateAddedRaw": str(date_added_raw),
                    "dateAdded": date_added_iso,
                    "existingBookId": str(row.get("bookId") or "").strip(),
                }
            )

        items.append(
            {
                "libraryBookId": book_id,
                "title": title,
                "author": author,
                "dateRead": str(b.get("dateRead") or ""),
                "chosenIsbn": "",
                "candidates": candidates,
            }
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "libraryJson": args.library_json,
            "libraryDetailsJson": args.library_details_json,
            "onlyUnmatched": bool(args.only_unmatched),
        },
        "instructions": {
            "edit": "Rellene chosenIsbn con el ISBN correcto (idealmente uno de candidates[].isbn). Si no hay candidates, búscalo en library-details y pega el ISBN.",
            "apply": "Luego ejecute: make library-details-match (lee este JSON y aplica cambios a info/library-details.json e info/library.json).",
            "isbn": "ISBN se normaliza a dígitos/X (sin guiones ni espacios).",
        },
        "items": items,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Informe escrito: {out_path} (items={len(items)}, libros={books_seen}/{books_total})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
