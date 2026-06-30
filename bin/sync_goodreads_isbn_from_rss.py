#!/usr/bin/env python3
"""Sync book ISBNs from Goodreads list RSS into info/library.json."""

from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, payload: dict) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")


def normalize_isbn(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    return re.sub(r"[^0-9Xx]", "", raw).upper()


def isbn10_to_isbn13(isbn10: str) -> str:
    core = "978" + isbn10[:-1]
    total = 0
    for idx, char in enumerate(core):
        total += int(char) * (1 if idx % 2 == 0 else 3)
    check = (10 - total % 10) % 10
    return core + str(check)


def to_isbn13(value: object) -> str:
    raw = normalize_isbn(value)
    if not raw:
        return ""
    if len(raw) == 13:
        return raw
    if len(raw) == 10:
        return isbn10_to_isbn13(raw)
    return raw


def with_page(rss_url: str, page: int) -> str:
    parsed = urlparse(rss_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["page"] = str(page)
    return urlunparse(parsed._replace(query=urlencode(query)))


def fetch_rss_page(url: str, *, cookie: str = "", timeout: int = 25) -> str:
    headers = {"User-Agent": USER_AGENT}
    if cookie:
        headers["Cookie"] = cookie
    req = Request(url, headers=headers)
    with urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def collect_isbn_by_book_id(
    rss_url: str,
    *,
    max_pages: int,
    cookie: str = "",
) -> dict[str, str]:
    by_book_id: dict[str, str] = {}
    for page in range(1, max_pages + 1):
        xml_text = fetch_rss_page(with_page(rss_url, page), cookie=cookie)
        root = ET.fromstring(xml_text)
        items = root.findall("./channel/item")
        if not items:
            break
        for item in items:
            book_id = str(item.findtext("book_id") or "").strip()
            isbn_raw = str(item.findtext("isbn") or "").strip()
            if not book_id or not isbn_raw:
                continue
            isbn13 = to_isbn13(isbn_raw)
            if isbn13:
                by_book_id[book_id] = isbn13
    return by_book_id


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Lee ISBN de cada libro desde el RSS de Goodreads "
            "(campo <isbn>) y los guarda en info/library.json."
        )
    )
    parser.add_argument(
        "--library-json",
        default="info/library.json",
        help="Ruta a info/library.json.",
    )
    parser.add_argument(
        "--rss-url",
        default="",
        help="URL del RSS (default: source.rssUrl en library.json).",
    )
    parser.add_argument(
        "--rss-pages",
        type=int,
        default=100,
        help="Páginas máximas del RSS a recorrer (default: 100).",
    )
    parser.add_argument(
        "--cookie",
        default="",
        help="Cookie opcional (normalmente no hace falta para el RSS).",
    )
    parser.add_argument(
        "--book-id",
        action="append",
        default=[],
        help="Solo procesar estos bookId de Goodreads.",
    )
    parser.add_argument(
        "--all-missing",
        action="store_true",
        help="Actualizar libros sin campo isbn en library.json.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Mostrar cambios sin escribir library.json.",
    )
    args = parser.parse_args()

    if not args.book_id and not args.all_missing:
        parser.error("Indica --book-id o --all-missing.")

    library_path = Path(args.library_json)
    if not library_path.is_file():
        raise SystemExit(f"No existe: {library_path}")

    library = load_json(library_path)
    rss_url = str(args.rss_url or (library.get("source") or {}).get("rssUrl") or "").strip()
    if not rss_url:
        raise SystemExit("RSS URL vacío. Pásalo con --rss-url o en library.json → source.rssUrl.")

    print(f"Descargando ISBN desde RSS (≤{args.rss_pages} páginas)…")
    isbn_by_book_id = collect_isbn_by_book_id(
        rss_url,
        max_pages=max(1, args.rss_pages),
        cookie=args.cookie,
    )
    print(f"ISBN encontrados en RSS: {len(isbn_by_book_id)}")

    target_ids: set[str] = set()
    if args.book_id:
        target_ids.update(str(book_id).strip() for book_id in args.book_id if str(book_id).strip())
    if args.all_missing:
        for book in library.get("books") or []:
            if not isinstance(book, dict):
                continue
            book_id = str(book.get("bookId") or "").strip()
            if book_id and not str(book.get("isbn") or "").strip():
                target_ids.add(book_id)

    updated = 0
    missing_in_rss: list[str] = []
    for book in library.get("books") or []:
        if not isinstance(book, dict):
            continue
        book_id = str(book.get("bookId") or "").strip()
        if book_id not in target_ids:
            continue
        isbn = isbn_by_book_id.get(book_id, "")
        if not isbn:
            title = str(book.get("title") or book_id)
            missing_in_rss.append(title)
            continue
        current = str(book.get("isbn") or "").strip()
        if current == isbn:
            print(f"= {book_id}  {isbn}  ({book.get('title', '')})")
            continue
        book["isbn"] = isbn
        updated += 1
        action = "→" if current else "+"
        print(f"{action} {book_id}  {current or '(vacío)'} → {isbn}  ({book.get('title', '')})")

    if missing_in_rss:
        print("\nSin ISBN en RSS:")
        for title in missing_in_rss:
            print(f"  - {title}")

    if not args.dry_run and updated:
        save_json(library_path, library)
        print(f"\nGuardado: {library_path} ({updated} actualizaciones)")
    elif args.dry_run:
        print(f"\nDry-run: {updated} cambio(s), sin escribir archivo.")
    else:
        print("\nSin cambios.")

    return 0 if not missing_in_rss or updated else 1


if __name__ == "__main__":
    raise SystemExit(main())
