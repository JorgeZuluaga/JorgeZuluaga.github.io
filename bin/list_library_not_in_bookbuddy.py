#!/usr/bin/env python3
"""List Goodreads books (library.json) missing from BookBuddy (library-details.json)."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def is_duplicate_hidden(item: dict) -> bool:
    v = item.get("libraryDuplicateHidden")
    return v is True or v == 1 or v == "1"


def collect_missing(library: dict, details: dict) -> list[dict[str, str]]:
    detail_ids = {
        str(row.get("bookId") or "").strip()
        for row in details.get("books") or []
        if isinstance(row, dict) and str(row.get("bookId") or "").strip()
    }

    missing: list[dict[str, str]] = []
    for book in library.get("books") or []:
        if not isinstance(book, dict) or not book.get("title"):
            continue
        if is_duplicate_hidden(book):
            continue
        book_id = str(book.get("bookId") or "").strip()
        if not book_id or book_id in detail_ids:
            continue
        missing.append(
            {
                "title": str(book.get("title") or "").strip(),
                "author": str(book.get("author") or "").strip(),
                "dateRead": str(book.get("dateRead") or "").strip(),
            }
        )

    missing.sort(key=lambda row: row["dateRead"] or "", reverse=True)
    return missing


def render_markdown(missing: list[dict[str, str]], *, library_path: str, details_path: str) -> str:
    today = date.today().isoformat()
    lines = [
        "# Libros en Goodreads sin ficha en BookBuddy",
        "",
        f"Origen: `{library_path}` menos los `bookId` presentes en `{details_path}`.",
        f"Generado: {today}. Pendientes: **{len(missing)}** libros (lista numerada 1–{len(missing)}).",
        "",
        "Orden: fecha de lectura, más reciente primero.",
        "",
    ]
    for index, row in enumerate(missing, start=1):
        dr = row["dateRead"] or "sin fecha"
        author = row["author"] or "sin autor"
        lines.append(f"{index}. **{dr}** — {row['title']} — {author}")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Genera un Markdown con libros de library.json cuyo bookId "
            "no aparece en library-details.json (export BookBuddy)."
        )
    )
    parser.add_argument(
        "--library-json",
        default="info/library.json",
        help="Ruta a info/library.json (default: info/library.json).",
    )
    parser.add_argument(
        "--library-details-json",
        default="info/library-details.json",
        help="Ruta a info/library-details.json (default: info/library-details.json).",
    )
    parser.add_argument(
        "--output",
        default="update/library-not-in-bookbuddy.md",
        help="Archivo Markdown de salida (default: update/library-not-in-bookbuddy.md).",
    )
    args = parser.parse_args()

    library_path = Path(args.library_json)
    details_path = Path(args.library_details_json)
    output_path = Path(args.output)

    if not library_path.is_file():
        raise SystemExit(f"No existe: {library_path}")
    if not details_path.is_file():
        raise SystemExit(f"No existe: {details_path}")

    missing = collect_missing(load_json(library_path), load_json(details_path))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        render_markdown(
            missing,
            library_path=str(library_path).replace("\\", "/"),
            details_path=str(details_path).replace("\\", "/"),
        ),
        encoding="utf-8",
    )
    print(f"[bookbuddy-missing] {len(missing)} libros → {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
