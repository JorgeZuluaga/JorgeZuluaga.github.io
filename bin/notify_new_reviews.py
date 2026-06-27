#!/usr/bin/env python3
"""Detecta reseñas nuevas publicadas y notifica por correo a los suscriptores."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "bin"))

from review_notify_client import list_subscribers, worker_base  # noqa: E402
from review_notify_gmail import build_review_email, send_gmail  # noqa: E402
from review_word_count import extract_review_body_from_html  # noqa: E402

STATE_PATH = REPO / ".secrets" / "last-notified-reviews.json"
LIBRARY_JSON = REPO / "info" / "library.json"
SITE_BASE = "https://jorgezuluaga.github.io"
EXCERPT_MAX_CHARS = 600


def review_id_from_book(book: dict) -> str:
    local = str(book.get("reviewLocalUrl") or "")
    m = re.search(r"/(\d+)\.html", local)
    if m:
        return m.group(1)
    url = str(book.get("reviewUrl") or "")
    m = re.search(r"/review/show/(\d+)", url)
    return m.group(1) if m else ""


def is_library_duplicate_hidden(book: dict) -> bool:
    value = book.get("libraryDuplicateHidden")
    return value is True or value == 1 or value == "1"


def has_written_review(book: dict) -> bool:
    """Misma lógica que hasReview() en assets/library-page.js."""
    if "/review/show/" not in str(book.get("reviewUrl") or ""):
        return False
    if book.get("hasReview") is False:
        return False
    if book.get("hasReview") is True:
        return True
    wc = book.get("reviewCount")
    if isinstance(wc, (int, float)):
        return float(wc) >= 25
    return True


def qualifies_for_latest_reviews(book: dict) -> bool:
    """Libros que aparecen en «Últimas reseñas escritas» de biblioteca.html."""
    if is_library_duplicate_hidden(book):
        return False
    if not str(book.get("dateRead") or "").strip():
        return False
    if not str(book.get("reviewDate") or "").strip():
        return False
    if not has_written_review(book):
        return False
    return bool(review_id_from_book(book))


def review_sort_key(book: dict) -> tuple[str, int]:
    """reviewDate descendente; empate por id de reseña (más reciente en Goodreads)."""
    review_date = str(book.get("reviewDate") or "").strip()
    review_id = review_id_from_book(book)
    try:
        review_id_num = int(review_id)
    except ValueError:
        review_id_num = 0
    return review_date, review_id_num


def review_html_path(review_id: str) -> Path:
    return REPO / "reviews" / f"{review_id}.html"


def extract_cover_url(html_path: Path, book: dict, site_base: str) -> str:
    if html_path.exists():
        raw = html_path.read_text(encoding="utf-8", errors="ignore")
        match = re.search(r'<meta property="og:image" content="([^"]+)"', raw, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip()

    local = str(book.get("reviewLocalCoverUrl") or "").strip()
    if local.startswith("./"):
        local = local[2:]
    if local:
        return f"{site_base.rstrip('/')}/{local.lstrip('/')}"

    review_id = review_id_from_book(book)
    if review_id:
        return f"{site_base.rstrip('/')}/reviews/covers/{review_id}.jpg"
    return ""


def first_paragraph_from_html(html_path: Path, *, max_chars: int = EXCERPT_MAX_CHARS) -> str:
    if not html_path.exists():
        return ""
    raw = html_path.read_text(encoding="utf-8", errors="ignore")
    body = extract_review_body_from_html(raw)
    if not body:
        return ""
    parts = [part.strip() for part in re.split(r"\n\s*\n", body) if part.strip()]
    paragraph = parts[0] if parts else body.strip()
    if len(paragraph) <= max_chars:
        return paragraph
    trimmed = paragraph[: max_chars - 1].rsplit(" ", 1)[0]
    return f"{trimmed}…"


def book_to_review_payload(book: dict, site_base: str) -> dict:
    review_id = review_id_from_book(book)
    html_path = review_html_path(review_id)
    return {
        "id": review_id,
        "title": str(book.get("title") or "Reseña"),
        "author": str(book.get("author") or ""),
        "url": f"{site_base.rstrip('/')}/reviews/{review_id}.html",
        "rating": book.get("rating"),
        "review_date": str(book.get("reviewDate") or ""),
        "cover_url": extract_cover_url(html_path, book, site_base),
        "excerpt": first_paragraph_from_html(html_path),
    }


def list_recent_published_reviews(library: dict, *, limit: int = 5, site_base: str = SITE_BASE) -> list[dict]:
    books = [
        book
        for book in (library.get("books") or [])
        if isinstance(book, dict) and qualifies_for_latest_reviews(book)
    ]
    books.sort(key=review_sort_key, reverse=True)
    return [book_to_review_payload(book, site_base) for book in books[:limit]]


def load_state() -> dict:
    if not STATE_PATH.exists():
        return {"notifiedReviewIds": []}
    try:
        with STATE_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"notifiedReviewIds": []}
    ids = data.get("notifiedReviewIds") if isinstance(data, dict) else []
    return {"notifiedReviewIds": list(ids) if isinstance(ids, list) else []}


def save_state(notified_ids: list[str]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "notifiedReviewIds": sorted(set(notified_ids)),
    }
    with STATE_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")


def find_new_review_books(library: dict, already: set[str]) -> list[dict]:
    books = library.get("books") or []
    new_books: list[dict] = []
    for book in books:
        if not isinstance(book, dict):
            continue
        if not qualifies_for_latest_reviews(book):
            continue
        review_id = review_id_from_book(book)
        if not review_id or review_id in already:
            continue
        new_books.append(book)
    new_books.sort(key=review_sort_key, reverse=True)
    return new_books


def send_notification(
    *,
    featured: dict,
    recent: list[dict],
    subscribers: list[dict],
    emails: list[str],
    test_to: str = "",
) -> int:
    wbase = worker_base()
    sent = 0
    recipients = subscribers or [{"email": email} for email in emails]
    seen_emails: set[str] = set()
    for sub in recipients:
        email = str(sub.get("email") or "").strip()
        if not email:
            continue
        normalized = email.lower()
        if normalized in seen_emails:
            continue
        seen_emails.add(normalized)
        if test_to and email.lower() != test_to.strip().lower():
            continue
        token = str(sub.get("unsubscribeToken") or "").strip()
        unsub = f"{wbase}/unsubscribe?token={token}" if token else ""
        subject, text, html_body = build_review_email(
            featured=featured,
            recent=recent,
            site_base=SITE_BASE,
            unsubscribe_url=unsub,
        )
        send_gmail(
            to_addrs=[email],
            subject=subject,
            text_body=text,
            html_body=html_body,
            unsubscribe_url=unsub,
        )
        sent += 1
    return sent


def main() -> int:
    parser = argparse.ArgumentParser(description="Notificar por correo reseñas recién publicadas.")
    parser.add_argument("--dry-run", action="store_true", help="Solo listar reseñas nuevas.")
    parser.add_argument("--test-send", action="store_true", help="Enviar correo de prueba a suscriptores.")
    parser.add_argument("--test-to", default="", help="En prueba, enviar solo a este correo.")
    parser.add_argument("--library-json", default=str(LIBRARY_JSON))
    args = parser.parse_args()

    subs_resp = list_subscribers()
    if not subs_resp.get("ok"):
        print(f"Error listando suscriptores: {subs_resp}", file=sys.stderr)
        return 1
    emails = list(subs_resp.get("emails") or [])
    subscribers = list(subs_resp.get("subscribers") or [])
    if not emails and subscribers:
        emails = [str(s.get("email") or "") for s in subscribers if s.get("email")]
    if not emails:
        print("No hay suscriptores confirmados.", file=sys.stderr)
        return 0

    with Path(args.library_json).open("r", encoding="utf-8") as f:
        library = json.load(f)

    recent = list_recent_published_reviews(library, limit=6)
    if not recent:
        print("No hay reseñas publicadas en la biblioteca.", file=sys.stderr)
        return 1

    if args.test_send:
        featured = recent[0]
        sent = send_notification(
            featured=featured,
            recent=recent,
            subscribers=subscribers,
            emails=emails,
            test_to=args.test_to,
        )
        print(f"Correo de prueba enviado a {sent} suscriptor(es).")
        print(f"  Destacada: {featured.get('title')}")
        return 0

    state = load_state()
    already = set(str(x) for x in state.get("notifiedReviewIds") or [])
    new_books = find_new_review_books(library, already)
    if not new_books:
        print("Sin reseñas nuevas para notificar.")
        return 0

    featured = book_to_review_payload(new_books[0], SITE_BASE)
    new_reviews = [book_to_review_payload(book, SITE_BASE) for book in new_books]

    print(f"Reseñas nuevas ({len(new_reviews)}):")
    for review in new_reviews:
        print(f"  - {review.get('title')} → {review.get('url')}")
    print(f"Destacada en el correo: {featured.get('title')}")

    if args.dry_run:
        return 0

    sent = send_notification(
        featured=featured,
        recent=recent,
        subscribers=subscribers,
        emails=emails,
    )
    updated = already | {str(review["id"]) for review in new_reviews if review.get("id")}
    save_state(sorted(updated))
    print(f"Notificación enviada a {sent} suscriptor(es).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
