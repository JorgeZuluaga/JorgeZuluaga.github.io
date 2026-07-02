#!/usr/bin/env python3
"""Remove mirrored reviews whose HTML only contains the extraction-failed placeholder."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from review_word_count import is_review_html_extraction_failed

REVIEW_ID_RE = re.compile(r"/review/show/(\d+)")


def review_id_from_book(book: dict) -> str:
    match = REVIEW_ID_RE.search(str(book.get("reviewUrl") or ""))
    if match:
        return match.group(1)
    local = str(book.get("reviewLocalUrl") or "").strip()
    if local.endswith(".html"):
        return Path(local).stem
    return ""


def clear_local_mirror_fields(book: dict) -> None:
    for key in (
        "reviewLocalUrl",
        "reviewLocalCoverUrl",
        "reviewLocalStatus",
        "reviewLocalGeneratedAt",
        "reviewTextSyncedAt",
        "reviewLocalLikes",
        "reviewLocalLikesUpdatedAt",
    ):
        book.pop(key, None)
    book["hasReview"] = False
    book["reviewCount"] = 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Delete failed review mirrors and clear library.json local fields.",
    )
    parser.add_argument(
        "--library-json",
        default="info/library.json",
        help="Path to library.json",
    )
    parser.add_argument(
        "--reviews-dir",
        default="reviews",
        help="Directory with mirrored review HTML files",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print actions without writing or deleting",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    library_path = (repo_root / args.library_json).resolve()
    reviews_dir = (repo_root / args.reviews_dir).resolve()
    covers_dir = reviews_dir / "covers"

    placeholder_ids: list[str] = []
    for html_path in sorted(reviews_dir.glob("*.html")):
        if is_review_html_extraction_failed(html_path):
            placeholder_ids.append(html_path.stem)

    library = json.loads(library_path.read_text(encoding="utf-8"))
    books = library.get("books") or []
    placeholder_set = set(placeholder_ids)
    updated_books = 0

    for book in books:
        if not isinstance(book, dict):
            continue
        rid = review_id_from_book(book)
        if rid and rid in placeholder_set:
            clear_local_mirror_fields(book)
            updated_books += 1

    deleted_html = 0
    deleted_covers = 0
    for rid in placeholder_ids:
        html_path = reviews_dir / f"{rid}.html"
        if html_path.exists():
            deleted_html += 1
            if not args.dry_run:
                html_path.unlink()
        for ext in ("jpg", "jpeg", "png", "webp"):
            cover_path = covers_dir / f"{rid}.{ext}"
            if cover_path.exists():
                deleted_covers += 1
                if not args.dry_run:
                    cover_path.unlink()

    print(f"[cleanup-failed-reviews] Placeholders found: {len(placeholder_ids)}")
    print(f"[cleanup-failed-reviews] library.json books cleared: {updated_books}")
    print(f"[cleanup-failed-reviews] HTML deleted: {deleted_html}")
    print(f"[cleanup-failed-reviews] Covers deleted: {deleted_covers}")

    if not args.dry_run:
        with library_path.open("w", encoding="utf-8") as f:
            json.dump(library, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"[cleanup-failed-reviews] Updated {library_path}")
    else:
        print("[cleanup-failed-reviews] dry-run: no files changed")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
