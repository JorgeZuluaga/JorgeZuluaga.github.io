#!/usr/bin/env python3
"""Build info/library.json from Goodreads RSS (+ optional likes scraping)."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
)


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


def is_read_item(user_shelves: str, user_read_at: str) -> bool:
    shelves = [s.strip().lower() for s in (user_shelves or "").split(",") if s.strip()]
    return bool(user_read_at.strip()) or ("read" in shelves)


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


def fetch_rss_items(rss_url: str, max_pages: int, verbose: bool = False) -> list[ET.Element]:
    all_items: list[ET.Element] = []
    for page in range(1, max_pages + 1):
        page_url = with_page(rss_url, page)
        if verbose:
            print(f"[RSS] Descargando página {page}/{max_pages}...")
        rss_text = get_url(page_url, cookie="")
        root = parse_rss(rss_text)
        items = root.findall("./channel/item")
        if not items:
            if verbose:
                print(f"[RSS] Página {page} sin ítems. Fin de paginación.")
            break
        all_items.extend(items)
        if verbose:
            print(f"[RSS] Página {page}: {len(items)} ítems (acumulado: {len(all_items)}).")
    return all_items


def build_library_data(
    rss_url: str, scrape_likes: bool, cookie: str, max_rss_pages: int, verbose: bool = False
) -> dict:
    rss_items = fetch_rss_items(rss_url, max_rss_pages, verbose=verbose)
    if verbose:
        print(f"[RSS] Total ítems leídos del feed: {len(rss_items)}")

    books = []
    seen_ids: set[str] = set()
    scrape_queue: list[dict] = []
    for item in rss_items:
        book_id = (item.findtext("book_id") or "").strip()
        if not book_id or book_id in seen_ids:
            continue
        seen_ids.add(book_id)
        title = (item.findtext("title") or "").strip()
        author = (item.findtext("author_name") or "").strip()
        user_read_at_raw = (item.findtext("user_read_at") or "").strip()
        user_shelves = (item.findtext("user_shelves") or "").strip()
        rating_raw = (item.findtext("user_rating") or "").strip()
        review_url = (item.findtext("link") or "").strip()
        user_review = (item.findtext("user_review") or "").strip()

        if not is_read_item(user_shelves, user_read_at_raw):
            continue

        has_review = bool(user_review) and "/review/show/" in review_url
        review_likes = 0
        scrape_status = "not_requested"

        try:
            rating = int(rating_raw) if rating_raw else 0
        except ValueError:
            rating = 0

        entry = {
            "bookId": book_id,
            "title": title,
            "author": author,
            "dateRead": parse_read_date(user_read_at_raw),
            "rating": rating,
            "reviewUrl": review_url if has_review else "",
            "hasReview": has_review,
            "reviewLikes": review_likes,
            "scrapeStatus": scrape_status,
        }
        books.append(entry)
        if scrape_likes and has_review:
            scrape_queue.append(entry)

    if verbose:
        print(f"[LIBROS] Libros leídos detectados: {len(books)}")
        print(f"[SCRAPE] Reseñas candidatas para likes: {len(scrape_queue)}")

    if scrape_likes:
        total = len(scrape_queue)
        for idx, entry in enumerate(scrape_queue, start=1):
            try:
                review_html = get_url(entry["reviewUrl"], cookie=cookie)
                entry["reviewLikes"] = extract_like_count(review_html)
                entry["scrapeStatus"] = "ok"
            except (HTTPError, URLError, TimeoutError) as err:
                entry["scrapeStatus"] = f"error: {err}"
            if verbose:
                remaining = total - idx
                print(
                    f"[SCRAPE] {idx}/{total} | likes={entry['reviewLikes']} | "
                    f"faltan={remaining} | {entry['title'][:80]}"
                )

    books.sort(key=lambda b: (b.get("dateRead") or ""), reverse=True)

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {"rssUrl": rss_url, "scrapeLikes": scrape_likes},
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
        "--scrape-likes",
        action="store_true",
        help="Fetch each review page and extract likes count.",
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
        "--verbose",
        action="store_true",
        help="Muestra progreso detallado en consola.",
    )
    args = parser.parse_args()

    data = build_library_data(
        rss_url=args.rss_url,
        scrape_likes=args.scrape_likes,
        cookie=args.cookie,
        max_rss_pages=max(1, args.rss_pages),
        verbose=args.verbose,
    )

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Archivo generado: {out_path} ({len(data['books'])} libros leídos)")
    if args.scrape_likes and not args.cookie:
        print("Aviso: --scrape-likes sin --cookie puede devolver 0 likes en reseñas privadas.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
