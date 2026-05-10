#!/usr/bin/env python3
"""Export pending DrZ ratings for Gemini scoring.

Creates two files under update/:
- update/drzrating_pending.json: books that need scoring (drzrating -1 or 0) AND have a review.
- update/drzrating_context.json: compact context of already-scored books (drzrating > 0) with review excerpts.

Review text is extracted from the local mirrored HTML in reviews/*.html when available.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from review_word_count import extract_review_body_from_html


def parse_review_id(book: dict[str, Any]) -> str:
    url = str(book.get("reviewUrl") or "")
    m = re.search(r"/review/show/(\d+)", url)
    return m.group(1) if m else ""


def resolve_review_html_path(*, repo_root: Path, book: dict[str, Any]) -> Path | None:
    local = str(book.get("reviewLocalUrl") or "").strip()
    if local.endswith(".html"):
        rel = local[2:] if local.startswith("./") else local
        path = (repo_root / rel).resolve()
        return path if path.exists() else None
    review_id = parse_review_id(book)
    if review_id:
        path = (repo_root / "reviews" / f"{review_id}.html").resolve()
        return path if path.exists() else None
    return None


def read_review_text(*, repo_root: Path, book: dict[str, Any]) -> str:
    path = resolve_review_html_path(repo_root=repo_root, book=book)
    if not path:
        return ""
    raw = path.read_text(encoding="utf-8", errors="ignore")
    return extract_review_body_from_html(raw) or ""


def to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def build_record(*, repo_root: Path, book: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(book, dict):
        return None
    if book.get("hasReview") is not True:
        return None
    drz = book.get("drzrating")
    if not isinstance(drz, int):
        return None
    # Only export books that are still pending DrZ scoring.
    if drz not in (-1, 0):
        return None

    review_text = read_review_text(repo_root=repo_root, book=book)
    if not review_text.strip():
        # Only score books with actual review text.
        return None

    return {
        "bookId": str(book.get("bookId") or "").strip(),
        "reviewId": parse_review_id(book),
        "title": str(book.get("title") or "").strip(),
        "author": str(book.get("author") or "").strip(),
        "dateRead": str(book.get("dateRead") or "").strip(),
        "ratingStars": to_int(book.get("rating"), 0),
        "reviewUrl": str(book.get("reviewUrl") or "").strip(),
        "reviewText": review_text,
    }


def build_context_record(*, repo_root: Path, book: dict[str, Any], excerpt_len: int) -> dict[str, Any] | None:
    if not isinstance(book, dict):
        return None
    if book.get("hasReview") is not True:
        return None
    drz = book.get("drzrating")
    if not isinstance(drz, int) or drz <= 0:
        return None
    review_text = read_review_text(repo_root=repo_root, book=book)
    excerpt = review_text.strip()[:excerpt_len] if review_text else ""
    return {
        "bookId": str(book.get("bookId") or "").strip(),
        "reviewId": parse_review_id(book),
        "title": str(book.get("title") or "").strip(),
        "author": str(book.get("author") or "").strip(),
        "dateRead": str(book.get("dateRead") or "").strip(),
        "ratingStars": to_int(book.get("rating"), 0),
        "drzrating": drz,
        "reviewExcerpt": excerpt,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--library-json", default="info/library.json")
    ap.add_argument("--out-pending", default="update/drzrating_pending.json")
    ap.add_argument("--out-context", default="update/drzrating_context.json")
    ap.add_argument("--context-excerpt-len", type=int, default=500)
    args = ap.parse_args()

    library_path = Path(args.library_json)
    if not library_path.exists():
        raise SystemExit(f"Not found: {library_path}")
    repo_root = library_path.resolve().parent.parent

    data = json.loads(library_path.read_text(encoding="utf-8"))
    books = data.get("books")
    if not isinstance(books, list):
        raise SystemExit("Invalid library.json: expected key 'books' as list.")

    pending: list[dict[str, Any]] = []
    context: list[dict[str, Any]] = []

    for b in books:
        rec = build_record(repo_root=repo_root, book=b)
        if rec:
            pending.append(rec)
        ctx = build_context_record(
            repo_root=repo_root,
            book=b,
            excerpt_len=max(100, int(args.context_excerpt_len)),
        )
        if ctx:
            context.append(ctx)

    pending.sort(key=lambda x: (x.get("dateRead") or "", x.get("title") or ""), reverse=True)
    context.sort(key=lambda x: (x.get("drzrating") or 0, x.get("dateRead") or ""), reverse=True)

    out_pending = Path(args.out_pending)
    out_context = Path(args.out_context)
    out_pending.parent.mkdir(parents=True, exist_ok=True)
    out_context.parent.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc).isoformat()
    out_pending.write_text(
        json.dumps(
            {"generatedAt": now, "source": {"libraryJson": str(library_path)}, "books": pending},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    out_context.write_text(
        json.dumps(
            {"generatedAt": now, "source": {"libraryJson": str(library_path)}, "books": context},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"Wrote: {out_pending} (pending={len(pending)})")
    print(f"Wrote: {out_context} (context={len(context)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

