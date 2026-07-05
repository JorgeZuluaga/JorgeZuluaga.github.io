#!/usr/bin/env python3
"""Re-descarga el texto de una o pocas reseñas desde Goodreads/RSS.

Solo reemplaza el contenido de ``<article class="card">`` en reviews/*.html;
no regenera la página completa (metadatos, portada, botones, etc.).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from mirror_first_review import (
    extract_page_title,
    extract_review_data_from_rss,
    extract_review_fragment,
    get_url,
    is_signin_page,
)
from review_date_policy import sync_review_date_from_review_text
from review_word_count import (
    apply_review_counts_to_books,
    count_words_in_review_html_file,
    extract_review_body_from_html,
    is_review_extraction_failed,
)

ARTICLE_RE = re.compile(
    r"(<article\s+class=\"card\"[^>]*>)(.*?)(</article>)",
    flags=re.IGNORECASE | re.DOTALL,
)
REVIEW_TEXT_DIV_RE = re.compile(
    r"^\s*<div[^>]*class=[\"'][^\"']*reviewText[^\"']*[\"'][^>]*>(.*)</div>\s*$",
    flags=re.IGNORECASE | re.DOTALL,
)


def parse_review_ids(raw: str) -> list[str]:
    ids: list[str] = []
    for part in re.split(r"[\s,]+", raw.strip()):
        value = part.strip()
        if not value:
            continue
        value = Path(value).stem if value.endswith(".html") else value
        if value.isdigit():
            ids.append(value)
    return ids


def find_book_by_review_id(books: list[dict], review_id: str) -> dict | None:
    target = str(review_id or "").strip()
    if not target:
        return None
    for book in books:
        if not isinstance(book, dict):
            continue
        if target in str(book.get("reviewUrl") or ""):
            return book
        if target in str(book.get("reviewLocalUrl") or ""):
            return book
    return None


def local_html_path(repo_root: Path, book: dict, review_id: str) -> Path:
    local = str(book.get("reviewLocalUrl") or "").strip()
    if local.startswith("./"):
        return (repo_root / local[2:]).resolve()
    if local:
        return (repo_root / local).resolve()
    return (repo_root / "reviews" / f"{review_id}.html").resolve()


def normalize_fragment_for_article(fragment: str) -> str:
    """Inner HTML for ``<article class="card">`` (sin envoltorio div.reviewText)."""
    value = (fragment or "").strip()
    if not value:
        return ""
    match = REVIEW_TEXT_DIV_RE.match(value)
    if match:
        return match.group(1).strip()
    return value


def fetch_review_fragment(
    review_url: str,
    *,
    rss_url: str,
    cookie: str,
    rss_pages: int,
) -> tuple[str, str]:
    """Return (html_fragment, source_label)."""
    review_html = get_url(review_url, cookie=cookie)
    page_title = extract_page_title(review_html)
    fragment = extract_review_fragment(review_html)
    source = "goodreads-page"

    if not fragment and rss_url:
        rss_data = extract_review_data_from_rss(
            rss_url=rss_url,
            review_url=review_url,
            max_pages=max(1, rss_pages),
            cookie=cookie,
        )
        fragment = str(rss_data.get("review_text") or "").strip()
        if fragment:
            source = "rss"
            if is_signin_page(page_title):
                print("  (Goodreads exige sesión; texto tomado del RSS)", flush=True)

    return normalize_fragment_for_article(fragment), source


def patch_article_in_html(html_text: str, new_body: str) -> str:
    match = ARTICLE_RE.search(html_text)
    if not match:
        raise ValueError("No se encontró <article class=\"card\"> en el HTML local.")

    prefix, inner, suffix = match.group(1), match.group(2), match.group(3)
    indent = "          "
    indent_match = re.search(r"\n(\s+)\S", inner)
    if indent_match:
        indent = indent_match.group(1)

    close_indent = "        "
    close_match = re.search(r"\n(\s+)" + re.escape(suffix.strip()), html_text, re.IGNORECASE)
    if close_match:
        close_indent = close_match.group(1)

    replacement = (
        f"{prefix}\n{indent}{new_body.strip()}\n{close_indent}{suffix.strip()}"
    )
    return html_text[: match.start()] + replacement + html_text[match.end() :]


def remirror_one(
    *,
    review_id: str,
    book: dict,
    repo_root: Path,
    rss_url: str,
    cookie: str,
    rss_pages: int,
    dry_run: bool,
) -> tuple[bool, bool]:
    """Return (success, library_dirty)."""
    review_url = str(book.get("reviewUrl") or "").strip()
    if not review_url:
        print(f"[{review_id}] ERROR: sin reviewUrl en library.json", file=sys.stderr)
        return False, False

    html_path = local_html_path(repo_root, book, review_id)
    if not html_path.exists():
        print(f"[{review_id}] ERROR: no existe {html_path}", file=sys.stderr)
        return False, False

    title = str(book.get("title") or review_id)
    print(f"[{review_id}] {title}", flush=True)

    fragment, source = fetch_review_fragment(
        review_url,
        rss_url=rss_url,
        cookie=cookie,
        rss_pages=rss_pages,
    )
    if not fragment:
        print(f"  ERROR: no se pudo extraer texto (Goodreads ni RSS)", file=sys.stderr)
        return False, False

    if is_review_extraction_failed(fragment):
        print("  ERROR: Goodreads/RSS devolvió placeholder vacío", file=sys.stderr)
        return False, False

    original = html_path.read_text(encoding="utf-8")
    old_body = extract_review_body_from_html(original)
    new_html = patch_article_in_html(original, fragment)
    new_body = extract_review_body_from_html(new_html)

    old_words = len(old_body.split()) if old_body else 0
    new_words = len(new_body.split()) if new_body else 0
    print(f"  Fuente: {source} | palabras: {old_words} → {new_words}", flush=True)

    text_unchanged = old_body.strip() == new_body.strip()

    if text_unchanged:
        review_date, date_changed = sync_review_date_from_review_text(
            book,
            review_text=fragment,
            html_path=None if dry_run else html_path,
            dry_run=dry_run,
        )
        if date_changed:
            print(f"  reviewDate → {review_date}", flush=True)
        elif not dry_run:
            print("  Sin cambios (el texto remoto coincide con el local).", flush=True)
        else:
            print("  dry-run: sin cambios de texto ni fecha embebida.", flush=True)
        return True, date_changed

    review_date, date_changed = sync_review_date_from_review_text(
        book,
        review_text=fragment,
        html_path=None,
        dry_run=True,
    )
    if date_changed:
        print(f"  reviewDate → {review_date}", flush=True)

    if dry_run:
        print("  dry-run: no se escribió el archivo.", flush=True)
        preview_old = old_body[:120].replace("\n", " ")
        preview_new = new_body[:120].replace("\n", " ")
        print(f"  local:  {preview_old}…", flush=True)
        print(f"  remoto: {preview_new}…", flush=True)
        return True, True

    html_path.write_text(new_html, encoding="utf-8")
    book["reviewCount"] = count_words_in_review_html_file(html_path)
    book["reviewTextSyncedAt"] = datetime.now(timezone.utc).isoformat()
    sync_review_date_from_review_text(
        book,
        review_text=fragment,
        html_path=html_path,
    )
    print(f"  OK → {html_path.name} (reviewCount={book['reviewCount']})", flush=True)
    return True, True


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Re-descarga solo el texto de reseñas indicadas desde Goodreads/RSS "
            "y parchea reviews/*.html sin regenerar la página."
        ),
    )
    parser.add_argument(
        "review_ids",
        nargs="*",
        help="IDs de reseña (ej. 8171377602) o rutas reviews/ID.html",
    )
    parser.add_argument(
        "--ids",
        dest="ids_csv",
        default="",
        help="IDs separados por coma (alternativa a argumentos posicionales).",
    )
    parser.add_argument("--library-json", default="info/library.json")
    parser.add_argument("--cookie", default="")
    parser.add_argument(
        "--rss-pages",
        type=int,
        default=20,
        help="Páginas RSS máximas por reseña (default: 20).",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    review_ids = parse_review_ids(args.ids_csv)
    for value in args.review_ids:
        review_ids.extend(parse_review_ids(value))
    # dedupe preserving order
    seen: set[str] = set()
    review_ids = [rid for rid in review_ids if not (rid in seen or seen.add(rid))]

    if not review_ids:
        parser.error("Indica al menos un ID de reseña.")

    library_path = Path(args.library_json)
    if not library_path.exists():
        raise SystemExit(f"No encontrado: {library_path}")

    repo_root = library_path.resolve().parent.parent
    library = json.loads(library_path.read_text(encoding="utf-8"))
    books = library.get("books") or []
    rss_url = str((library.get("source") or {}).get("rssUrl") or "").strip()

    ok = 0
    failed = 0
    library_dirty = False

    for review_id in review_ids:
        book = find_book_by_review_id(books, review_id)
        if not book:
            print(f"[{review_id}] ERROR: no está en library.json", file=sys.stderr)
            failed += 1
            continue
        success, dirty = remirror_one(
            review_id=review_id,
            book=book,
            repo_root=repo_root,
            rss_url=rss_url,
            cookie=args.cookie,
            rss_pages=args.rss_pages,
            dry_run=args.dry_run,
        )
        if success:
            ok += 1
            if dirty:
                library_dirty = True
        else:
            failed += 1

    if not args.dry_run and library_dirty:
        apply_review_counts_to_books(
            books,
            repo_root=repo_root,
        )
        library_path.write_text(
            json.dumps(library, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"Actualizado: {library_path}", flush=True)

    print(f"\nListo: {ok} ok, {failed} error(es).")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
