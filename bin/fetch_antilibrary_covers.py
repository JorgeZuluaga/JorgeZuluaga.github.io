#!/usr/bin/env python3
"""Fetch anti-library covers by ISBN (Google Books first)."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote_plus
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


@dataclass
class Job:
    book_id: str
    title: str
    author: str
    review_url: str
    review_local_cover_url: str
    date_added: str
    isbn: str


def normalize_text(value: object) -> str:
    return str(value or "").strip()


def normalize_isbn(value: object) -> str:
    raw = normalize_text(value)
    if not raw:
        return ""
    cleaned = re.sub(r"[^0-9Xx]", "", raw).upper()
    return cleaned


def parse_date(value: object) -> datetime | None:
    raw = normalize_text(value)
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y/%m"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def parse_review_id(review_url: str) -> str:
    m = re.search(r"/review/show/(\d+)", review_url or "")
    return m.group(1) if m else ""


def get_json(url: str, timeout: int = 20) -> dict:
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def get_bytes(url: str, timeout: int = 25) -> bytes:
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=timeout) as resp:
        return resp.read()


def should_retry_error(err: Exception) -> bool:
    if isinstance(err, TimeoutError):
        return True
    if isinstance(err, URLError):
        return True
    if isinstance(err, HTTPError):
        return err.code in {408, 425, 429, 500, 502, 503, 504}
    return False


def fetch_bytes_with_retry(
    url: str,
    *,
    timeout: int,
    retries: int,
    retry_initial_sleep_ms: int,
    retry_backoff: float,
) -> bytes:
    attempt = 0
    sleep_ms = max(0, int(retry_initial_sleep_ms))
    while True:
        try:
            return get_bytes(url, timeout=timeout)
        except Exception as err:
            if attempt >= retries or not should_retry_error(err):
                raise
            attempt += 1
            time.sleep(max(0.0, sleep_ms / 1000.0))
            sleep_ms = int(max(1, sleep_ms) * max(1.0, retry_backoff))


def google_books_cover_url(isbn: str) -> str:
    query = quote_plus(f"isbn:{isbn}")
    url = f"https://www.googleapis.com/books/v1/volumes?q={query}&maxResults=1"
    payload = get_json(url)
    items = payload.get("items")
    if not isinstance(items, list) or not items:
        return ""
    image_links = (((items[0] or {}).get("volumeInfo") or {}).get("imageLinks") or {})
    if not isinstance(image_links, dict):
        return ""
    for k in ("extraLarge", "large", "medium", "small", "thumbnail", "smallThumbnail"):
        v = normalize_text(image_links.get(k))
        if v:
            return v.replace("http://", "https://")
    return ""


def openlibrary_cover_url(isbn: str) -> str:
    # Useful fallback when Google Books misses.
    return f"https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg?default=false"


def local_cover_candidate(job: Job, repo_root: Path) -> Path | None:
    if job.review_local_cover_url:
        rel = job.review_local_cover_url[2:] if job.review_local_cover_url.startswith("./") else job.review_local_cover_url
        p = repo_root / rel
        if p.exists() and p.is_file():
            return p

    review_id = parse_review_id(job.review_url)
    if review_id:
        for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
            p = repo_root / "reviews" / "covers" / f"{review_id}{ext}"
            if p.exists() and p.is_file():
                return p
    return None


def build_jobs(library_json: Path, details_json: Path) -> list[Job]:
    library_data = json.loads(library_json.read_text(encoding="utf-8"))
    details_data = json.loads(details_json.read_text(encoding="utf-8"))
    books = list(library_data.get("books") or [])
    details_books = list(details_data.get("books") or []) if isinstance(details_data, dict) else list(details_data or [])

    details_by_book_id: dict[str, dict] = {}
    details_by_key: dict[str, dict] = {}
    for row in details_books:
        if not isinstance(row, dict):
            continue
        bid = normalize_text(row.get("bookId"))
        if bid:
            details_by_book_id[bid] = row
        key = f"{normalize_text(row.get('Title')).lower()}|{normalize_text(row.get('Author')).lower()}"
        details_by_key[key] = row

    jobs: list[Job] = []
    for b in books:
        if not isinstance(b, dict):
            continue
        if normalize_text(b.get("dateRead")):
            continue  # Not anti-library.
        title = normalize_text(b.get("title"))
        author = normalize_text(b.get("author"))
        if not title:
            continue
        bid = normalize_text(b.get("bookId"))
        key = f"{title.lower()}|{author.lower()}"
        detail = details_by_book_id.get(bid) or details_by_key.get(key) or {}
        isbn = normalize_isbn(detail.get("ISBN"))
        jobs.append(
            Job(
                book_id=bid,
                title=title,
                author=author,
                review_url=normalize_text(b.get("reviewUrl")),
                review_local_cover_url=normalize_text(b.get("reviewLocalCoverUrl")),
                date_added=normalize_text(b.get("dateAdded")),
                isbn=isbn,
            )
        )

    jobs.sort(key=lambda x: parse_date(x.date_added) or datetime(1970, 1, 1), reverse=True)
    return jobs


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch anti-library covers by ISBN.")
    parser.add_argument("--library-json", default="info/library.json")
    parser.add_argument("--library-details-json", default="info/library-details.json")
    parser.add_argument("--output-dir", default="antilibrary/covers")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--retries", type=int, default=3, help="Retries for transient network/HTTP failures.")
    parser.add_argument("--retry-initial-sleep-ms", type=int, default=350, help="Initial retry wait in ms.")
    parser.add_argument("--retry-backoff", type=float, default=2.0, help="Backoff multiplier between retries.")
    parser.add_argument("--timeout-seconds", type=int, default=25, help="HTTP timeout for image fetch.")
    args = parser.parse_args()

    repo_root = Path.cwd()
    library_json = repo_root / args.library_json
    details_json = repo_root / args.library_details_json
    output_dir = repo_root / args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    if not library_json.exists():
        raise SystemExit(f"No existe: {library_json}")
    if not details_json.exists():
        raise SystemExit(f"No existe: {details_json}")

    jobs = build_jobs(library_json, details_json)
    limit = max(1, int(args.limit))
    selected = jobs[:limit]
    results = []

    copied = 0
    downloaded = 0
    missing_isbn = 0
    failed = 0

    for idx, job in enumerate(selected, start=1):
        target_stem = normalize_isbn(job.isbn) or f"bookid-{job.book_id or idx}"
        target = output_dir / f"{target_stem}.jpg"
        status = "skipped"
        source = ""
        error = ""

        local_src = local_cover_candidate(job, repo_root)
        try:
            if local_src is not None:
                shutil.copyfile(local_src, target)
                status = "copied_local"
                source = str(local_src.relative_to(repo_root))
                copied += 1
            else:
                if not job.isbn:
                    missing_isbn += 1
                    status = "missing_isbn"
                else:
                    cover_url = google_books_cover_url(job.isbn)
                    if not cover_url:
                        cover_url = openlibrary_cover_url(job.isbn)
                    data = fetch_bytes_with_retry(
                        cover_url,
                        timeout=max(5, int(args.timeout_seconds)),
                        retries=max(0, int(args.retries)),
                        retry_initial_sleep_ms=max(0, int(args.retry_initial_sleep_ms)),
                        retry_backoff=max(1.0, float(args.retry_backoff)),
                    )
                    if len(data) < 1024:
                        raise RuntimeError("image_too_small_or_not_found")
                    target.write_bytes(data)
                    status = "downloaded"
                    source = cover_url
                    downloaded += 1
        except Exception as err:
            if status != "missing_isbn":
                failed += 1
                status = "failed"
                error = str(err)

        results.append(
            {
                "bookId": job.book_id,
                "title": job.title,
                "author": job.author,
                "dateAdded": job.date_added,
                "isbn": job.isbn,
                "outputFile": str(target.relative_to(repo_root)),
                "status": status,
                "source": source,
                "error": error,
            }
        )
        print(f"[{idx}/{len(selected)}] {status:12} | {job.title}")

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "limit": limit,
        "processed": len(selected),
        "copiedLocal": copied,
        "downloaded": downloaded,
        "missingIsbn": missing_isbn,
        "failed": failed,
        "results": results,
    }
    report_path = output_dir / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("")
    print(f"Report: {report_path}")
    print(
        f"processed={len(selected)} copied={copied} downloaded={downloaded} "
        f"missing_isbn={missing_isbn} failed={failed}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
