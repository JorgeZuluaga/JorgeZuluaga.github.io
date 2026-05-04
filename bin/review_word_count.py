#!/usr/bin/env python3
"""Count words in mirrored review HTML and sync library.json field reviewCount."""

from __future__ import annotations

import argparse
import json
import re
from html import unescape
from pathlib import Path


def normalize_ws(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text).strip()


def html_to_text(fragment: str) -> str:
    value = fragment
    value = re.sub(r"(?i)<br\s*/?>", "\n", value)
    value = re.sub(r"(?i)</p\s*>", "\n\n", value)
    value = re.sub(r"(?i)</div\s*>", "\n", value)
    value = re.sub(r"<[^>]+>", "", value)
    value = unescape(value)
    lines = [normalize_ws(x) for x in value.splitlines()]
    lines = [x for x in lines if x]
    return "\n".join(lines).strip()


def extract_review_body_from_html(raw: str) -> str:
    """Plain text of the review body from a mirrored reviews/*.html file."""
    match = re.search(
        r'<article\s+class="card"[^>]*>(.*?)</article>',
        raw,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return ""
    return html_to_text(match.group(1))


def count_words(text: str) -> int:
    if not text or not text.strip():
        return 0
    return len(text.split())


def count_words_in_review_html_file(path: Path) -> int:
    if not path.exists():
        return 0
    raw = path.read_text(encoding="utf-8", errors="ignore")
    body = extract_review_body_from_html(raw)
    return count_words(body)


def has_goodreads_review_url(book: dict) -> bool:
    return "/review/show/" in str(book.get("reviewUrl") or "")


def apply_review_counts_to_books(
    books: list[dict],
    *,
    repo_root: Path,
    reviews_dir_name: str = "reviews",
) -> tuple[int, int]:
    """Set reviewCount (word count in local mirror body) for books with Goodreads review URLs."""
    updated = 0
    missing_file = 0
    reviews_base = (repo_root / Path(reviews_dir_name)).resolve()

    for book in books:
        if not isinstance(book, dict):
            continue
        if not has_goodreads_review_url(book):
            continue

        local = str(book.get("reviewLocalUrl") or "").strip()
        if local:
            rel = local[2:] if local.startswith("./") else local
            path = (repo_root / rel).resolve()
        else:
            review_url = str(book.get("reviewUrl") or "")
            m = re.search(r"/review/show/(\d+)", review_url)
            if not m:
                book["reviewCount"] = 0
                updated += 1
                continue
            path = reviews_base / f"{m.group(1)}.html"

        if path.exists():
            book["reviewCount"] = count_words_in_review_html_file(path)
        else:
            book["reviewCount"] = 0
            missing_file += 1
        updated += 1
    return updated, missing_file


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Recalculate reviewCount (word count) from local review HTML files.",
    )
    parser.add_argument("--library-json", default="info/library.json")
    parser.add_argument(
        "--reviews-dir",
        default="reviews",
        help="Directory under repo root used when inferring paths from reviewUrl only.",
    )
    parser.add_argument(
        "--repo-root",
        default="",
        help="Repository root (default: parent of info/ containing library.json).",
    )
    args = parser.parse_args()

    library_path = Path(args.library_json)
    if not library_path.exists():
        raise SystemExit(f"Not found: {library_path}")

    repo_root = Path(args.repo_root) if str(args.repo_root).strip() else library_path.resolve().parent.parent
    repo_root = repo_root.resolve()

    data = json.loads(library_path.read_text(encoding="utf-8"))
    books = data.get("books")
    if not isinstance(books, list):
        raise SystemExit("Invalid library.json: expected key 'books' as list.")

    n, missing = apply_review_counts_to_books(
        books,
        repo_root=repo_root,
        reviews_dir_name=str(Path(args.reviews_dir)),
    )
    data["books"] = books

    library_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated reviewCount for {n} books with review URLs.")
    if missing:
        print(f"Warning: {missing} entries have no local HTML file (reviewCount=0).")
    print(f"Wrote: {library_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
