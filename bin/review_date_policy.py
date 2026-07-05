#!/usr/bin/env python3
"""Resolve reviewDate from embedded YYYY/MM/DD in review text or first text sync."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

from review_word_count import extract_review_body_from_html, html_to_text

TRAILING_EMBEDDED_DATE_RE = re.compile(r"(?<![0-9])(\d{4})/(\d{2})/(\d{2})\s*$")


def normalize_iso_date(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        return raw
    m = re.match(r"^(\d{4})/(\d{2})/(\d{2})", raw)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return ""


def parse_embedded_review_date(review_text: str) -> str:
    """Return YYYY-MM-DD if CCYY/MM/DD appears at end of review body."""
    plain = html_to_text(review_text or "")
    plain = re.sub(r"\s+", " ", plain).strip()
    if not plain:
        return ""
    match = TRAILING_EMBEDDED_DATE_RE.search(plain)
    if not match:
        return ""
    iso = f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
    try:
        datetime.strptime(iso, "%Y-%m-%d")
    except ValueError:
        return ""
    return iso


def resolve_review_date_from_text(
    *,
    review_text: str,
    date_read: str,
    first_download_at: datetime,
) -> str:
    """Embedded date wins; else first-download day; never before dateRead."""
    embedded = parse_embedded_review_date(review_text)
    candidate = embedded or first_download_at.astimezone(timezone.utc).date().isoformat()
    date_read_iso = normalize_iso_date(date_read)
    if date_read_iso and candidate < date_read_iso:
        return date_read_iso
    return candidate


def should_assign_review_date_on_mirror(book: dict) -> bool:
    """True only for the first text download of a review not mirrored before."""
    if str(book.get("reviewTextFirstSyncedAt") or "").strip():
        return False
    if str(book.get("reviewLocalGeneratedAt") or "").strip():
        return False
    local = str(book.get("reviewLocalUrl") or "").strip()
    if local.endswith(".html") and str(book.get("reviewLocalStatus") or "") == "ok":
        return False
    return True


def apply_embedded_review_date_if_present(
    book: dict,
    *,
    review_text: str,
) -> tuple[str, bool]:
    """Set reviewDate when the body ends with YYYY/MM/DD (never before dateRead)."""
    embedded = parse_embedded_review_date(review_text)
    if not embedded:
        return str(book.get("reviewDate") or "").strip(), False

    date_read_iso = normalize_iso_date(str(book.get("dateRead") or ""))
    resolved = embedded
    if date_read_iso and resolved < date_read_iso:
        resolved = date_read_iso

    previous = normalize_iso_date(book.get("reviewDate") or "")
    if previous != resolved:
        book["reviewDate"] = resolved
        return resolved, True
    return previous or resolved, False


def sync_embedded_review_dates_for_books(
    books: list[dict],
    *,
    repo_root: Path,
    reviews_dir_name: str = "reviews",
) -> int:
    """Scan mirrored reviews/*.html and sync reviewDate from trailing YYYY/MM/DD."""
    updated = 0
    reviews_dir = repo_root / reviews_dir_name
    meta_re = re.compile(
        r'(<p class="meta">Fecha de reseña: )\d{4}-\d{2}-\d{2}(</p>)',
        re.IGNORECASE,
    )
    for book in books:
        review_url = str(book.get("reviewUrl") or "")
        match = re.search(r"/review/show/(\d+)", review_url)
        if not match:
            continue
        html_path = reviews_dir / f"{match.group(1)}.html"
        if not html_path.exists():
            continue
        try:
            body = extract_review_body_from_html(
                html_path.read_text(encoding="utf-8", errors="ignore"),
            )
        except OSError:
            continue
        if not body:
            continue
        date, changed = apply_embedded_review_date_if_present(book, review_text=body)
        if not changed:
            continue
        updated += 1
        try:
            raw = html_path.read_text(encoding="utf-8")
            new_raw = meta_re.sub(rf"\g<1>{date}\g<2>", raw, count=1)
            if new_raw != raw:
                html_path.write_text(new_raw, encoding="utf-8")
        except OSError:
            pass
    return updated


def apply_review_date_on_first_text_sync(
    book: dict,
    *,
    review_text: str,
    first_download_at: datetime | None = None,
) -> str:
    """Set reviewTextFirstSyncedAt + reviewDate on first sync; return date for HTML."""
    existing = str(book.get("reviewDate") or "").strip()
    if not should_assign_review_date_on_mirror(book):
        return existing

    now = first_download_at or datetime.now(timezone.utc)
    book["reviewTextFirstSyncedAt"] = now.isoformat()
    resolved = resolve_review_date_from_text(
        review_text=review_text,
        date_read=str(book.get("dateRead") or ""),
        first_download_at=now,
    )
    book["reviewDate"] = resolved
    return resolved


def review_date_for_mirror_html(
    book: dict,
    *,
    review_text: str,
    rss_review_date: str = "",
    first_download_at: datetime | None = None,
) -> str:
    """Pick reviewDate for mirrored HTML + library.json."""
    if review_text.strip() and should_assign_review_date_on_mirror(book):
        return apply_review_date_on_first_text_sync(
            book,
            review_text=review_text,
            first_download_at=first_download_at,
        )
    if review_text.strip():
        date, _ = apply_embedded_review_date_if_present(book, review_text=review_text)
        if date:
            return date
    stored = str(book.get("reviewDate") or "").strip()
    if stored:
        return stored
    return normalize_iso_date(rss_review_date) or str(rss_review_date or "").strip()[:10]


def _self_test() -> None:
    assert parse_embedded_review_date("<p>Texto final.</p><p>2026/07/03</p>") == "2026-07-03"
    assert parse_embedded_review_date("Sin fecha al final") == ""
    assert (
        resolve_review_date_from_text(
            review_text="Hola",
            date_read="2026-06-01",
            first_download_at=datetime(2026, 7, 3, tzinfo=timezone.utc),
        )
        == "2026-07-03"
    )
    assert (
        resolve_review_date_from_text(
            review_text="Hola",
            date_read="2026-06-01",
            first_download_at=datetime(2026, 5, 20, tzinfo=timezone.utc),
        )
        == "2026-06-01"
    )
    book: dict = {"dateRead": "2026-06-01"}
    assert (
        apply_review_date_on_first_text_sync(book, review_text="Fin 2026/07/02")
        == "2026-07-02"
    )
    assert book["reviewTextFirstSyncedAt"]
    assert apply_review_date_on_first_text_sync(book, review_text="Otro 2099/01/01") == "2026-07-02"

    legacy = {
        "dateRead": "2026-06-01",
        "reviewDate": "2026-05-01",
        "reviewLocalGeneratedAt": "2026-04-01T00:00:00+00:00",
        "reviewLocalUrl": "./reviews/123.html",
        "reviewLocalStatus": "ok",
    }
    assert not should_assign_review_date_on_mirror(legacy)
    assert apply_review_date_on_first_text_sync(legacy, review_text="Fin 2099/01/01") == "2026-05-01"

    synced, changed = apply_embedded_review_date_if_present(
        legacy,
        review_text="Texto final 2026/08/15",
    )
    assert synced == "2026-08-15"
    assert changed is True
    assert legacy["reviewDate"] == "2026-08-15"
    _, changed_again = apply_embedded_review_date_if_present(
        legacy,
        review_text="Texto final 2026/08/15",
    )
    assert changed_again is False


if __name__ == "__main__":
    _self_test()
    print("review_date_policy: ok")
