#!/usr/bin/env python3
"""Envío de correos de nuevas reseñas vía Gmail SMTP (cuenta personal + contraseña de aplicación)."""

from __future__ import annotations

import argparse
import html
import smtplib
import sys
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, make_msgid
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_FROM_NAME = "Jorge Zuluaga - Biblioteca"
SEND_DELAY_SEC = 3.0
RECENT_FOOTER_LIMIT = 5


def normalize_credential(raw: str, *, strip_spaces: bool = False) -> str:
    """Limpia secretos copiados desde Google (espacios duros, NBSP, líneas extra)."""
    text = raw.replace("\ufeff", "")
    line = next((ln for ln in text.splitlines() if ln.strip()), text).strip()
    for ch in ("\u00a0", "\u202f", "\u2007"):
        line = line.replace(ch, " " if not strip_spaces else "")
    if strip_spaces:
        line = "".join(line.split())
    return line.strip()


def load_secret(name: str, *, strip_spaces: bool = False) -> str:
    path = REPO / ".secrets" / name
    if not path.exists():
        raise FileNotFoundError(f"Falta {path} (p. ej. contraseña de aplicación de Gmail).")
    return normalize_credential(path.read_text(encoding="utf-8"), strip_spaces=strip_spaces)


def _rating_stars(rating: object) -> str:
    try:
        value = int(float(rating))
    except (TypeError, ValueError):
        return ""
    value = max(0, min(5, value))
    return "★" * value + "☆" * (5 - value)


def _recent_without_featured(
    featured_reviews: list[dict],
    recent: list[dict] | None,
    *,
    limit: int = RECENT_FOOTER_LIMIT,
) -> list[dict]:
    """Quita las resaltadas y deja hasta `limit` reseñas para el pie del correo."""
    featured_ids = {
        str(item.get("id") or "").strip()
        for item in featured_reviews
        if str(item.get("id") or "").strip()
    }
    featured_urls = {
        str(item.get("url") or "").strip()
        for item in featured_reviews
        if str(item.get("url") or "").strip()
    }
    filtered: list[dict] = []
    for item in recent or []:
        item_id = str(item.get("id") or "").strip()
        item_url = str(item.get("url") or "").strip()
        if item_id and item_id in featured_ids:
            continue
        if item_url and item_url in featured_urls:
            continue
        filtered.append(item)
        if len(filtered) >= limit:
            break
    return filtered


def _featured_subject_title(featured_reviews: list[dict], *, lang: str) -> str:
    count = len(featured_reviews)
    if count <= 1:
        return str(featured_reviews[0].get("title") or "Nueva reseña")
    if lang == "en":
        return f"{count} new reviews"
    return f"{count} nuevas reseñas"


def _build_featured_block(
    review: dict,
    *,
    read_label: str,
    by_prefix: str,
    margin_top: str = "0",
) -> tuple[str, str]:
    title = str(review.get("title") or "Nueva reseña")
    author = str(review.get("author") or "")
    url = str(review.get("url") or "")
    cover_url = str(review.get("cover_url") or "")
    excerpt = str(review.get("excerpt") or "").strip()
    rating = _rating_stars(review.get("rating"))

    by_line = f"{by_prefix} {author}" if author else ""
    stars_line = f" ({rating})" if rating else ""

    text_lines = [title]
    if by_line:
        text_lines.append(by_line + stars_line)
    if excerpt:
        text_lines.extend(["", excerpt])
    text_lines.extend(["", url])
    text_block = "\n".join(text_lines)

    cover_html = ""
    if cover_url:
        cover_html = (
            f'<td style="vertical-align:top;padding-right:18px;width:168px;">'
            f'<a href="{html.escape(url)}">'
            f'<img src="{html.escape(cover_url)}" alt="" width="160" '
            f'style="display:block;max-width:160px;height:auto;border-radius:8px;'
            f'border:1px solid #ddd;" />'
            f"</a></td>"
        )

    meta_bits = []
    if author:
        meta_bits.append(html.escape(by_line))
    if rating:
        meta_bits.append(
            f'<span style="letter-spacing:0.04em;color:#b8860b;">{html.escape(rating)}</span>'
        )
    meta_html = " · ".join(meta_bits)

    excerpt_html = ""
    if excerpt:
        excerpt_html = (
            f'<p style="margin:0.75rem 0 0;line-height:1.55;color:#333;">'
            f"{html.escape(excerpt)}"
            f"</p>"
        )

    html_block = f"""\
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #e6e6e6;border-radius:12px;background:#fafafa;margin-top:{margin_top};">
    <tr>
      {cover_html}
      <td style="vertical-align:top;padding:16px 18px 16px 0;">
        <h2 style="margin:0;font-size:1.25rem;line-height:1.35;">
          <a href="{html.escape(url)}" style="color:#111;text-decoration:none;">{html.escape(title)}</a>
        </h2>
        <p style="margin:0.35rem 0 0;font-size:0.95rem;color:#555;">{meta_html}</p>
        {excerpt_html}
        <p style="margin:1rem 0 0;">
          <a href="{html.escape(url)}" style="color:#0b5cab;font-weight:600;text-decoration:none;">{read_label} →</a>
        </p>
      </td>
    </tr>
  </table>"""
    return text_block, html_block


def build_review_email(
    *,
    featured: dict,
    featured_reviews: list[dict] | None = None,
    recent: list[dict] | None = None,
    site_base: str,
    lang: str = "es",
    unsubscribe_url: str = "",
) -> tuple[str, str, str]:
    """`recent`: hasta 5 reseñas recientes para el pie, sin incluir las resaltadas."""
    base = site_base.rstrip("/")
    featured_list = featured_reviews if featured_reviews else [featured]
    recent = _recent_without_featured(featured_list, recent, limit=RECENT_FOOTER_LIMIT)
    subject_title = _featured_subject_title(featured_list, lang=lang)
    multiple = len(featured_list) > 1

    if lang == "en":
        if multiple:
            subject = f"New reviews by Jorge Zuluaga: {subject_title}"
            intro_body = (
                "Thank you for subscribing to this automatic notification of my book reviews. "
                "I published new reviews in my personal library. "
                "Leave me your reaction and share them, if you find them worthwhile, "
                "with other people passionate about books."
            )
        else:
            subject = f"A new review by Jorge Zuluaga: {subject_title}"
            intro_body = (
                "Thank you for subscribing to this automatic notification of my book reviews. "
                "I published a new review in my personal library. "
                "Leave me your reaction and share it, if you find it worthwhile, "
                "with other people passionate about books."
            )
        intro_paragraphs = ["Hello,", intro_body]
        read_label = "Read full review"
        recent_heading = "Latest published reviews"
        by_prefix = "by"
        unsubscribe_label = "Unsubscribe"
    else:
        if multiple:
            subject = f"Nuevas reseñas de Jorge Zuluaga: {subject_title}"
            intro_body = (
                "Gracias por suscribirte a esta notificación automática de mis reseñas de libros. "
                "Te cuento que publiqué nuevas reseñas en mi biblioteca personal. "
                "Déjame tu reacción y compártelas, si las consideras chévere, "
                "con otras personas apasionadas por los libros."
            )
        else:
            subject = f"Una nueva reseña de Jorge Zuluaga: {subject_title}"
            intro_body = (
                "Gracias por suscribirte a esta notificación automática de mis reseñas de libros. "
                "Te cuento que publiqué una nueva reseña en mi biblioteca personal. "
                "Déjame tu reacción y compártela, si la consideras chévere, "
                "con otras personas apasionadas por los libros."
            )
        intro_paragraphs = ["Hola,", intro_body]
        read_label = "Leer reseña completa"
        recent_heading = "Últimas reseñas publicadas"
        by_prefix = "de"
        unsubscribe_label = "No me envíes más notificaciones"

    featured_text_blocks: list[str] = []
    featured_html_blocks: list[str] = []
    for idx, review in enumerate(featured_list):
        text_block, html_block = _build_featured_block(
            review,
            read_label=read_label,
            by_prefix=by_prefix,
            margin_top="0" if idx == 0 else "1rem",
        )
        featured_text_blocks.append(text_block)
        featured_html_blocks.append(html_block)

    text_lines = [*intro_paragraphs, ""]
    for idx, block in enumerate(featured_text_blocks):
        if idx:
            text_lines.append("")
        text_lines.append(block)
    if recent:
        text_lines.extend(["", recent_heading + ":", ""])
        for item in recent:
            item_title = str(item.get("title") or "Reseña")
            item_author = str(item.get("author") or "")
            item_url = str(item.get("url") or "")
            suffix = f" — {item_author}" if item_author else ""
            text_lines.append(f"- {item_title}{suffix}")
            if item_url:
                text_lines.append(f"  {item_url}")
    text_lines.extend(["", "-- Jorge Zuluaga"])
    if unsubscribe_url:
        text_lines.extend(["", f"{unsubscribe_label}: {unsubscribe_url}"])
    text = "\n".join(text_lines)

    recent_items_html = []
    for item in recent:
        item_title = str(item.get("title") or "Reseña")
        item_author = str(item.get("author") or "")
        item_url = str(item.get("url") or "")
        author_bit = f' <span style="color:#666;">— {html.escape(item_author)}</span>' if item_author else ""
        recent_items_html.append(
            f'<li style="margin:0.45rem 0;">'
            f'<a href="{html.escape(item_url)}" style="color:#0b5cab;text-decoration:none;">'
            f"{html.escape(item_title)}</a>{author_bit}</li>"
        )

    footer = (
        f'<p style="color:#666;font-size:0.85em;margin-top:1.5rem;">'
        f'Jorge Zuluaga — <a href="{html.escape(base)}/biblioteca.html" '
        f'style="color:#0b5cab;">Biblioteca personal</a>'
    )
    if unsubscribe_url:
        footer += (
            f' · <a href="{html.escape(unsubscribe_url)}" '
            f'style="color:#0b5cab;">{html.escape(unsubscribe_label)}</a>'
        )
    footer += "</p>"

    intro_html = "".join(
        f'<p style="margin:0 0 {"0.75" if idx == 0 else "1"}rem;">{html.escape(para)}</p>'
        for idx, para in enumerate(intro_paragraphs)
    )

    recent_section_html = ""
    if recent:
        recent_section_html = (
            f'<h3 style="margin:1.5rem 0 0.5rem;font-size:1rem;">{html.escape(recent_heading)}</h3>'
            f'<ul style="margin:0;padding-left:1.2rem;">{"".join(recent_items_html)}</ul>'
        )

    html_body = f"""\
<div style="font-family:'Poppins',Arial,sans-serif;color:#222;line-height:1.5;max-width:640px;">
  {intro_html}
  {"".join(featured_html_blocks)}
  {recent_section_html}
  {footer}
</div>"""
    return subject, text, html_body


def build_message(
    *,
    user: str,
    to_addr: str,
    subject: str,
    text_body: str,
    html_body: str,
    from_name: str = DEFAULT_FROM_NAME,
    unsubscribe_url: str = "",
) -> MIMEMultipart:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = formataddr((from_name, user))
    msg["To"] = to_addr
    msg["Reply-To"] = user
    msg["Message-ID"] = make_msgid(domain=user.split("@", 1)[-1])
    if unsubscribe_url:
        msg["List-Unsubscribe"] = f"<{unsubscribe_url}>"
        msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))
    return msg


def send_gmail(
    *,
    to_addrs: list[str],
    subject: str,
    text_body: str,
    html_body: str,
    from_name: str = DEFAULT_FROM_NAME,
    smtp_user: str = "",
    smtp_password: str = "",
    unsubscribe_url: str = "",
    delay_sec: float = SEND_DELAY_SEC,
) -> list[str]:
    user = normalize_credential(smtp_user, strip_spaces=False) if smtp_user else load_secret("gmail-smtp-user")
    password = (
        normalize_credential(smtp_password, strip_spaces=True)
        if smtp_password
        else load_secret("gmail-app-password", strip_spaces=True)
    )
    recipients = [a.strip() for a in to_addrs if a.strip()]
    if not recipients:
        raise ValueError("No hay destinatarios.")

    sent: list[str] = []
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=60) as smtp:
        smtp.login(user, password)
        for idx, recipient in enumerate(recipients):
            if idx > 0 and delay_sec > 0:
                time.sleep(delay_sec)
            msg = build_message(
                user=user,
                to_addr=recipient,
                subject=subject,
                text_body=text_body,
                html_body=html_body,
                from_name=from_name,
                unsubscribe_url=unsubscribe_url,
            )
            smtp.send_message(msg, from_addr=user, to_addrs=[recipient])
            sent.append(recipient)
    return sent


def main() -> int:
    parser = argparse.ArgumentParser(description="Enviar correo de reseñas vía Gmail SMTP.")
    parser.add_argument("--to", action="append", default=[], help="Destinatario (repetible).")
    parser.add_argument("--title", default="Libro de prueba")
    parser.add_argument("--author", default="Autor de prueba")
    parser.add_argument("--url", default="https://jorgezuluaga.github.io/reviews/")
    parser.add_argument("--site-base", default="https://jorgezuluaga.github.io")
    args = parser.parse_args()

    if not args.to:
        print("Indique --to email@ejemplo.com", file=sys.stderr)
        return 1

    featured = {
        "title": args.title,
        "author": args.author,
        "url": args.url,
        "cover_url": "",
        "excerpt": "",
    }
    subject, text, html_body = build_review_email(
        featured=featured, recent=[featured], site_base=args.site_base
    )
    send_gmail(to_addrs=args.to, subject=subject, text_body=text, html_body=html_body)
    print(f"Enviado a {len(args.to)} destinatario(s): {', '.join(args.to)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
