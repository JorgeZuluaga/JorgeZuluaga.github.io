#!/usr/bin/env python3
"""Build info/library.json from Goodreads RSS (+ optional likes scraping)."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

from mirror_first_review import extract_review_text_from_description


USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
)


def progress(msg: str, *, quiet: bool = False) -> None:
    if quiet:
        return
    print(msg, flush=True)


def progress_verbose(msg: str, *, verbose: bool = False) -> None:
    if not verbose:
        return
    print(msg, flush=True)


def get_url(url: str, cookie: str = "", timeout: int = 20) -> str:
    headers = {"User-Agent": USER_AGENT}
    if cookie:
        headers["Cookie"] = cookie
    req = Request(url, headers=headers)
    with urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_rss(rss_text: str) -> ET.Element:
    return ET.fromstring(rss_text)


def parse_read_date(value: str) -> str:
    # Goodreads RSS usually uses: "Tue, 14 Jan 2026 06:50:39 -0800"
    raw = (value or "").strip()
    if not raw:
        return ""
    try:
        dt = datetime.strptime(raw, "%a, %d %b %Y %H:%M:%S %z")
        return dt.date().isoformat()
    except ValueError:
        return raw


def resolve_date_read(item: ET.Element) -> str:
    """Fecha en que Goodreads registra «Date read» (no fecha añadido al feed ni pubDate)."""
    raw = (item.findtext("user_read_at") or "").strip()
    if not raw:
        return ""
    return parse_read_date(raw) or ""


def is_read_item(
    user_shelves: str,
    user_read_at: str,
    user_rating: int,
) -> bool:
    shelves = [s.strip().lower() for s in (user_shelves or "").split(",") if s.strip()]
    # Goodreads RSS is inconsistent across accounts:
    # - Some feeds omit user_shelves and user_read_at for read books
    # - user_rating is often present and >0 for books the user has read
    if bool(user_read_at.strip()) or ("read" in shelves) or (user_rating > 0):
        return True
    return False


def rss_has_review_body(item: ET.Element, user_review: str) -> bool:
    """Hay texto de reseña en el feed (Goodreads crea URL /review/show/ aun sin texto)."""
    if (user_review or "").strip():
        return True
    desc = (item.findtext("description") or "").strip()
    return bool(extract_review_text_from_description(desc))


def extract_like_count(html: str) -> int:
    patterns = [
        r'"likesCount"\s*:\s*(\d+)',
        r'"reviewLikesCount"\s*:\s*(\d+)',
        r'<span[^>]*class=["\']likesCount["\'][^>]*>\s*(\d+)\s+like',
        r'(\d+)\s+people\s+liked\s+this',
        r'(\d+)\s+likes?\s+on\s+this\s+review',
        r'(\d+)\s+likes?\s+this\s+review',
        r'this\s+review[^0-9]{0,40}(\d+)\s+likes?',
    ]
    for pattern in patterns:
        m = re.search(pattern, html, flags=re.IGNORECASE)
        if m:
            try:
                return int(m.group(1))
            except (ValueError, IndexError):
                pass
    return 0


def with_page(rss_url: str, page: int) -> str:
    u = urlparse(rss_url)
    q = dict(parse_qsl(u.query, keep_blank_values=True))
    q["page"] = str(page)
    return urlunparse((u.scheme, u.netloc, u.path, u.params, urlencode(q), u.fragment))


def fetch_rss_items(
    rss_url: str,
    max_pages: int,
    *,
    verbose: bool = False,
    quiet: bool = False,
) -> list[ET.Element]:
    all_items: list[ET.Element] = []
    progress(f"[RSS] Leyendo hasta {max_pages} página(s) del feed…", quiet=quiet)
    for page in range(1, max_pages + 1):
        page_url = with_page(rss_url, page)
        progress_verbose(f"[RSS] GET página {page}/{max_pages} …", verbose=verbose)
        rss_text = get_url(page_url, cookie="")
        root = parse_rss(rss_text)
        items = root.findall("./channel/item")
        if not items:
            progress(f"[RSS] Página {page} sin ítems → fin de paginación.", quiet=quiet)
            break
        all_items.extend(items)
        progress(
            f"[RSS] Página {page}/{max_pages}: +{len(items)} ítems (total {len(all_items)})",
            quiet=quiet,
        )
    return all_items


def load_existing_books(path: str) -> dict[str, dict]:
    existing_path = Path(path)
    if not existing_path.exists():
        return {}
    try:
        with existing_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}
    books = list(data.get("books") or [])
    by_id: dict[str, dict] = {}
    for book in books:
        book_id = str(book.get("bookId") or "").strip()
        if book_id:
            by_id[book_id] = book
    return by_id


def load_details_book_ids(path: str) -> set[str]:
    details_path = Path(path)
    if not details_path.exists():
        return set()
    try:
        with details_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return set()
    books = list(data.get("books") or [])
    return {
        str(book.get("bookId") or "").strip()
        for book in books
        if str(book.get("bookId") or "").strip()
    }


def build_library_data(
    rss_url: str,
    scrape_likes_mode: str,
    cookie: str,
    max_rss_pages: int,
    merge_from: str = "",
    library_details_json: str = "info/library-details.json",
    verbose: bool = False,
    quiet: bool = False,
    preserve_existing_titles: bool = False,
) -> dict:
    rss_items = fetch_rss_items(
        rss_url, max_rss_pages, verbose=verbose, quiet=quiet
    )
    progress(f"[RSS] Total ítems en memoria: {len(rss_items)}", quiet=quiet)

    existing_by_id = load_existing_books(merge_from) if merge_from else {}
    if merge_from:
        progress(
            f"[MERGE] Biblioteca previa: {len(existing_by_id)} libros con bookId",
            quiet=quiet,
        )
        progress_verbose(
            f"[MERGE] Detalle claves: {len(existing_by_id)}",
            verbose=verbose,
        )
    details_book_ids = load_details_book_ids(library_details_json)
    progress(
        f"[DETAILS] bookId en {library_details_json}: {len(details_book_ids)}",
        quiet=quiet,
    )

    books = []
    seen_ids: set[str] = set()
    rss_skipped_not_read_ids: set[str] = set()
    scrape_queue: list[dict] = []
    for item in rss_items:
        book_id = (item.findtext("book_id") or "").strip()
        if not book_id or book_id in seen_ids:
            continue
        title = (item.findtext("title") or "").strip()
        author = (item.findtext("author_name") or "").strip()
        user_read_at_raw = (item.findtext("user_read_at") or "").strip()
        user_shelves = (item.findtext("user_shelves") or "").strip()
        rating_raw = (item.findtext("user_rating") or "").strip()
        review_url = (item.findtext("link") or "").strip()
        user_review = (item.findtext("user_review") or "").strip()

        try:
            rating = int(rating_raw) if rating_raw else 0
        except ValueError:
            rating = 0

        if not is_read_item(user_shelves, user_read_at_raw, rating):
            rss_skipped_not_read_ids.add(book_id)
            continue

        seen_ids.add(book_id)

        # Goodreads asigna URL /review/show/ incluso sin texto; hasReview solo si hay cuerpo en el RSS.
        has_review_page = "/review/show/" in review_url
        has_review_body = rss_has_review_body(item, user_review)
        has_review = bool(has_review_page and has_review_body)
        review_likes = 0
        scrape_status = "not_requested"
        existing = existing_by_id.get(book_id)
        is_new = existing is None

        if existing:
            # Never overwrite drzrating from RSS/sync — it is user- or script-maintained.
            preserved_drz = (
                existing["drzrating"]
                if "drzrating" in existing
                else -1
            )
            entry = dict(existing)
            existing_review_url = str(entry.get("reviewUrl") or "").strip()

            # Si el RSS trae texto de reseña, sincroniza hasReview; si no, refleja ausencia de texto.
            effective_has_review = has_review
            if has_review_page:
                effective_review_url = review_url
            elif existing_review_url and "/review/show/" in existing_review_url:
                effective_review_url = existing_review_url
            else:
                effective_review_url = ""

            # Overwrite fields that come from RSS so we keep data fresh.
            preserved_title = str(existing.get("title") or "").strip()
            resolved_read = resolve_date_read(item)
            prev_read = str(existing.get("dateRead") or "").strip()
            date_read_out = resolved_read if resolved_read else prev_read
            entry.update(
                {
                    "bookId": book_id,
                    "title": title,
                    "author": author,
                    "dateRead": date_read_out,
                    "rating": rating,
                    "reviewUrl": effective_review_url,
                    "hasReview": effective_has_review,
                }
            )
            if preserve_existing_titles and preserved_title:
                entry["title"] = preserved_title
            if "reviewLikes" not in entry:
                entry["reviewLikes"] = review_likes
            if "scrapeStatus" not in entry:
                entry["scrapeStatus"] = scrape_status
            entry["drzrating"] = preserved_drz
        else:
            entry = {
                "bookId": book_id,
                "title": title,
                "author": author,
                "dateRead": resolve_date_read(item),
                "rating": rating,
                "reviewUrl": review_url if has_review_page else "",
                "hasReview": has_review,
                "reviewLikes": review_likes,
                "scrapeStatus": scrape_status,
                "drzrating": -1,
            }
        entry["bookDetails"] = 1 if book_id in details_book_ids else 0

        books.append(entry)
        should_scrape_likes = False
        entry_has_review = "/review/show/" in str(entry.get("reviewUrl") or "")
        if entry_has_review and scrape_likes_mode == "all":
            should_scrape_likes = True
        elif entry_has_review and scrape_likes_mode == "new" and is_new:
            should_scrape_likes = True
        if should_scrape_likes:
            scrape_queue.append(entry)

    progress(
        f"[LIBROS] Entradas leídas armadas: {len(books)} | "
        f"cola scrape likes: {len(scrape_queue)}",
        quiet=quiet,
    )

    if scrape_queue:
        total = len(scrape_queue)
        cookie_hint = "con cookie" if cookie.strip() else "sin cookie (p. ej. likes en 0)"
        progress(f"[SCRAPE] Descargando {total} página(s) de reseña ({cookie_hint})…", quiet=quiet)
        for idx, entry in enumerate(scrape_queue, start=1):
            title_short = (entry.get("title") or "")[:72]
            try:
                review_html = get_url(entry["reviewUrl"], cookie=cookie)
                entry["reviewLikes"] = extract_like_count(review_html)
                entry["scrapeStatus"] = "ok"
            except (HTTPError, URLError, TimeoutError) as err:
                entry["scrapeStatus"] = f"error: {err}"
            remaining = total - idx
            progress(
                f"[SCRAPE] {idx}/{total} likes={entry['reviewLikes']} "
                f"restan={remaining} | {title_short}",
                quiet=quiet,
            )
            progress_verbose(
                f"[SCRAPE] URL {entry.get('reviewUrl', '')[:100]}",
                verbose=verbose,
            )
    elif scrape_likes_mode != "none":
        progress("[SCRAPE] Sin reseñas que requieran scrape de likes.", quiet=quiet)

    # Keep older books not present in fetched RSS window to avoid data loss.
    for existing_id, existing_entry in existing_by_id.items():
        if existing_id in seen_ids:
            continue
        if existing_id in rss_skipped_not_read_ids:
            continue
        books.append(dict(existing_entry))

    books.sort(key=lambda b: (b.get("dateRead") or ""), reverse=True)

    progress(
        f"[LISTO] {len(books)} libros tras fusionar RSS + conservar fuera de ventana.",
        quiet=quiet,
    )

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "rssUrl": rss_url,
            "scrapeLikes": scrape_likes_mode != "none",
            "scrapeLikesMode": scrape_likes_mode,
        },
        "books": books,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build info/library.json from Goodreads RSS feed."
    )
    parser.add_argument(
        "--rss-url",
        required=True,
        help="Goodreads list RSS URL (review/list_rss/...).",
    )
    parser.add_argument(
        "--out",
        default="info/library.json",
        help="Output JSON file.",
    )
    parser.add_argument(
        "--scrape-likes-mode",
        choices=("none", "new", "all"),
        default="none",
        help=(
            "Política de likes: none (no scrape), new (solo libros nuevos), "
            "all (todos los libros con reseña)."
        ),
    )
    parser.add_argument(
        "--scrape-likes",
        action="store_true",
        help="Compatibilidad: equivalente a --scrape-likes-mode=all.",
    )
    parser.add_argument(
        "--cookie",
        default="",
        help="Cookie header value for authenticated scraping (optional).",
    )
    parser.add_argument(
        "--rss-pages",
        type=int,
        default=1,
        help="Número máximo de páginas RSS a leer (Goodreads pagina resultados).",
    )
    parser.add_argument(
        "--merge-from",
        default="",
        help=(
            "Ruta a un library.json existente para mantener campos previos "
            "(likes/reviewLocal*), y detectar libros nuevos."
        ),
    )
    parser.add_argument(
        "--library-details-json",
        default="info/library-details.json",
        help="Ruta a info/library-details.json para marcar el campo bookDetails (0/1).",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Más detalle de depuración (URLs, merge extra).",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Solo mensaje final; oculta RSS/scrape paso a paso.",
    )
    parser.add_argument(
        "--preserve-existing-titles",
        action="store_true",
        help=(
            "Si hay merge desde --merge-from, no sobrescribe el campo title de libros "
            "que ya estaban en el JSON (Goodreads RSS a veces altera títulos)."
        ),
    )
    args = parser.parse_args()
    scrape_likes_mode = "all" if args.scrape_likes else args.scrape_likes_mode
    quiet = bool(args.quiet)

    progress(
        f"[INICIO] build_library_from_goodreads — rss-pages={max(1, args.rss_pages)} "
        f"likes={scrape_likes_mode} merge={args.merge_from or '(no)'} → {args.out}",
        quiet=quiet,
    )

    data = build_library_data(
        rss_url=args.rss_url,
        scrape_likes_mode=scrape_likes_mode,
        cookie=args.cookie,
        max_rss_pages=max(1, args.rss_pages),
        merge_from=args.merge_from,
        library_details_json=args.library_details_json,
        verbose=args.verbose,
        quiet=quiet,
        preserve_existing_titles=args.preserve_existing_titles,
    )

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Archivo generado: {out_path} ({len(data['books'])} libros leídos)", flush=True)
    if scrape_likes_mode != "none" and not args.cookie:
        print(
            "Aviso: scrape de likes sin --cookie puede devolver 0 likes en reseñas privadas.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
