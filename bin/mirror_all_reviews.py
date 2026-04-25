#!/usr/bin/env python3
"""Mirror all Goodreads reviews listed in info/library.json."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from mirror_first_review import (
    build_local_page,
    extract_page_title,
    extract_review_data_from_rss,
    extract_review_fragment,
    extract_review_id,
    get_bytes,
    get_url,
    is_signin_page,
)

DEFAULT_REFRESH_LATEST = 10


def has_review_url(book: dict) -> bool:
    return "/review/show/" in str(book.get("reviewUrl") or "")


def local_html_path_from_book(book: dict, reviews_dir: Path) -> Path:
    local_url = str(book.get("reviewLocalUrl") or "").strip()
    if local_url.startswith("./"):
        return Path(local_url[2:])
    if local_url:
        return Path(local_url)
    review_id = extract_review_id(str(book.get("reviewUrl") or ""))
    return reviews_dir / f"{review_id}.html"


def build_example_series_from_repeated_author(books: list[dict]) -> dict:
    """Build one example series using the most repeated author in library."""
    author_counts: Counter[str] = Counter()
    for book in books:
        author = str(book.get("author") or "").strip()
        if author:
            author_counts[author] += 1

    top_author = ""
    top_count = 0
    for author, count in author_counts.items():
        if count > top_count:
            top_author = author
            top_count = count

    if top_count < 2 or not top_author:
        return {"series": []}

    author_books = []
    for book in books:
        author = str(book.get("author") or "").strip()
        if author != top_author:
            continue
        book_id = str(book.get("bookId") or "").strip()
        title = str(book.get("title") or "").strip()
        if not book_id or not title:
            continue
        author_books.append(
            {
                "libraryBookId": book_id,
                "title": title,
            }
        )

    if len(author_books) < 2:
        return {"series": []}

    return {
        "series": [
            {
                "name": f"Series by {top_author}",
                "author": top_author,
                "books": author_books,
            }
        ]
    }


def sort_books_latest_first(books: list[dict]) -> list[dict]:
    def key(book: dict) -> tuple[str, str]:
        # Prefer reviewDate when present; fallback to dateRead.
        primary_date = str(book.get("reviewDate") or book.get("dateRead") or "").strip()
        book_id = str(book.get("bookId") or "").strip()
        return (primary_date, book_id)

    return sorted(books, key=key, reverse=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Genera mirror local para TODAS las reseñas en info/library.json."
    )
    parser.add_argument(
        "--library-json",
        default="info/library.json",
        help="Ruta al archivo library.json.",
    )
    parser.add_argument(
        "--reviews-dir",
        default="reviews",
        help="Directorio base para HTMLs de reseñas.",
    )
    parser.add_argument(
        "--cookie",
        default="",
        help="Cookie opcional para scraping autenticado en Goodreads.",
    )
    parser.add_argument(
        "--rss-pages",
        type=int,
        default=80,
        help="Máximo de páginas RSS a consultar para fallback de texto/fecha/portada.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Regenera mirrors aunque ya existan.",
    )
    parser.add_argument(
        "--refresh-latest",
        type=int,
        default=DEFAULT_REFRESH_LATEST,
        help=(
            "Número de reseñas más recientes a regenerar siempre, "
            "incluso si ya existen."
        ),
    )
    args = parser.parse_args()

    library_path = Path(args.library_json)
    if not library_path.exists():
        raise SystemExit(f"Archivo no encontrado: {library_path}")

    reviews_dir = Path(args.reviews_dir)
    reviews_dir.mkdir(parents=True, exist_ok=True)
    covers_dir = reviews_dir / "covers"
    covers_dir.mkdir(parents=True, exist_ok=True)

    with library_path.open("r", encoding="utf-8") as f:
        library = json.load(f)

    books = list(library.get("books") or [])
    candidates = [b for b in books if has_review_url(b)]
    candidates = sort_books_latest_first(candidates)
    total = len(candidates)
    if total == 0:
        print("No hay reseñas en library.json para mirror.")
        return 0

    rss_url = str((library.get("source") or {}).get("rssUrl") or "").strip()
    refresh_latest = max(0, args.refresh_latest)
    print(f"[INFO] Reseñas candidatas: {total}")
    print(f"[INFO] Modo force: {'sí' if args.force else 'no'}")
    print(f"[INFO] Reseñas recientes a refrescar: {refresh_latest}")

    mirrored = 0
    skipped = 0
    errors = 0

    for idx, book in enumerate(candidates, start=1):
        title = str(book.get("title") or "(sin título)")
        review_url = str(book.get("reviewUrl") or "").strip()
        review_id = extract_review_id(review_url)
        out_file = reviews_dir / f"{review_id}.html"
        existing_local = local_html_path_from_book(book, reviews_dir)
        already_mirrored = existing_local.exists() and bool(book.get("reviewLocalStatus") == "ok")

        is_latest_window = idx <= refresh_latest
        if already_mirrored and not args.force and not is_latest_window:
            skipped += 1
            print(f"[{idx}/{total}] SKIP | {title}")
            continue

        try:
            review_html = get_url(review_url, cookie=args.cookie)
            review_fragment = extract_review_fragment(review_html)
            page_title = extract_page_title(review_html)

            rss_data = {"review_text": "", "review_date": "", "cover_url": ""}
            if rss_url:
                rss_data = extract_review_data_from_rss(
                    rss_url=rss_url,
                    review_url=review_url,
                    max_pages=max(1, args.rss_pages),
                    cookie=args.cookie,
                )

            if not review_fragment:
                review_fragment = str(rss_data.get("review_text") or "").strip()
            review_date = str(rss_data.get("review_date") or "").strip()
            cover_url = str(rss_data.get("cover_url") or "").strip()

            if is_signin_page(page_title):
                page_title = "Reseña en Goodreads (mirror local)"

            local_cover_url = ""
            local_cover_src = ""
            if cover_url:
                cover_ext = Path(urlparse(cover_url).path).suffix.lower() or ".jpg"
                if cover_ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
                    cover_ext = ".jpg"
                cover_path = covers_dir / f"{review_id}{cover_ext}"
                cover_path.write_bytes(get_bytes(cover_url, cookie=args.cookie))
                local_cover_url = f"./{covers_dir.as_posix()}/{cover_path.name}"
                local_cover_src = f"./covers/{cover_path.name}"

            local_page = build_local_page(
                book=book,
                review_url=review_url,
                review_fragment=review_fragment,
                review_date=review_date,
                local_cover_src=local_cover_src,
                page_title=page_title,
            )
            out_file.write_text(local_page, encoding="utf-8")

            book["reviewLocalUrl"] = f"./{reviews_dir.as_posix()}/{out_file.name}"
            if local_cover_url:
                book["reviewLocalCoverUrl"] = local_cover_url
            if review_date:
                book["reviewDate"] = review_date
            book["reviewLocalStatus"] = "ok"
            book["reviewLocalGeneratedAt"] = datetime.now(timezone.utc).isoformat()

            mirrored += 1
            print(f"[{idx}/{total}] OK   | {title}")
        except Exception as err:
            errors += 1
            book["reviewLocalStatus"] = f"error: {err}"
            print(f"[{idx}/{total}] ERROR| {title} | {err}")

    with library_path.open("w", encoding="utf-8") as f:
        json.dump(library, f, ensure_ascii=False, indent=2)
        f.write("\n")

    # Preserve custom book series if the file already exists.
    # Only create an example file on first run.
    series_path = library_path.parent / "book_series.json"
    series_created = False
    if not series_path.exists():
        series_data = build_example_series_from_repeated_author(books)
        with series_path.open("w", encoding="utf-8") as f:
            json.dump(series_data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        series_created = True

    print("")
    print("[RESUMEN]")
    print(f"- Mirror nuevos/regenerados: {mirrored}")
    print(f"- Skipped: {skipped}")
    print(f"- Errores: {errors}")
    print(f"- Archivo actualizado: {library_path}")
    if series_created:
        print(f"- Series de ejemplo creadas: {series_path}")
    else:
        print(f"- Series preservadas (no sobreescritas): {series_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
