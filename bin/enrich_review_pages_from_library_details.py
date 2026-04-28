#!/usr/bin/env python3
"""Inject ISBN/purchase metadata into local review HTML pages.

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
            "Agrega en reviews/*.html la línea con ISBN, Comprado en y Precio "
            "según info/library-details.json, enlazando por bookId de info/library.json."
        )
    )
    parser.add_argument(
        "--library-json",
        default="info/library.json",
        help="Ruta de info/library.json",
    )
    parser.add_argument(
        "--library-details-json",
        default="info/library-details.json",
        help="Ruta de info/library-details.json",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="No escribe archivos; solo reporta cambios.",
    )
    return parser.parse_args()


def _clean(value: object) -> str:
    return str(value or "").strip()


def _normalize_price(raw_price: str) -> str:
    price = _clean(raw_price)
    if not price:
        return ""

    # Accept common variants like: "60000 $", "$60000", "60.000 $", "COP 60000".
    digits = re.sub(r"[^\d]", "", price)
    if not digits:
        return ""
    value = int(digits)
    return "$" + f"{value:,}".replace(",", ".")


def build_book_details_index(details_books: list[dict]) -> dict[str, dict[str, str]]:
    """Return best available details by bookId.

    If there are repeated rows for the same bookId, keep the one with more non-empty
    fields among ISBN / Purchase Place / Purchase Price.
    """
    best_by_book_id: dict[str, dict[str, str]] = {}
    best_score: dict[str, int] = {}

    for book in details_books:
        book_id = _clean(book.get("bookId"))
        if not book_id:
            continue

        isbn = _clean(book.get("ISBN"))
        purchase_place = _clean(book.get("Purchase Place"))
        purchase_price = _normalize_price(
            _clean(book.get("Purchase Price")) or _clean(book.get("Pruchace Price"))
        )
        score = int(bool(isbn)) + int(bool(purchase_place)) + int(bool(purchase_price))

        current_score = best_score.get(book_id, -1)
        if score <= current_score:
            continue

        best_by_book_id[book_id] = {
            "isbn": isbn,
            "purchase_place": purchase_place,
            "purchase_price": purchase_price,
        }
        best_score[book_id] = score

    return best_by_book_id


def build_details_sentence(details: dict[str, str]) -> str:
    isbn = _clean(details.get("isbn"))
    purchase_place = _clean(details.get("purchase_place"))
    purchase_price = _clean(details.get("purchase_price"))

    parts: list[str] = []
    if isbn:
        parts.append(f"ISBN {isbn}.")
    if purchase_place:
        parts.append(f"Comprado en {purchase_place}.")
    if purchase_price:
        parts.append(f"Precio {purchase_price}.")
    return " ".join(parts).strip()


def review_html_path_from_local_url(local_url: str, repo_root: Path) -> Path:
    clean = local_url.strip()
    if clean.startswith("./"):
        clean = clean[2:]
    return repo_root / clean


def upsert_details_paragraph(html: str, details_sentence: str) -> tuple[str, bool]:
    """Insert or replace details line below the review date meta paragraph."""
    old_html = html

    # Remove any previously generated paragraph to keep idempotent behavior.
    html = re.sub(
        r"\n?\s*<p class=\"meta review-book-details\">.*?</p>\s*",
        "\n",
        html,
        flags=re.DOTALL,
    )

    if not details_sentence:
        return html, html != old_html

    date_meta_pattern = r'(<p class="meta">Fecha de reseña:.*?</p>)'
    details_line = (
        '\n        <p class="meta review-book-details" '
        'style="font-size:0.85rem; font-style:italic;">'
        f"{details_sentence}</p>"
    )

    new_html, count = re.subn(
        date_meta_pattern,
        r"\1" + details_line,
        html,
        count=1,
        flags=re.DOTALL,
    )
    if count == 0:
        return old_html, False
    return new_html, new_html != old_html


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    library_path = repo_root / args.library_json
    details_path = repo_root / args.library_details_json

    if not library_path.exists():
        raise SystemExit(f"No existe: {library_path}")
    if not details_path.exists():
        raise SystemExit(f"No existe: {details_path}")

    with library_path.open("r", encoding="utf-8") as f:
        library_data = json.load(f)
    with details_path.open("r", encoding="utf-8") as f:
        details_data = json.load(f)

    details_index = build_book_details_index(list(details_data.get("books") or []))
    library_books = list(library_data.get("books") or [])

    scanned = 0
    changed = 0
    with_details = 0
    without_details = 0
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
        details = details_index.get(book_id, {})
        details_sentence = build_details_sentence(details)
        if details_sentence:
            with_details += 1
        else:
            without_details += 1

        original_html = review_path.read_text(encoding="utf-8")
        new_html, has_change = upsert_details_paragraph(original_html, details_sentence)
        if not has_change:
            continue

        changed += 1
        if not args.dry_run:
            review_path.write_text(new_html, encoding="utf-8")

    mode = "DRY-RUN" if args.dry_run else "APLICADO"
    print(f"[{mode}] Reseñas escaneadas: {scanned}")
    print(f"[{mode}] Reseñas con metadata disponible: {with_details}")
    print(f"[{mode}] Reseñas sin metadata: {without_details}")
    print(f"[{mode}] Archivos modificados: {changed}")
    print(f"[{mode}] reviewLocalUrl faltantes en disco: {missing_files}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

