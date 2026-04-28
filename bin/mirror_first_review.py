#!/usr/bin/env python3
"""Mirror the first Goodreads review found in info/library.json into reviews/."""

from __future__ import annotations

import argparse
import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
)
DEFAULT_SITE_BASE_URL = "https://jorgezuluaga.github.io"


def get_url(url: str, cookie: str = "", timeout: int = 20) -> str:
    headers = {"User-Agent": USER_AGENT}
    if cookie:
        headers["Cookie"] = cookie
    req = Request(url, headers=headers)
    with urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def get_bytes(url: str, cookie: str = "", timeout: int = 20) -> bytes:
    headers = {"User-Agent": USER_AGENT}
    if cookie:
        headers["Cookie"] = cookie
    req = Request(url, headers=headers)
    with urlopen(req, timeout=timeout) as resp:
        return resp.read()


def first_review_book(books: list[dict]) -> dict | None:
    for item in books:
        review_url = str(item.get("reviewUrl") or "")
        if "/review/show/" in review_url:
            return item
    return None


def extract_review_id(review_url: str) -> str:
    m = re.search(r"/review/show/(\d+)", review_url)
    if m:
        return m.group(1)
    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")


def clean_review_html(raw_html: str) -> str:
    cleaned = re.sub(r"<script\b[^>]*>.*?</script>", "", raw_html, flags=re.I | re.S)
    cleaned = re.sub(r"<style\b[^>]*>.*?</style>", "", cleaned, flags=re.I | re.S)
    # Goodreads often injects inline styles/colors that become unreadable in dark mode.
    cleaned = re.sub(r'\sstyle\s*=\s*"[^"]*"', "", cleaned, flags=re.I)
    cleaned = re.sub(r"\sstyle\s*=\s*'[^']*'", "", cleaned, flags=re.I)
    cleaned = re.sub(r'\scolor\s*=\s*"[^"]*"', "", cleaned, flags=re.I)
    cleaned = re.sub(r"\scolor\s*=\s*'[^']*'", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\son\w+\s*=\s*\"[^\"]*\"", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\son\w+\s*=\s*'[^']*'", "", cleaned, flags=re.I)
    return cleaned.strip()


def extract_review_fragment(review_page_html: str) -> str:
    patterns = [
        r'(<section[^>]*class="[^"]*ReviewText[^"]*"[^>]*>.*?</section>)',
        r"(<section[^>]*class='[^']*ReviewText[^']*'[^>]*>.*?</section>)",
        r'(<div[^>]*data-testid="reviewText"[^>]*>.*?</div>)',
        r'(<div[^>]*class="[^"]*TruncatedContent__text[^"]*"[^>]*>.*?</div>)',
    ]
    for pattern in patterns:
        m = re.search(pattern, review_page_html, flags=re.I | re.S)
        if m:
            return clean_review_html(m.group(1))
    return ""


def extract_page_title(review_page_html: str) -> str:
    m = re.search(r"<title>(.*?)</title>", review_page_html, flags=re.I | re.S)
    if not m:
        return "Reseña en Goodreads"
    title = re.sub(r"\s+", " ", m.group(1)).strip()
    return html.escape(title)


def is_signin_page(page_title: str) -> bool:
    lower = page_title.lower()
    return "sign in" in lower or "inicia sesión" in lower


def format_review_date(raw_value: str) -> str:
    raw = (raw_value or "").strip()
    if not raw:
        return ""
    for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return raw


def with_page(rss_url: str, page: int) -> str:
    u = urlparse(rss_url)
    q = dict(parse_qsl(u.query, keep_blank_values=True))
    q["page"] = str(page)
    return urlunparse((u.scheme, u.netloc, u.path, u.params, urlencode(q), u.fragment))


def canonical_review_url(value: str) -> str:
    return value.split("?", 1)[0].strip()


def extract_review_data_from_rss(
    rss_url: str, review_url: str, max_pages: int, cookie: str = ""
) -> dict:
    target = canonical_review_url(review_url)
    for page in range(1, max_pages + 1):
        xml_text = get_url(with_page(rss_url, page), cookie=cookie)
        root = ET.fromstring(xml_text)
        items = root.findall("./channel/item")
        if not items:
            break
        for item in items:
            item_link = canonical_review_url((item.findtext("link") or "").strip())
            if item_link != target:
                continue
            raw_review = (item.findtext("user_review") or "").strip()
            review_text = clean_review_html(html.unescape(raw_review)) if raw_review else ""
            review_date_raw = (
                (item.findtext("user_date_added") or "").strip()
                or (item.findtext("pubDate") or "").strip()
                or (item.findtext("user_date_created") or "").strip()
            )
            review_date = format_review_date(review_date_raw)
            cover_url = (
                (item.findtext("book_large_image_url") or "").strip()
                or (item.findtext("book_medium_image_url") or "").strip()
                or (item.findtext("book_image_url") or "").strip()
            )
            return {
                "review_text": review_text,
                "review_date": review_date,
                "cover_url": cover_url,
            }
    return {"review_text": "", "review_date": "", "cover_url": ""}


def build_local_page(
    book: dict,
    review_url: str,
    review_fragment: str,
    review_date: str,
    local_cover_src: str,
    review_page_url: str,
    og_image_url: str,
    page_title: str,
) -> str:
    safe_book = html.escape(str(book.get("title") or "Libro"))
    safe_author = html.escape(str(book.get("author") or ""))
    safe_review_date = html.escape(review_date.strip()) if review_date else "Fecha no disponible"
    try:
        rating = int(book.get("rating", 0) or 0)
    except (ValueError, TypeError):
        rating = 0
    try:
        likes = int(book.get("reviewLikes", 0) or 0)
    except (ValueError, TypeError):
        likes = 0
    rating = max(0, min(5, rating))
    likes = max(0, likes)
    stars = ("★" * rating) + ("☆" * (5 - rating))
    
    drzrating = book.get("drzrating", -1)
    drz_text = "(pendiente)" if drzrating == -1 else str(drzrating)
    review_id = extract_review_id(review_url)
    if not review_fragment:
        review_fragment = (
            "<p>No fue posible extraer el contenido visible de la reseña automáticamente.</p>"
        )
    cover_block = ""
    if local_cover_src:
        safe_cover = html.escape(local_cover_src)
        cover_block = f'<img src="{safe_cover}" alt="Portada de {safe_book}" />'
    cover_markup = f'<p class="cover">{cover_block}</p>' if cover_block else ""
    safe_review_page_url = html.escape(review_page_url)
    safe_og_image_url = html.escape(og_image_url)
    og_description = f"Reseña de {safe_book} por Jorge I. Zuluaga"

    return f"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <meta name="visitor-log-endpoint" content="https://visitor-log-worker.jorgezuluaga.workers.dev/log" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="{safe_book}" />
  <meta property="og:description" content="{og_description}" />
  <meta property="og:url" content="{safe_review_page_url}" />
  <meta property="og:image" content="{safe_og_image_url}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{safe_book}" />
  <meta name="twitter:description" content="{og_description}" />
  <meta name="twitter:image" content="{safe_og_image_url}" />
  <title>{page_title}</title>
  <link rel="icon" type="image/png" sizes="48x48" href="../assets/favicon.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="../assets/apple-touch-icon.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../assets/style.css?v=2" />
  <script src="../assets/template.js" defer></script>
  <style>
    .review-page-custom .meta {{ color: var(--black); opacity: 0.8; font-size: 0.95rem; }}
    .review-page-custom .author {{ font-size: 1.4rem; font-weight: 600; margin: 0.35rem 0 0.75rem; }}
    .review-page-custom .review-by {{ font-size: 1rem; margin: -0.35rem 0 0.8rem; opacity: 0.88; }}
    .review-page-custom .rating-row {{ display: flex; align-items: center; gap: 0.8rem; margin: 0.25rem 0 0.2rem; }}
    .review-page-custom .rating {{ font-size: 1.2rem; letter-spacing: 0.04em; margin: 0; }}
    .review-page-custom .likes {{ margin: 0; font-size: 1rem; }}
    .review-page-custom .likes a {{ color: var(--accent); text-decoration: none; }}
    .review-page-custom .likes a:hover {{ text-decoration: underline; }}
    .review-page-custom .cover {{ margin: 0.75rem 0 1rem; }}
    .review-page-custom .cover img {{ max-width: 220px; height: auto; border-radius: 8px; border: 1px solid var(--line); }}
    .review-page-custom .card {{ border: 1px solid var(--line); border-radius: 12px; padding: 1rem; margin-top: 1rem; background: var(--card); }}
    .review-page-custom .card,
    .review-page-custom .card p,
    .review-page-custom .card div,
    .review-page-custom .card span,
    .review-page-custom .card li,
    .review-page-custom .card blockquote,
    .review-page-custom .card i,
    .review-page-custom .card b,
    .review-page-custom .card strong,
    .review-page-custom .card em {{
      color: var(--black) !important;
    }}
    .review-page-custom .card a {{
      color: var(--accent) !important;
      text-decoration: underline;
      text-underline-offset: 2px;
    }}
    .review-page-custom .card a i,
    .review-page-custom .card a em,
    .review-page-custom .card a span,
    .review-page-custom .card a strong,
    .review-page-custom .card a b {{
      color: var(--accent) !important;
    }}
  </style>
</head>
<body class="photos-page review-page-custom">
  <div class="wrapper">
    <a class="skip-link" href="#review-main">Saltar al contenido</a>
    <header class="photos-header">
      <div class="photos-header__bar">
        <a class="link photos-back" href="../biblioteca.html">← Volver a la Biblioteca de Jorge Zuluaga</a>
        <button class="theme-button photos-theme" type="button" aria-label="Modo de visualización: Claro/Oscuro">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="moon-icon" aria-hidden="true">
            <path d="M11.3807 2.01886C9.91573 3.38768 9 5.3369 9 7.49999C9 11.6421 12.3579 15 16.5 15C18.6631 15 20.6123 14.0843 21.9811 12.6193C21.6613 17.8537 17.3149 22 12 22C6.47715 22 2 17.5228 2 12C2 6.68514 6.14629 2.33869 11.3807 2.01886Z"></path>
          </svg>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="sun-icon" aria-hidden="true">
            <path d="M12 18C8.68629 18 6 15.3137 6 12C6 8.68629 8.68629 6 12 6C15.3137 6 18 8.68629 18 12C18 15.3137 15.3137 18 12 18ZM11 1H13V4H11V1ZM11 20H13V23H11V20ZM3.51472 4.92893L4.92893 3.51472L7.05025 5.63604L5.63604 7.05025L3.51472 4.92893ZM16.9497 18.364L18.364 16.9497L20.4853 19.0711L19.0711 20.4853L16.9497 18.364ZM19.0711 3.51472L20.4853 4.92893L18.364 7.05025L16.9497 5.63604L19.0711 3.51472ZM5.63604 16.9497L7.05025 18.364L4.92893 20.4853L3.51472 19.0711L5.63604 16.9497ZM23 11V13H20V11H23ZM4 11V13H1V11H4Z"></path>
          </svg>
        </button>
      </div>
    </header>
    <main id="review-main" class="photos-main">
      <div class="container">
        <h1 class="title-section">{safe_book}</h1>
        <p class="author">{safe_author or "—"}</p>
        <p class="review-by">Reseña por Jorge I. Zuluaga</p>
        {cover_markup}
        <p class="meta">Fecha de reseña: {safe_review_date}</p>
        <div class="rating-row">
          <span class="library-tooltip rating" data-title="Calificación de 1 a 5 estrellas asignada por Jorge Zuluaga en Goodreads" aria-label="Calificación: {rating} de 5">{stars}</span>
          <span class="library-tooltip" data-title="Un puntaje de 0 a 100 usado por Jorge Zuluaga recomendar libros">🤓 {drz_text}</span>
          <span class="library-tooltip likes" data-title="Me gusta de la comunidad De Goodreads" aria-label="Likes en GoodReads: {likes}"><a href="{html.escape(review_url)}" target="_blank" rel="noopener noreferrer">👍</a> {likes}</span>
          <span class="library-tooltip likes likes-local-inline" data-title="Me gustas recibidos en esta página (ver final de las reseñas)" aria-label="Me gusta locales: 0" data-local-likes-for="{review_id}">👏 0</span>
        </div>
        <p><a class="link" href="{html.escape(review_url)}" target="_blank" rel="noopener noreferrer">Ver reseña en GoodReads (necesita cuenta)</a></p>
        <article class="card">
          {review_fragment}
        </article>
        <div id="review-like-actions" aria-label="Interacciones de la reseña"></div>
      </div>
    </main>
    <footer class="print-mode-target">
      <p>Jorge I. Zuluaga — <a class="link" href="../index.html">Currículum en línea</a></p>
    </footer>
  </div>
  <script type="module" src="../assets/review-page.js"></script>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Scrapea la primera reseña de info/library.json y genera mirror local."
    )
    parser.add_argument(
        "--library-json",
        default="info/library.json",
        help="Ruta de entrada con libros y reviewUrl.",
    )
    parser.add_argument(
        "--reviews-dir",
        default="reviews",
        help="Directorio destino para el mirror local.",
    )
    parser.add_argument(
        "--cookie",
        default="",
        help="Cookie opcional para scraping autenticado.",
    )
    parser.add_argument(
        "--rss-pages",
        type=int,
        default=3,
        help="Máximo de páginas RSS para fallback de texto de reseña.",
    )
    parser.add_argument(
        "--site-base-url",
        default=DEFAULT_SITE_BASE_URL,
        help="Base URL pública del sitio para metadatos de compartir (Open Graph).",
    )
    args = parser.parse_args()

    library_path = Path(args.library_json)
    if not library_path.exists():
        raise SystemExit(f"Archivo no encontrado: {library_path}")

    with library_path.open("r", encoding="utf-8") as f:
        library = json.load(f)

    books = list(library.get("books") or [])
    book = first_review_book(books)
    if not book:
        raise SystemExit("No se encontró ninguna reseña en info/library.json")

    review_url = str(book.get("reviewUrl") or "").strip()
    review_id = extract_review_id(review_url)
    review_html = get_url(review_url, cookie=args.cookie)
    review_fragment = extract_review_fragment(review_html)
    page_title = extract_page_title(review_html)
    review_date = ""
    cover_url = ""
    rss_data = {}
    rss_url = str((library.get("source") or {}).get("rssUrl") or "").strip()
    if rss_url:
        rss_data = extract_review_data_from_rss(
            rss_url=rss_url,
            review_url=review_url,
            max_pages=max(1, args.rss_pages),
            cookie=args.cookie,
        )
        review_date = str(rss_data.get("review_date") or "").strip()
        cover_url = str(rss_data.get("cover_url") or "").strip()
    if not review_fragment:
        review_fragment = str((rss_data.get("review_text") if rss_data else "") or "").strip()
    if is_signin_page(page_title):
        page_title = "Reseña en Goodreads (mirror local)"

    reviews_dir = Path(args.reviews_dir)
    reviews_dir.mkdir(parents=True, exist_ok=True)
    covers_dir = reviews_dir / "covers"
    covers_dir.mkdir(parents=True, exist_ok=True)

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

    site_base_url = str(args.site_base_url or DEFAULT_SITE_BASE_URL).rstrip("/")
    review_page_url = f"{site_base_url}/reviews/{review_id}.html"
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
    )

    out_file = reviews_dir / f"{review_id}.html"
    out_file.write_text(local_page, encoding="utf-8")

    # Persist local mirror path in library.json to enable UI links.
    book["reviewLocalUrl"] = f"./{reviews_dir.as_posix()}/{out_file.name}"
    if local_cover_url:
        book["reviewLocalCoverUrl"] = local_cover_url
    if review_date:
        book["reviewDate"] = review_date
    book["reviewLocalStatus"] = "ok"
    book["reviewLocalGeneratedAt"] = datetime.now(timezone.utc).isoformat()

    with library_path.open("w", encoding="utf-8") as f:
        json.dump(library, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Mirror local generado: {out_file}")
    print(f"Libro: {book.get('title', '(sin título)')}")
    print(f"Reseña original: {review_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
