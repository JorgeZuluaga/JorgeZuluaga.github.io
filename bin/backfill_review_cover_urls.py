#!/usr/bin/env python3
"""Set reviewLocalCoverUrl in library.json when reviews/covers/{id} exists."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

REVIEW_ID_RE = re.compile(r"/review/show/(\d+)")


def review_id_from_book(book: dict) -> str:
    match = REVIEW_ID_RE.search(str(book.get("reviewUrl") or ""))
    return match.group(1) if match else ""


def cover_url_for_review(reviews_dir: Path, review_id: str) -> str:
    covers_dir = reviews_dir / "covers"
    for ext in ("jpg", "jpeg", "png", "webp"):
        path = covers_dir / f"{review_id}.{ext}"
        if path.exists() and path.stat().st_size > 512:
            return f"./{reviews_dir.name}/covers/{path.name}"
    return ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill reviewLocalCoverUrl from reviews/covers/.")
    parser.add_argument("--library-json", default="info/library.json")
    parser.add_argument("--reviews-dir", default="reviews")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    library_path = (repo_root / args.library_json).resolve()
    reviews_dir = (repo_root / args.reviews_dir).resolve()

    library = json.loads(library_path.read_text(encoding="utf-8"))
    books = library.get("books") or []
    updated = 0

    for book in books:
        if not isinstance(book, dict):
            continue
        rid = review_id_from_book(book)
        if not rid:
            continue
        cover_url = cover_url_for_review(reviews_dir, rid)
        if not cover_url:
            continue
        current = str(book.get("reviewLocalCoverUrl") or "").strip()
        if current == cover_url:
            continue
        book["reviewLocalCoverUrl"] = cover_url
        updated += 1

    print(f"[backfill-review-covers] updated: {updated}")
    if not args.dry_run and updated:
        library_path.write_text(
            json.dumps(library, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"[backfill-review-covers] wrote {library_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
