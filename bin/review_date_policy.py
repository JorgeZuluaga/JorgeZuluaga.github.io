#!/usr/bin/env python3
"""Resolve reviewDate from embedded YYYY/MM/DD in review text or first text sync."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from review_word_count import html_to_text

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
    """Pick reviewDate for mirrored HTML + library.json (first sync only updates JSON)."""
    if review_text.strip() and should_assign_review_date_on_mirror(book):
        return apply_review_date_on_first_text_sync(
            book,
            review_text=review_text,
            first_download_at=first_download_at,
        )
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


if __name__ == "__main__":
    _self_test()
    print("review_date_policy: ok")
