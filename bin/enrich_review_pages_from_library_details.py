#!/usr/bin/env python3
"""Clean review HTML and add «Ver detalles» → book.html (ISBN/precio solo en la ficha).

- Quita párrafos generados antes con clase `review-book-details` (ISBN, compra, precio).
- Antes del enlace a Goodreads inserta `Ver detalles` → `../book.html?bookid=<Goodreads bookId>`
  usando info/library.json (reviewLocalUrl + bookId).

Usage:
  python3 bin/enrich_review_pages_from_library_details.py
  python3 bin/enrich_review_pages_from_library_details.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Actualiza reviews/*.html: quita metadata ISBN/precio del cuerpo de la reseña "
            "y añade enlace «Ver detalles» a book.html según bookId en info/library.json."
        )
    )
    parser.add_argument(
        "--library-json",
        default="info/library.json",
        help="Ruta de info/library.json",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="No escribe archivos; solo reporta cambios.",
    )
    return parser.parse_args()


def _clean(value: object) -> str:
    return str(value or "").strip()


def review_html_path_from_local_url(local_url: str, repo_root: Path) -> Path:
    clean = local_url.strip()
    if clean.startswith("./"):
        clean = clean[2:]
    return repo_root / clean


def strip_review_book_details_paragraphs(html: str) -> str:
    """Remove injected ISBN/compra/precio lines (any variant of the class)."""
    return re.sub(
        r"\n?\s*<p class=\"meta review-book-details\"[^>]*>.*?</p>\s*",
        "\n",
        html,
        flags=re.DOTALL,
    )


def upsert_ver_detalles_link(html: str, book_id: str) -> tuple[str, bool]:
    """Remove old detail paragraphs; add Ver detalles before Goodreads if book_id set."""
    old_html = html
    html = strip_review_book_details_paragraphs(html)
    changed = html != old_html

    if not book_id:
        return html, changed

    if re.search(r'href="\.\./book\.html\?bookid=', html):
        return html, changed

    # First standalone paragraph whose only outward link is Goodreads review (before <article>).
    pattern = (
        r'(<p>)(\s*<a class="link" href="https://www\.goodreads\.com/review/show/)'
    )
    repl = rf'\1<a class="link" href="../book.html?bookid={book_id}">Ver detalles</a> · \2'
    new_html, n = re.subn(pattern, repl, html, count=1)
    if n == 0:
        return html, changed
    return new_html, True


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    library_path = repo_root / args.library_json

    if not library_path.exists():
        raise SystemExit(f"No existe: {library_path}")

    with library_path.open("r", encoding="utf-8") as f:
        library_data = json.load(f)

    library_books = list(library_data.get("books") or [])

    scanned = 0
    changed = 0
    missing_files = 0

    for book in library_books:
        review_local_url = _clean(book.get("reviewLocalUrl"))
        book_id = _clean(book.get("bookId"))
        if not review_local_url or not review_local_url.endswith(".html"):
            continue

        review_path = review_html_path_from_local_url(review_local_url, repo_root)
        if not review_path.exists():
            missing_files += 1
            continue

        scanned += 1
        original_html = review_path.read_text(encoding="utf-8")
        new_html, has_change = upsert_ver_detalles_link(original_html, book_id)
        if not has_change:
            continue

        changed += 1
        if not args.dry_run:
            review_path.write_text(new_html, encoding="utf-8")

    mode = "DRY-RUN" if args.dry_run else "APLICADO"
    print(f"[{mode}] Reseñas escaneadas: {scanned}")
    print(f"[{mode}] Archivos modificados: {changed}")
    print(f"[{mode}] reviewLocalUrl faltantes en disco: {missing_files}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
