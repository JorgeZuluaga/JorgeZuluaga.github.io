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


def cover_path_for_review(reviews_dir: Path, review_id: str) -> Path | None:
    covers_dir = reviews_dir / "covers"
    for ext in ("jpg", "jpeg", "png", "webp"):
        path = covers_dir / f"{review_id}.{ext}"
        if path.exists() and path.stat().st_size > 512:
            return path
    return None


def clear_local_mirror_fields(book: dict, *, keep_cover_url: str = "") -> None:
    for key in (
        "reviewLocalUrl",
        "reviewLocalStatus",
        "reviewLocalGeneratedAt",
        "reviewTextSyncedAt",
        "reviewLocalLikes",
        "reviewLocalLikesUpdatedAt",
    ):
        book.pop(key, None)
    if keep_cover_url:
        book["reviewLocalCoverUrl"] = keep_cover_url
    else:
        book.pop("reviewLocalCoverUrl", None)
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

    placeholder_ids: list[str] = []
    for html_path in sorted(reviews_dir.glob("*.html")):
        if is_review_html_extraction_failed(html_path):
            placeholder_ids.append(html_path.stem)

    library = json.loads(library_path.read_text(encoding="utf-8"))
    books = library.get("books") or []
    placeholder_set = set(placeholder_ids)
    updated_books = 0

    covers_kept = 0
    for book in books:
        if not isinstance(book, dict):
            continue
        rid = review_id_from_book(book)
        if rid and rid in placeholder_set:
            keep_cover_url = ""
            cover_path = cover_path_for_review(reviews_dir, rid)
            if cover_path:
                keep_cover_url = f"./{reviews_dir.name}/covers/{cover_path.name}"
                covers_kept += 1
            clear_local_mirror_fields(book, keep_cover_url=keep_cover_url)
            updated_books += 1

    deleted_html = 0
    for rid in placeholder_ids:
        html_path = reviews_dir / f"{rid}.html"
        if html_path.exists():
            deleted_html += 1
            if not args.dry_run:
                html_path.unlink()

    print(f"[cleanup-failed-reviews] Placeholders found: {len(placeholder_ids)}")
    print(f"[cleanup-failed-reviews] library.json books cleared: {updated_books}")
    print(f"[cleanup-failed-reviews] reviewLocalCoverUrl kept: {covers_kept}")
    print(f"[cleanup-failed-reviews] HTML deleted: {deleted_html}")
    print("[cleanup-failed-reviews] Covers: no se borran (siguen en reviews/covers/)")

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
