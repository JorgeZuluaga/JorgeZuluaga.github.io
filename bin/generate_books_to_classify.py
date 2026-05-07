#!/usr/bin/env python3
"""Genera archivos de libros pendientes de clasificar (sin dcc_notes).

Busca en:
- info/library.json
- info/library-details.json

Salida en formato:
{
  "books": [
    {
      "bookId": "...",
      "title": "...",
      "author": "...",
      "rating": 0.0,
      "description": "...",
      "subjects": [],
      "isbn": "...",
      "publisher": "...",
      "publishedDate": "...",
      "genre": "...",
      "review": "...",
      "reviewSummary": "..."
    }
  ]
}

Reglas de archivo de salida:
- Si total <= batch-size: update/books_to_classify.json
- Si total > batch-size: update/books_to_classify_001.json, _002.json, ...
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


def clean_text(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalized_title_author(title: str, author: str) -> str:
    t = re.sub(r"\s+", " ", (title or "").strip().lower())
    a = re.sub(r"\s+", " ", (author or "").strip().lower())
    return f"{t}::{a}"


def has_dcc_notes(book: dict[str, Any]) -> bool:
    return isinstance(book.get("dcc_notes"), dict)


def to_float(value: Any) -> float:
    try:
        if value in (None, ""):
            return 0.0
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def build_from_library_details(book: dict[str, Any], idx: int) -> dict[str, Any] | None:
    if has_dcc_notes(book):
        return None

    title = (book.get("Title") or "").strip()
    author = (book.get("Author") or "").strip()
    if not title and not author:
        return None

    isbn = (book.get("ISBN") or "").strip()
    book_id = (book.get("bookId") or "").strip()
    if not book_id:
        if isbn:
            book_id = f"isbn_{isbn}"
        else:
            seed = f"details_{title}_{author}_{idx}"
            book_id = "gen_" + hashlib.md5(seed.encode("utf-8")).hexdigest()[:12]

    return {
        "bookId": book_id,
        "title": title or f"[Sin título - {author}]",
        "author": author,
        "rating": to_float(book.get("Rating")),
        "description": clean_text((book.get("Summary") or "")[:500]),
        "subjects": [],
        "isbn": isbn,
        "publisher": (book.get("Publisher") or "").strip(),
        "publishedDate": (book.get("Year Published") or "").strip(),
        "genre": (book.get("Genre") or "").strip(),
        "review": "",
        "reviewSummary": "",
    }


def build_from_library(book: dict[str, Any], idx: int) -> dict[str, Any] | None:
    if has_dcc_notes(book):
        return None

    title = (book.get("title") or "").strip()
    author = (book.get("author") or "").strip()
    if not title and not author:
        return None

    book_id = (book.get("bookId") or "").strip()
    if not book_id:
        seed = f"library_{title}_{author}_{idx}"
        book_id = "lib_" + hashlib.md5(seed.encode("utf-8")).hexdigest()[:12]

    review = clean_text(book.get("review") or "")

    return {
        "bookId": book_id,
        "title": title or f"[Sin título - {author}]",
        "author": author,
        "rating": to_float(book.get("rating")),
        "description": "",
        "subjects": [],
        "isbn": "",
        "publisher": "",
        "publishedDate": "",
        "genre": "",
        "review": review,
        "reviewSummary": review[:300] if review else "",
    }


def merge_prefer_richer(current: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    merged = dict(current)

    def pick(field: str) -> str:
        old = (merged.get(field) or "").strip()
        new = (candidate.get(field) or "").strip()
        if len(new) > len(old):
            return new
        return old

    merged["title"] = pick("title")
    merged["author"] = pick("author")
    merged["description"] = pick("description")
    merged["isbn"] = pick("isbn")
    merged["publisher"] = pick("publisher")
    merged["publishedDate"] = pick("publishedDate")
    merged["genre"] = pick("genre")
    merged["review"] = pick("review")
    merged["reviewSummary"] = pick("reviewSummary")

    if to_float(candidate.get("rating")) > to_float(merged.get("rating")):
        merged["rating"] = to_float(candidate.get("rating"))

    return merged


def dedupe_and_merge(books: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    by_title_author: dict[str, str] = {}

    for b in books:
        bid = (b.get("bookId") or "").strip()
        key_ta = normalized_title_author(b.get("title", ""), b.get("author", ""))

        if bid and bid in by_id:
            by_id[bid] = merge_prefer_richer(by_id[bid], b)
            continue

        if key_ta and key_ta in by_title_author:
            existing_id = by_title_author[key_ta]
            by_id[existing_id] = merge_prefer_richer(by_id[existing_id], b)
            continue

        by_id[bid] = b
        if key_ta:
            by_title_author[key_ta] = bid

    return list(by_id.values())


def write_batches(books: list[dict[str, Any]], output_dir: Path, batch_size: int, prefix: str) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    files: list[Path] = []

    if len(books) <= batch_size:
        out = output_dir / f"{prefix}.json"
        out.write_text(json.dumps({"books": books}, ensure_ascii=False, indent=2), encoding="utf-8")
        files.append(out)
        return files

    total_batches = (len(books) + batch_size - 1) // batch_size
    for i in range(total_batches):
        chunk = books[i * batch_size : (i + 1) * batch_size]
        out = output_dir / f"{prefix}_{i + 1:03d}.json"
        out.write_text(json.dumps({"books": chunk}, ensure_ascii=False, indent=2), encoding="utf-8")
        files.append(out)

    return files


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Genera lotes de libros sin dcc_notes")
    p.add_argument("--library-json", default="info/library.json", help="Ruta a library.json")
    p.add_argument("--library-details", default="info/library-details.json", help="Ruta a library-details.json")
    p.add_argument("--output-dir", default="update", help="Directorio de salida")
    p.add_argument("--prefix", default="books_to_classify", help="Prefijo de archivos de salida")
    p.add_argument("--batch-size", type=int, default=50, help="Tamaño de lote")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    workspace = Path(__file__).resolve().parent.parent
    library_json_path = (workspace / args.library_json).resolve()
    library_details_path = (workspace / args.library_details).resolve()
    output_dir = (workspace / args.output_dir).resolve()

    library_data = json.loads(library_json_path.read_text(encoding="utf-8"))
    details_data = json.loads(library_details_path.read_text(encoding="utf-8"))

    missing_candidates: list[dict[str, Any]] = []

    for idx, b in enumerate(details_data.get("books", [])):
        if not isinstance(b, dict):
            continue
        row = build_from_library_details(b, idx)
        if row:
            missing_candidates.append(row)

    for idx, b in enumerate(library_data.get("books", [])):
        if not isinstance(b, dict):
            continue
        row = build_from_library(b, idx)
        if row:
            missing_candidates.append(row)

    merged = dedupe_and_merge(missing_candidates)
    merged.sort(key=lambda b: (b.get("title", "").lower(), b.get("author", "").lower()))

    files = write_batches(merged, output_dir, args.batch_size, args.prefix)

    summary = {
        "missing_in_library_json": sum(
            1 for b in library_data.get("books", []) if isinstance(b, dict) and not has_dcc_notes(b)
        ),
        "missing_in_library_details": sum(
            1 for b in details_data.get("books", []) if isinstance(b, dict) and not has_dcc_notes(b)
        ),
        "total_candidates": len(missing_candidates),
        "total_unique_books": len(merged),
        "batch_size": args.batch_size,
        "generated_files": [str(p) for p in files],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
