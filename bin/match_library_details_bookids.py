#!/usr/bin/env python3
"""Match Goodreads books with library-details and fill bookId field."""

from __future__ import annotations

import argparse
import json
import hashlib
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

def should_default_to_matched(date_added_iso: str) -> bool:
    """Heurística para evitar re-matches masivos.

    Si no existe el campo `matched` en la fila, asumimos que ya fue comparada
    salvo compras recientes (abril/mayo 2026) que todavía no se han revisado.
    """
    if not date_added_iso:
        return True
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", date_added_iso)
    if not m:
        return True
    year = int(m.group(1))
    month = int(m.group(2))
    if year == 2026 and month in (4, 5):
        return False
    return True

def is_pending_apr_may_2026(date_added_iso: str) -> bool:
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", str(date_added_iso or "").strip())
    if not m:
        return False
    return int(m.group(1)) == 2026 and int(m.group(2)) in (4, 5)

def is_pending_read_apr_may_2026(date_read_iso: str) -> bool:
    """Libros leídos en abril/mayo 2026 se mantienen como matched=false para revisión."""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", str(date_read_iso or "").strip())
    if not m:
        return False
    return int(m.group(1)) == 2026 and int(m.group(2)) in (4, 5)

def row_match_key(*, title: str, author: str, date_added_iso: str) -> str:
    """Stable key to identify a library-details row for manual overrides."""
    basis = "|".join(
        [
            normalize_text(title),
            normalize_text(author),
            str(date_added_iso or "").strip(),
        ]
    )
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:12]

def normalize_isbn(value: object) -> str:
    """Normalize ISBN to digits/X only, uppercase. Accepts ISBN-10/13."""
    return re.sub(r"[^0-9Xx]", "", str(value or "")).upper()


def load_manual_overrides(path: Path) -> dict[str, str]:
    """Load user-edited cross-ref JSON and return libraryBookId -> chosen ISBN mappings."""
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return {}
    out: dict[str, str] = {}
    for it in items:
        if not isinstance(it, dict):
            continue
        lib_id = str(it.get("libraryBookId") or "").strip()
        chosen = normalize_isbn(it.get("chosenIsbn"))
        if lib_id and chosen:
            out[lib_id] = chosen
    return out


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
        description="Apply library.json ↔ library-details.json matches and keep library.json matched flags in sync.",
    )
    parser.add_argument("--library-json", default="info/library.json", help="Goodreads library JSON path.")
    parser.add_argument(
        "--library-details-json",
        default="info/library-details.json",
        help="Detailed books JSON path to update.",
    )
    parser.add_argument(
        "--add-details-only-to-library",
        action="store_true",
        help=(
            "Si está presente, agrega a library.json los libros que aparecen solo en "
            "library-details (sin match a Goodreads). Útil para sembrar la antibiblioteca."
        ),
    )
    parser.add_argument(
        "--cross-ref-json",
        default="update/cross-reference-overrides.json",
        help="JSON editable (salida de library-cross-ref-report) para aplicar bookId elegidos.",
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

    # Index Goodreads books for legacy auto-match (details -> Goodreads).
    by_title_author, by_title = build_indexes(goodreads_books)
    library_books = list(library_data.get("books") or [])
    known_book_ids = {
        str(b.get("bookId") or "").strip()
        for b in library_books
        if isinstance(b, dict) and str(b.get("bookId") or "").strip()
    }
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
    applied_manual = 0

    root = Path(__file__).resolve().parent.parent
    overrides_path = root / str(args.cross_ref_json)
    manual_overrides = load_manual_overrides(overrides_path)

    # Build indexes for details rows (by ISBN and rowKey).
    details_by_rowkey: dict[str, dict] = {}
    details_by_isbn: dict[str, list[dict]] = {}
    details_book_ids: set[str] = set()
    for row in details_books:
        if not isinstance(row, dict):
            continue
        r_title = str(row.get("Title") or row.get("title") or "").strip()
        r_author = str(row.get("Author") or row.get("author") or "").strip()
        r_date_added = normalize_date_added(row.get("Date Added") or row.get("dateAdded"))
        rk = row_match_key(title=r_title, author=r_author, date_added_iso=r_date_added)
        details_by_rowkey[rk] = row
        isbn = normalize_isbn(row.get("ISBN") or row.get("isbn") or "")
        if isbn:
            details_by_isbn.setdefault(isbn, []).append(row)
        bid = str(row.get("bookId") or "").strip()
        if bid:
            details_book_ids.add(bid)

    # Sync matched flag into library.json based on details' bookId set.
    for b in library_books:
        if not isinstance(b, dict):
            continue
        bid = str(b.get("bookId") or "").strip()
        if not bid:
            continue
        b["matched"] = bool(bid in details_book_ids)
        # Force recent reads (Apr/May 2026) to stay pending for manual verification.
        if is_pending_read_apr_may_2026(str(b.get("dateRead") or "")):
            b["matched"] = False

    # Apply manual overrides: user chose an ISBN for a Goodreads bookId.
    for lib_id, chosen_isbn in manual_overrides.items():
        if lib_id not in known_book_ids:
            continue
        rows = details_by_isbn.get(chosen_isbn) or []
        if not rows:
            continue
        # Prefer a row already linked to this lib_id, else an empty row, else the first.
        row = None
        for r in rows:
            if str(r.get("bookId") or "").strip() == lib_id:
                row = r
                break
        if row is None:
            for r in rows:
                if not str(r.get("bookId") or "").strip():
                    row = r
                    break
        if row is None:
            row = rows[0]
        row["bookId"] = lib_id
        # Mark matched in library.json.
        target = library_books_by_id.get(lib_id)
        if target is not None:
            target["matched"] = True
        applied_manual += 1

    for row in details_books:
        if not isinstance(row, dict):
            continue

        d_title = str(row.get("Title") or row.get("title") or "").strip()
        d_author = str(row.get("Author") or row.get("author") or "").strip()
        d_date_added = normalize_date_added(row.get("Date Added") or row.get("dateAdded"))
        existing_detail_book_id = str(row.get("bookId") or "").strip()

        # If details already has a bookId (manual or previous match), don't overwrite it.
        # Still propagate dateAdded to the corresponding Goodreads book when possible.
        if existing_detail_book_id:
            detail_key = library_key(d_title, d_author)
            target_book = library_books_by_id.get(existing_detail_book_id) or library_books_by_key.get(detail_key)
            if target_book is not None and d_date_added:
                target_book["dateAdded"] = d_date_added
            if target_book is not None:
                target_book["matched"] = True
            continue

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
        if target_book is not None and detail_book_id:
            # Keep library.json matched in sync when details already has bookId.
            target_book["matched"] = True

        # Add details-only books to library.json (optional; antibiblioteca seed).
        if not args.add_details_only_to_library:
            continue
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

    # Final override: keep Apr/May 2026 reads as pending (matched=false),
    # even if they have an existing link in details.
    for b in library_books:
        if not isinstance(b, dict):
            continue
        if is_pending_read_apr_may_2026(str(b.get("dateRead") or "")):
            b["matched"] = False

    library_data["books"] = library_books
    with library_path.open("w", encoding="utf-8") as f:
        json.dump(library_data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Matched: {matched}")
    print(f"Unmatched: {unmatched}")
    print(f"Applied manual overrides: {applied_manual}")
    print(f"Added to library.json: {added_to_library}")
    print(f"Updated: {details_path}")
    print(f"Updated: {library_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

