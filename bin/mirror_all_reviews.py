#!/usr/bin/env python3
"""Mirror all Goodreads reviews listed in info/library.json.

HTML layout (incl. menú de secciones de biblioteca) viene de
``mirror_first_review.build_local_page`` / ``REVIEW_PAGE_LIBRARY_SUBNAV_HTML``.
Para insertar solo el menú en mirrors antiguos: ``python3 update/deprecated-bin/inject_review_library_nav.py``.
"""

from __future__ import annotations

import argparse
import html
import json
import re
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from mirror_first_review import (
    DEFAULT_SITE_BASE_URL,
    SHARE_BUTTON_HTML,
    SUBSCRIBE_HEADER_BUTTON_HTML,
    build_local_page,
    extract_page_title,
    extract_review_data_from_rss,
    extract_review_fragment,
    extract_review_id,
    get_bytes,
    get_url,
    is_disallowed_share_url,
    is_shortened_share_url,
    is_signin_page,
    patch_review_html_subscribe,
    resolve_share_url,
)
from review_date_policy import review_date_for_mirror_html
from review_word_count import (
    apply_review_counts_to_books,
    is_review_extraction_failed,
    is_review_html_extraction_failed,
)

DEFAULT_REFRESH_LATEST = 10
DEFAULT_RETRY_FAILED_EXTRACTION_DAYS = 180
CACHE_PATH_DEFAULT = Path("update/share-url-cache.json")


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


def review_primary_date(book: dict) -> str:
    return str(book.get("reviewDate") or book.get("dateRead") or "").strip()[:10]


def review_date_within_days(book: dict, max_days: int) -> bool:
    """True si reviewDate/dateRead cae dentro de los últimos max_days (inclusive hoy)."""
    if max_days <= 0:
        return True
    raw = review_primary_date(book)
    if not raw:
        return False
    try:
        review_day = datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return False
    return (date.today() - review_day).days <= max_days


def should_retry_failed_extraction(
    book: dict,
    local_html_abs: Path,
    *,
    max_days: int,
) -> bool:
    """Reintenta mirrors cuyo HTML local solo tiene el placeholder de extracción."""
    if max_days < 0:
        return False
    if not local_html_abs.exists():
        return False
    if not is_review_html_extraction_failed(local_html_abs):
        return False
    return review_date_within_days(book, max_days)


def _extract_share_url_meta(html_text: str) -> str:
    match = re.search(
        r'<meta\s+name="share-url"\s+content="([^"]*)"',
        html_text,
        flags=re.IGNORECASE,
    )
    return match.group(1).strip() if match else ""


def _patch_review_html_share(html_text: str, share_url: str) -> str:
    """Inject meta share-url + share button into an existing reviews/*.html.

    Designed to be idempotent and not touch the review body.
    """
    share_url = (share_url or "").strip()
    if not share_url.startswith(("http://", "https://")):
        return patch_review_html_subscribe(html_text)

    safe_share = html.escape(share_url, quote=True)
    updated = html_text
    if 'meta name="share-url"' in updated:
        updated2, n = re.subn(
            r'<meta\s+name="share-url"\s+content="[^"]*"\s*/>',
            f'<meta name="share-url" content="{safe_share}" />',
            updated,
            count=1,
            flags=re.IGNORECASE,
        )
        if n:
            updated = updated2
    else:
        meta_line = f'  <meta name="share-url" content="{safe_share}" />\n'
        # Insert right after the color-scheme meta (present on all generated review pages).
        updated2, n = re.subn(
            r'(\n  <meta name="color-scheme"[^>]*>\n)',
            r"\1" + meta_line,
            updated,
            count=1,
            flags=re.IGNORECASE,
        )
        updated = updated2 if n else (meta_line + updated)

    if "data-share-copy" not in updated:
        updated = re.sub(
            r'<p class="review-by">\s*Reseña por Jorge I\. Zuluaga\s*</p>',
            '<p class="review-by">\n'
            '          Reseña por Jorge I. Zuluaga\n'
            f"          {SHARE_BUTTON_HTML}\n"
            f"          {SUBSCRIBE_HEADER_BUTTON_HTML}\n"
            "        </p>",
            updated,
            count=1,
            flags=re.IGNORECASE,
        )
    return patch_review_html_subscribe(updated)


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
    parser.add_argument(
        "--site-base-url",
        default=DEFAULT_SITE_BASE_URL,
        help="Base URL pública del sitio para metadatos de compartir (Open Graph).",
    )
    parser.add_argument(
        "--retry-failed-extraction-days",
        type=int,
        default=-1,
        metavar="N",
        help=(
            "Reintenta descargar mirrors con placeholder de extracción fallida. "
            "N=0 reintenta todos; N>0 solo si reviewDate/dateRead cae en los "
            "últimos N días; default -1 desactivado (salvo en sync diario)."
        ),
    )
    parser.add_argument(
        "--only-placeholders",
        action="store_true",
        help=(
            "Regenera solo reseñas cuyo mirror local tiene el placeholder "
            "de extracción fallida; no toca reseñas con texto ya descargado."
        ),
    )
    parser.add_argument(
        "--patch-share-only",
        action="store_true",
        help=(
            "NO descarga Goodreads. Solo parchea reviews/*.html existentes "
            "para inyectar share-url (is.gd) y el botón Compartir si faltan."
        ),
    )
    parser.add_argument(
        "--share-cache",
        default=str(CACHE_PATH_DEFAULT),
        help="Ruta JSON para cachear share-url (default: update/share-url-cache.json).",
    )
    args = parser.parse_args()
    if args.only_placeholders and args.patch_share_only:
        raise SystemExit("--only-placeholders no se combina con --patch-share-only")
    if args.only_placeholders and args.force:
        print("[INFO] --force ignorado con --only-placeholders.", flush=True)

    library_path = Path(args.library_json)
    if not library_path.exists():
        raise SystemExit(f"Archivo no encontrado: {library_path}")

    repo_root = library_path.resolve().parent.parent
    reviews_dir = Path(args.reviews_dir)
    reviews_dir.mkdir(parents=True, exist_ok=True)
    covers_dir = reviews_dir / "covers"
    covers_dir.mkdir(parents=True, exist_ok=True)

    print(f"[mirror] Cargando {library_path} …", flush=True)
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
    site_base_url = str(args.site_base_url or DEFAULT_SITE_BASE_URL).rstrip("/")
    refresh_latest = max(0, args.refresh_latest)
    retry_failed_days = args.retry_failed_extraction_days
    print(f"[INFO] Reseñas candidatas: {total}")
    print(f"[INFO] Modo force: {'sí' if args.force else 'no'}")
    print(f"[INFO] Solo placeholders: {'sí' if args.only_placeholders else 'no'}")
    print(f"[INFO] Reseñas recientes a refrescar: {refresh_latest}")
    if retry_failed_days >= 0:
        if retry_failed_days == 0:
            print("[INFO] Reintento placeholders: todos", flush=True)
        else:
            print(
                f"[INFO] Reintento placeholders: últimos {retry_failed_days} días",
                flush=True,
            )
    else:
        print("[INFO] Reintento placeholders: no", flush=True)
    print(f"[INFO] Patch share only: {'sí' if args.patch_share_only else 'no'}")

    mirrored = 0
    skipped = 0
    errors = 0
    placeholder_retries = 0

    # Cache share URLs (avoid calling is.gd repeatedly).
    share_cache_path = Path(args.share_cache)
    share_cache: dict[str, str] = {}
    try:
        if share_cache_path.exists():
            share_cache = json.loads(share_cache_path.read_text(encoding="utf-8")) or {}
            if not isinstance(share_cache, dict):
                share_cache = {}
    except Exception:
        share_cache = {}

    for idx, book in enumerate(candidates, start=1):
        title = str(book.get("title") or "(sin título)")
        review_url = str(book.get("reviewUrl") or "").strip()
        review_id = extract_review_id(review_url)
        out_file = reviews_dir / f"{review_id}.html"
        existing_local = local_html_path_from_book(book, reviews_dir)
        local_html_abs = (repo_root / out_file).resolve()
        alt_local = (repo_root / existing_local).resolve()
        if alt_local.exists():
            local_html_abs = alt_local
        already_mirrored = local_html_abs.exists() and bool(book.get("reviewLocalStatus") == "ok")

        if args.only_placeholders:
            if not local_html_abs.exists():
                skipped += 1
                print(f"[{idx}/{total}] SKIP | {title} | (sin HTML local)", flush=True)
                continue
            if not is_review_html_extraction_failed(local_html_abs):
                skipped += 1
                print(f"[{idx}/{total}] SKIP | {title} | (contenido ya extraído)", flush=True)
                continue

        retry_placeholder = should_retry_failed_extraction(
            book,
            local_html_abs,
            max_days=0 if args.only_placeholders else retry_failed_days,
        )

        review_page_url = f"{site_base_url}/reviews/{review_id}.html"
        cached_share = (share_cache.get(review_page_url) or "").strip()
        if is_disallowed_share_url(cached_share):
            cached_share = ""
        share_url = resolve_share_url(review_page_url, cached_share)
        if (args.only_placeholders or retry_placeholder) and local_html_abs.exists():
            try:
                file_share = _extract_share_url_meta(
                    local_html_abs.read_text(encoding="utf-8")
                )
                if is_shortened_share_url(file_share):
                    share_url = resolve_share_url(review_page_url, file_share)
            except OSError:
                pass
        if is_shortened_share_url(share_url):
            share_cache[review_page_url] = share_url
        elif review_page_url in share_cache and is_disallowed_share_url(
            share_cache.get(review_page_url, "")
        ):
            del share_cache[review_page_url]

        if args.patch_share_only:
            target_file = out_file if out_file.exists() else existing_local
            if not target_file.exists():
                skipped += 1
                print(f"[{idx}/{total}] SKIP | {title} | (sin HTML local)", flush=True)
                continue
            try:
                original = target_file.read_text(encoding="utf-8")
                existing_meta = _extract_share_url_meta(original)
                patch_share_url = share_url
                if not is_shortened_share_url(patch_share_url) and is_disallowed_share_url(
                    existing_meta
                ):
                    patch_share_url = review_page_url
                if (
                    not is_shortened_share_url(patch_share_url)
                    and patch_share_url == existing_meta
                ):
                    skipped += 1
                    print(
                        f"[{idx}/{total}] OK   | {title} | (sin enlace corto is.gd/v.gd)",
                        flush=True,
                    )
                    continue
                patched = _patch_review_html_share(original, share_url=patch_share_url)
                if patched != original:
                    target_file.write_text(patched, encoding="utf-8")
                    mirrored += 1
                    print(f"[{idx}/{total}] PATCH| {title}", flush=True)
                else:
                    skipped += 1
                    print(f"[{idx}/{total}] OK   | {title} | (ya tenía compartir)", flush=True)
            except Exception as err:
                errors += 1
                print(f"[{idx}/{total}] ERROR| {title} | {err}", flush=True)
            continue

        is_latest_window = idx <= refresh_latest
        if (
            not args.only_placeholders
            and already_mirrored
            and not args.force
            and not is_latest_window
            and not retry_placeholder
        ):
            if out_file.exists():
                book.setdefault(
                    "reviewLocalUrl",
                    f"./{reviews_dir.as_posix()}/{out_file.name}",
                )
            skipped += 1
            print(f"[{idx}/{total}] SKIP | {title}", flush=True)
            continue

        if retry_placeholder and not is_latest_window:
            placeholder_retries += 1
            print(
                f"[{idx}/{total}] RETRY| {title} | (placeholder, reintento de extracción)",
                flush=True,
            )

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
                if review_fragment and is_signin_page(page_title):
                    print(
                        "[mirror] Texto tomado del RSS (la página de Goodreads exige iniciar sesión).",
                        flush=True,
                    )
            rss_review_date = str(rss_data.get("review_date") or "").strip()
            if review_fragment and not is_review_extraction_failed(review_fragment):
                review_date = review_date_for_mirror_html(
                    book,
                    review_text=review_fragment,
                    rss_review_date=rss_review_date,
                )
            else:
                review_date = (
                    str(book.get("reviewDate") or "").strip()
                    or rss_review_date
                )
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

            og_image_url = f"{site_base_url}/assets/profile.jpg"
            if local_cover_src:
                og_image_url = f"{site_base_url}/reviews/{local_cover_src[2:]}"

            local_page = build_local_page(
                book=book,
                review_url=review_url,
                review_fragment=review_fragment,
                review_date=review_date,
                local_cover_src=local_cover_src,
                review_page_url=review_page_url,
                og_image_url=og_image_url,
                page_title=page_title,
                share_url=share_url,
            )
            out_file.write_text(local_page, encoding="utf-8")

            book["reviewLocalUrl"] = f"./{reviews_dir.as_posix()}/{out_file.name}"
            if local_cover_url:
                book["reviewLocalCoverUrl"] = local_cover_url
            book["reviewLocalStatus"] = "ok"
            book["reviewLocalGeneratedAt"] = datetime.now(timezone.utc).isoformat()

            mirrored += 1
            print(f"[{idx}/{total}] OK   | {title}", flush=True)
        except Exception as err:
            errors += 1
            book["reviewLocalStatus"] = f"error: {err}"
            print(f"[{idx}/{total}] ERROR| {title} | {err}", flush=True)

    if not args.patch_share_only:
        apply_review_counts_to_books(
            books,
            repo_root=repo_root,
            reviews_dir_name=reviews_dir.as_posix(),
        )

        with library_path.open("w", encoding="utf-8") as f:
            json.dump(library, f, ensure_ascii=False, indent=2)
            f.write("\n")

    # Persist share cache (even in patch-only mode).
    try:
        share_cache_path.parent.mkdir(parents=True, exist_ok=True)
        share_cache_path.write_text(
            json.dumps(share_cache, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except Exception:
        pass

    # Preserve custom book series if the file already exists.
    # Only create an example file on first run.
    series_path = library_path.parent / "book_series.json"
    series_created = False
    if not args.patch_share_only and not series_path.exists():
        series_data = build_example_series_from_repeated_author(books)
        with series_path.open("w", encoding="utf-8") as f:
            json.dump(series_data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        series_created = True

    print("")
    print("[RESUMEN]")
    print(f"- Mirror nuevos/regenerados: {mirrored}")
    print(f"- Reintentos por placeholder: {placeholder_retries}")
    print(f"- Skipped: {skipped}")
    print(f"- Errores: {errors}")
    if not args.patch_share_only:
        print(f"- Archivo actualizado: {library_path}")
        if series_created:
            print(f"- Series de ejemplo creadas: {series_path}")
        else:
            print(f"- Series preservadas (no sobreescritas): {series_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
