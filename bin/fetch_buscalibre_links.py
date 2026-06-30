#!/usr/bin/env python3
"""Fetch Buscalibre Colombia product links by ISBN and store affiliate URLs."""

from __future__ import annotations

import argparse
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote_plus, urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
BUSCALIBRE_DOMAIN = "https://www.buscalibre.com.co"
SEARCH_URL = BUSCALIBRE_DOMAIN + "/libros/search/?q={query}"
DEFAULT_AFFILIATE_ID = "74c874bfb5a8145d7c1b"
PRODUCT_PATH_RE = re.compile(
    r"https?://(?:www\.)?buscalibre\.com\.co/[^\"'\s<>]+/p/\d+",
    re.IGNORECASE,
)


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    tmp.replace(path)


def normalize_isbn(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    return re.sub(r"[^0-9Xx]", "", raw).upper()


def fetch_html(url: str, *, timeout: int = 25) -> str:
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def with_affiliate(url: str, affiliate_id: str) -> str:
    parsed = urlparse(url)
    query = dict(pair.split("=", 1) for pair in parsed.query.split("&") if pair)
    query["afiliado"] = affiliate_id
    return urlunparse(parsed._replace(query=urlencode(query)))


def extract_product_url(html: str) -> str:
    for match in PRODUCT_PATH_RE.finditer(html):
        url = match.group(0)
        if "/libros/search/" in url:
            continue
        return url
    return ""


def search_buscalibre_by_isbn(isbn: str, *, affiliate_id: str, timeout: int = 25) -> str:
    query = quote_plus(isbn)
    html = fetch_html(SEARCH_URL.format(query=query), timeout=timeout)
    product_url = extract_product_url(html)
    if not product_url:
        return ""
    return with_affiliate(product_url, affiliate_id)


def index_details_by_isbn(details: dict) -> dict[str, dict]:
    by_isbn: dict[str, dict] = {}
    for row in details.get("books") or []:
        if not isinstance(row, dict):
            continue
        isbn = normalize_isbn(row.get("ISBN"))
        book_id = str(row.get("bookId") or "").strip()
        if not isbn or not book_id:
            continue
        by_isbn[isbn] = {
            "bookId": book_id,
            "title": str(row.get("Title") or "").strip(),
        }
    return by_isbn


def index_details_by_book_id(details: dict) -> dict[str, str]:
    by_book_id: dict[str, str] = {}
    for row in details.get("books") or []:
        if not isinstance(row, dict):
            continue
        isbn = normalize_isbn(row.get("ISBN"))
        book_id = str(row.get("bookId") or "").strip()
        if isbn and book_id:
            by_book_id[book_id] = isbn
    return by_book_id


def build_title_index(library: dict, details: dict) -> dict[str, str]:
    """bookId → title (library.json gana sobre library-details)."""
    titles: dict[str, str] = {}
    for row in details.get("books") or []:
        if not isinstance(row, dict):
            continue
        book_id = str(row.get("bookId") or "").strip()
        title = str(row.get("Title") or "").strip()
        if book_id and title:
            titles[book_id] = title
    for book in library.get("books") or []:
        if not isinstance(book, dict):
            continue
        book_id = str(book.get("bookId") or "").strip()
        title = str(book.get("title") or "").strip()
        if book_id and title:
            titles[book_id] = title
    return titles


def build_isbn_title_index(details: dict) -> dict[str, str]:
    titles: dict[str, str] = {}
    for row in details.get("books") or []:
        if not isinstance(row, dict):
            continue
        isbn = normalize_isbn(row.get("ISBN"))
        title = str(row.get("Title") or "").strip()
        if isbn and title:
            titles[isbn] = title
    return titles


def resolve_title(
    book_id: str,
    isbn: str,
    *,
    titles_by_book_id: dict[str, str],
    titles_by_isbn: dict[str, str],
    fallback: str = "",
) -> str:
    if book_id and book_id in titles_by_book_id:
        return titles_by_book_id[book_id]
    isbn_norm = normalize_isbn(isbn)
    if isbn_norm and isbn_norm in titles_by_isbn:
        return titles_by_isbn[isbn_norm]
    return fallback


def enrich_books_with_titles(
    books: dict,
    *,
    titles_by_book_id: dict[str, str],
    titles_by_isbn: dict[str, str],
) -> int:
    updated = 0
    for key, entry in books.items():
        if not isinstance(entry, dict):
            continue
        book_id = str(entry.get("bookId") or "").strip()
        if not book_id and re.fullmatch(r"\d+", str(key)):
            book_id = str(key)
        isbn = str(entry.get("isbn") or "").strip()
        title = resolve_title(
            book_id,
            isbn,
            titles_by_book_id=titles_by_book_id,
            titles_by_isbn=titles_by_isbn,
            fallback=str(entry.get("title") or "").strip(),
        )
        if title and entry.get("title") != title:
            entry["title"] = title
            updated += 1
        elif title and "title" not in entry:
            entry["title"] = title
            updated += 1
    return updated


def index_library_by_isbn(library: dict) -> dict[str, dict]:
    by_isbn: dict[str, dict] = {}
    for book in library.get("books") or []:
        if not isinstance(book, dict):
            continue
        book_id = str(book.get("bookId") or "").strip()
        isbn = normalize_isbn(book.get("isbn"))
        if not book_id or not isbn:
            continue
        by_isbn[isbn] = {
            "bookId": book_id,
            "title": str(book.get("title") or "").strip(),
        }
    return by_isbn


def index_library_by_book_id(library: dict) -> dict[str, dict]:
    by_book_id: dict[str, dict] = {}
    for book in library.get("books") or []:
        if not isinstance(book, dict):
            continue
        book_id = str(book.get("bookId") or "").strip()
        isbn = normalize_isbn(book.get("isbn"))
        if book_id and isbn:
            by_book_id[book_id] = {
                "bookId": book_id,
                "isbn": isbn,
                "title": str(book.get("title") or "").strip(),
            }
    return by_book_id


def collect_targets(
    *,
    library: dict,
    details: dict,
    isbns: list[str],
    book_ids: list[str],
    all_with_isbn: bool,
    missing_from_library: bool,
    existing_buscalibre_ids: set[str],
) -> list[tuple[str, str, str]]:
    by_isbn = index_details_by_isbn(details)
    by_book_id = index_details_by_book_id(details)
    library_isbn = index_library_by_isbn(library)
    library_by_book_id = index_library_by_book_id(library)
    targets: list[tuple[str, str, str]] = []
    seen: set[str] = set()

    def add(book_id: str, isbn: str, title: str = "") -> None:
        if not book_id or not isbn or book_id in seen:
            return
        seen.add(book_id)
        targets.append((book_id, isbn, title))

    for isbn_raw in isbns:
        isbn = normalize_isbn(isbn_raw)
        if not isbn:
            continue
        row = by_isbn.get(isbn)
        if row:
            add(row["bookId"], isbn, row["title"])
        else:
            lib_row = library_isbn.get(isbn)
            if lib_row:
                add(lib_row["bookId"], isbn, lib_row["title"])
            else:
                add("", isbn)

    for book_id in book_ids:
        isbn = by_book_id.get(book_id, "")
        title = ""
        if isbn:
            row = by_isbn.get(isbn, {})
            title = str(row.get("title") or "")
        else:
            lib_row = library_by_book_id.get(book_id)
            if lib_row:
                isbn = lib_row["isbn"]
                title = lib_row["title"]
        if isbn:
            add(book_id, isbn, title)

    if all_with_isbn:
        for isbn, row in sorted(by_isbn.items()):
            add(row["bookId"], isbn, row["title"])

    if missing_from_library:
        for book in library.get("books") or []:
            if not isinstance(book, dict):
                continue
            book_id = str(book.get("bookId") or "").strip()
            isbn = normalize_isbn(book.get("isbn"))
            if not book_id or not isbn or book_id in existing_buscalibre_ids:
                continue
            add(book_id, isbn, str(book.get("title") or ""))

    return targets


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Busca libros en Buscalibre Colombia por ISBN y guarda enlaces "
            "con código de afiliado en info/buscalibre.json."
        )
    )
    parser.add_argument(
        "--library-json",
        default="info/library.json",
        help="Ruta a info/library.json (títulos Goodreads).",
    )
    parser.add_argument(
        "--library-details-json",
        default="info/library-details.json",
        help="Ruta a info/library-details.json.",
    )
    parser.add_argument(
        "--output",
        default="info/buscalibre.json",
        help="Archivo JSON de salida (default: info/buscalibre.json).",
    )
    parser.add_argument(
        "--affiliate-id",
        default=DEFAULT_AFFILIATE_ID,
        help=f"Código de afiliado Buscalibre (default: {DEFAULT_AFFILIATE_ID}).",
    )
    parser.add_argument(
        "--isbn",
        action="append",
        default=[],
        help="ISBN a buscar (puede repetirse).",
    )
    parser.add_argument(
        "--book-id",
        action="append",
        default=[],
        help="bookId de library-details.json a buscar.",
    )
    parser.add_argument(
        "--all-with-isbn",
        action="store_true",
        help="Procesar todos los libros con ISBN en library-details.json.",
    )
    parser.add_argument(
        "--missing-from-library",
        action="store_true",
        help=(
            "Buscar en Buscalibre los libros con ISBN en library.json "
            "que aún no están en info/buscalibre.json."
        ),
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=1.0,
        help="Segundos entre peticiones (default: 1.0).",
    )
    parser.add_argument(
        "--backfill-titles",
        action="store_true",
        help="Solo rellenar títulos en el JSON existente (sin buscar en Buscalibre).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="No escribir el archivo de salida.",
    )
    args = parser.parse_args()

    if (
        not args.isbn
        and not args.book_id
        and not args.all_with_isbn
        and not args.backfill_titles
        and not args.missing_from_library
    ):
        parser.error(
            "Indica --isbn, --book-id, --all-with-isbn, --missing-from-library "
            "o --backfill-titles."
        )

    library_path = Path(args.library_json)
    details_path = Path(args.library_details_json)
    output_path = Path(args.output)
    if not details_path.is_file():
        raise SystemExit(f"No existe: {details_path}")
    if not library_path.is_file():
        raise SystemExit(f"No existe: {library_path}")

    library = load_json(library_path)
    details = load_json(details_path)
    titles_by_book_id = build_title_index(library, details)
    titles_by_isbn = build_isbn_title_index(details)

    existing: dict = {}
    if output_path.is_file():
        existing = load_json(output_path)

    payload = {
        "affiliateId": args.affiliate_id,
        "domain": BUSCALIBRE_DOMAIN,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "books": dict(existing.get("books") or {}),
    }

    if args.backfill_titles:
        updated = enrich_books_with_titles(
            payload["books"],
            titles_by_book_id=titles_by_book_id,
            titles_by_isbn=titles_by_isbn,
        )
        if not args.dry_run:
            save_json(output_path, payload)
        print(f"Títulos actualizados: {updated} de {len(payload['books'])} libros")
        if not args.dry_run:
            print(f"Guardado: {output_path}")
        return 0

    existing_buscalibre_ids = {
        str(key).strip()
        for key in (existing.get("books") or {}).keys()
        if str(key).strip()
    }

    targets = collect_targets(
        library=library,
        details=details,
        isbns=args.isbn,
        book_ids=args.book_id,
        all_with_isbn=args.all_with_isbn,
        missing_from_library=args.missing_from_library,
        existing_buscalibre_ids=existing_buscalibre_ids,
    )
    if not targets:
        raise SystemExit("No hay libros que procesar con los filtros indicados.")

    enrich_books_with_titles(
        payload["books"],
        titles_by_book_id=titles_by_book_id,
        titles_by_isbn=titles_by_isbn,
    )
    if not args.dry_run:
        save_json(output_path, payload)

    ok = 0
    failed: list[str] = []
    total = len(targets)
    print(f"Total: {total} libro(s)\n")

    for index, (book_id, isbn, title) in enumerate(targets, start=1):
        if index > 1 and args.sleep > 0:
            time.sleep(args.sleep)
        label = title or isbn
        remaining = total - index
        if remaining:
            progress = f"[{index}/{total}] (faltan {remaining})"
        else:
            progress = f"[{index}/{total}] (último)"
        print(f"{progress} {label}")
        try:
            url = search_buscalibre_by_isbn(isbn, affiliate_id=args.affiliate_id)
        except (HTTPError, URLError, TimeoutError) as err:
            failed.append(f"{label}: {err}")
            print(f"  ERROR {err}")
            continue

        if not url:
            failed.append(f"{label}: sin resultado en Buscalibre")
            print("  ERROR sin resultado en Buscalibre")
            continue

        key = book_id or f"isbn:{isbn}"
        resolved_title = resolve_title(
            book_id,
            isbn,
            titles_by_book_id=titles_by_book_id,
            titles_by_isbn=titles_by_isbn,
            fallback=title,
        )
        payload["books"][key] = {
            "bookId": book_id,
            "isbn": isbn,
            "title": resolved_title,
            "url": url,
        }
        payload["updatedAt"] = datetime.now(timezone.utc).isoformat()
        ok += 1
        if not args.dry_run:
            save_json(output_path, payload)
            print(f"  OK  {url}")
            print(f"  → guardado en {output_path}")
        else:
            print(f"  OK  {url}")

    if not args.dry_run and ok:
        print(f"\nListo: {ok} enlace(s) en {output_path}")

    if failed:
        print("\nFallos:")
        for item in failed:
            print(f"  - {item}")
        return 1 if ok == 0 else 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
