#!/usr/bin/env python3
"""Índice Markdown de todas las reseñas (título, autor, enlace) para NotebookLM / Gemini."""

from __future__ import annotations

import argparse
import json
import re
from datetime import date
from pathlib import Path


def parse_review_id(review_url: str) -> str:
    match = re.search(r"/review/show/(\d+)", review_url or "")
    return match.group(1) if match else ""


def has_review(item: dict) -> bool:
    """Misma lógica que assets/library-page.js (reseña con texto publicado)."""
    if "/review/show/" not in str(item.get("reviewUrl") or ""):
        return False
    if item.get("hasReview") is False:
        return False
    if item.get("hasReview") is True:
        return True
    wc = item.get("reviewCount")
    if isinstance(wc, (int, float)) and wc >= 25:
        return True
    return True


def is_duplicate_hidden(item: dict) -> bool:
    v = item.get("libraryDuplicateHidden")
    return v is True or v == 1 or v == "1"


def public_review_href(review_url: str, site_base: str) -> str:
    review_id = parse_review_id(review_url)
    if review_id:
        return f"{site_base.rstrip('/')}/reviews/{review_id}.html"
    return (review_url or "").split("?", 1)[0].strip()


def sort_key(book: dict) -> tuple[str, str, str]:
    review_date = str(book.get("reviewDate") or book.get("dateRead") or "").strip()
    review_id = parse_review_id(str(book.get("reviewUrl") or ""))
    return (review_date, review_id)


def collect_reviewed_books(library: dict) -> list[dict]:
    rows: list[dict] = []
    for book in library.get("books") or []:
        if not isinstance(book, dict) or not book.get("title"):
            continue
        if is_duplicate_hidden(book):
            continue
        if not has_review(book):
            continue
        review_url = str(book.get("reviewUrl") or "").strip()
        if not review_url:
            continue
        rows.append(book)
    rows.sort(key=sort_key, reverse=True)
    return rows


def format_stars_rating(rating) -> str:
    try:
        stars = int(rating)
    except (TypeError, ValueError):
        return "sin estrellas"
    stars = max(0, min(5, stars))
    if stars == 0:
        return "sin estrellas"
    filled = "★" * stars
    empty = "☆" * (5 - stars)
    return f"{filled}{empty} ({stars}/5)"


def format_drz_score(drzrating) -> str:
    try:
        score = int(drzrating)
    except (TypeError, ValueError):
        return "pendiente"
    if score < 0:
        return "pendiente"
    return str(score)


def render_markdown(books: list[dict], *, site_base: str) -> str:
    today = date.today().isoformat()
    lines = [
        "# Todas las reseñas",
        "",
        "Índice de reseñas publicadas en el sitio (para NotebookLM / Gemini).",
        f"Generado: {today}. Total: **{len(books)}** reseñas.",
        "",
        "Orden: fecha de reseña (más reciente primero).",
        "Incluye calificación en estrellas (Goodreads) y puntaje DrZ (0–100; «pendiente» si aún no hay).",
        "",
    ]
    for index, book in enumerate(books, start=1):
        title = str(book.get("title") or "").strip()
        author = str(book.get("author") or "").strip() or "sin autor"
        stars = format_stars_rating(book.get("rating"))
        drz = format_drz_score(book.get("drzrating"))
        href = public_review_href(str(book.get("reviewUrl") or ""), site_base)
        lines.append(
            f"{index}. **{title}** — {author} — {stars} · Puntaje: {drz} — "
            f"[Ver reseña]({href})"
        )
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Genera reviews/todas.md con título, autor y enlace de cada reseña.",
    )
    parser.add_argument("--library-json", default="info/library.json")
    parser.add_argument(
        "--output",
        default="reviews/todas.md",
        help="Archivo Markdown de salida (default: reviews/todas.md).",
    )
    parser.add_argument(
        "--site-base-url",
        default="https://jorgezuluaga.github.io",
        help="URL pública del sitio para enlaces a reviews/*.html.",
    )
    args = parser.parse_args()

    library_path = Path(args.library_json)
    if not library_path.is_file():
        raise SystemExit(f"No existe: {library_path}")

    books = collect_reviewed_books(json.loads(library_path.read_text(encoding="utf-8")))
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        render_markdown(books, site_base=args.site_base_url.strip()),
        encoding="utf-8",
    )
    print(f"[reviews-todas] {len(books)} reseñas → {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
