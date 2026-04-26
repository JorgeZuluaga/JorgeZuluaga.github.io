#!/usr/bin/env python3
"""Sync local review likes from worker into info/library.json."""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_WORKER_BASE = "https://visitor-log-worker.jorgezuluaga.workers.dev"
DEFAULT_USER_AGENT = "curl/8.0"


def parse_review_id(review_url: str) -> str:
    import re

    match = re.search(r"/review/show/(\d+)", str(review_url or ""))
    return match.group(1) if match else ""


def fetch_local_like_count(
    worker_base: str,
    review_id: str,
    timeout: float,
    user_agent: str,
) -> tuple[int | None, str | None]:
    url = f"{worker_base.rstrip('/')}/review-like-count/{review_id}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("User-Agent", user_agent)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            if res.status != 200:
                return None, f"http_{res.status}"
            payload = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        return None, f"http_{err.code}"
    except TimeoutError:
        return None, "timeout"
    except urllib.error.URLError:
        return None, "network_error"
    except json.JSONDecodeError:
        return None, "invalid_json"

    count = payload.get("count")
    if not isinstance(count, (int, float)):
        return None, "invalid_payload"
    return max(0, int(count)), None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fetch local review likes from worker and store snapshot into library.json.",
    )
    parser.add_argument(
        "--library-json",
        default="info/library.json",
        help="Path to info/library.json (default: info/library.json).",
    )
    parser.add_argument(
        "--worker-base",
        default=DEFAULT_WORKER_BASE,
        help=f"Worker base URL (default: {DEFAULT_WORKER_BASE}).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=8.0,
        help="Per-request timeout in seconds (default: 8).",
    )
    parser.add_argument(
        "--conservative",
        action="store_true",
        help="Never lower stored counts when worker returns a smaller value.",
    )
    parser.add_argument(
        "--progress-every",
        type=int,
        default=25,
        help="Show progress every N reviewed books (default: 25).",
    )
    parser.add_argument(
        "--user-agent",
        default=DEFAULT_USER_AGENT,
        help=f"User-Agent for requests (default: {DEFAULT_USER_AGENT}).",
    )
    args = parser.parse_args()

    library_path = Path(args.library_json)
    if not library_path.exists():
        raise SystemExit(f"Archivo no encontrado: {library_path}")

    with library_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    books = data.get("books")
    if not isinstance(books, list):
        raise SystemExit("Formato inválido: 'books' no es una lista.")

    now_iso = datetime.now(timezone.utc).isoformat()
    review_ids: list[tuple[dict, str]] = []
    for book in books:
        if not isinstance(book, dict):
            continue
        review_id = parse_review_id(book.get("reviewUrl", ""))
        if review_id:
            review_ids.append((book, review_id))

    reviewed_total = len(review_ids)
    reviewed = 0
    updated = 0
    failed = 0
    failures = Counter()
    progress_every = max(1, int(args.progress_every))

    print(
        f"Iniciando snapshot de likes locales: total reseñas={reviewed_total}, "
        f"worker={args.worker_base.rstrip('/')}"
    , flush=True)

    for book, review_id in review_ids:
        reviewed += 1

        fetched, error = fetch_local_like_count(
            args.worker_base,
            review_id,
            args.timeout,
            args.user_agent,
        )
        if fetched is None:
            failed += 1
            failures[error or "unknown_error"] += 1
            if failed <= 5:
                print(f"[{reviewed}/{reviewed_total}] reviewId={review_id} fallo ({error})", flush=True)
            elif failed == 6:
                print("...más fallos omitidos (se mostrará resumen al final).", flush=True)
            if reviewed % progress_every == 0 or reviewed == reviewed_total:
                print(
                    f"Progreso: {reviewed}/{reviewed_total} | "
                    f"updated={updated} failed={failed}"
                , flush=True)
            continue

        prev = book.get("reviewLocalLikes")
        prev_count = int(prev) if isinstance(prev, (int, float)) else None
        next_count = fetched
        if args.conservative and prev_count is not None:
            next_count = max(prev_count, fetched)

        if prev_count != next_count:
            updated += 1
        book["reviewLocalLikes"] = next_count
        book["reviewLocalLikesUpdatedAt"] = now_iso
        if reviewed % progress_every == 0 or reviewed == reviewed_total:
            print(
                f"Progreso: {reviewed}/{reviewed_total} | "
                f"updated={updated} failed={failed}"
            , flush=True)

    data["localLikesSnapshot"] = {
        "generatedAt": now_iso,
        "workerBase": args.worker_base.rstrip("/"),
        "reviewedBooks": reviewed,
        "updatedBooks": updated,
        "failedBooks": failed,
        "failureReasons": dict(failures),
        "mode": "conservative" if args.conservative else "exact",
    }

    with library_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(
        f"Snapshot local likes guardado en {library_path} "
        f"(reviewed={reviewed}, updated={updated}, failed={failed})."
    , flush=True)
    if failures:
        top = ", ".join(f"{k}={v}" for k, v in failures.most_common(5))
        print(f"Resumen de fallos: {top}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
