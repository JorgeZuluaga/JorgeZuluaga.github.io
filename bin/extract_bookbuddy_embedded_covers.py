#!/usr/bin/env python3
"""Extract embedded (base64) cover images from a BookBuddy HTML export.

This script does NOT fetch from the internet. It only parses local .htm content.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup


def normalize_isbn(value: str) -> str:
    return re.sub(r"[^0-9Xx]", "", str(value or "")).upper()


def slugify(value: str, max_len: int = 36) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    if not s:
        return ""
    return s[:max_len]


def fallback_cover_id(*, row_index: int, title: str, author: str, date_added: str) -> str:
    basis = "|".join([str(row_index), title.strip().lower(), author.strip().lower(), date_added.strip().lower()])
    digest = hashlib.sha1(basis.encode("utf-8")).hexdigest()[:10]
    t = slugify(title, 22)
    a = slugify(author, 18)
    parts = [p for p in [t, a] if p]
    prefix = "-".join(parts) if parts else f"row-{row_index:04d}"
    return f"noisbn-{prefix}-{digest}"


def ext_from_mime_subtype(subtype: str) -> str:
    s = str(subtype or "").lower().strip()
    if s in {"jpeg", "jpg"}:
        return "jpg"
    if s in {"png", "webp", "gif", "bmp"}:
        return s
    return "jpg"


def maybe_decode_base64(raw: str) -> bytes | None:
    try:
        return base64.b64decode(raw, validate=True)
    except Exception:
        return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract BookBuddy embedded cover images from local HTML export.",
    )
    parser.add_argument(
        "--input-html",
        default="update/bookbuddy.htm",
        help="Path to BookBuddy HTML export.",
    )
    parser.add_argument(
        "--output-dir",
        default="antilibrary/covers",
        help="Destination directory for extracted covers.",
    )
    parser.add_argument(
        "--report-json",
        default="antilibrary/covers/extract-from-html-report.json",
        help="Path to extraction report JSON.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing files with same name.",
    )
    args = parser.parse_args()

    input_html = Path(args.input_html)
    output_dir = Path(args.output_dir)
    report_json = Path(args.report_json)

    if not input_html.exists():
        raise SystemExit(f"Input file not found: {input_html}")

    output_dir.mkdir(parents=True, exist_ok=True)
    report_json.parent.mkdir(parents=True, exist_ok=True)

    print(f"Reading {input_html}...")
    html_text = input_html.read_text(encoding="utf-8", errors="ignore")
    
    print("Parsing HTML...")
    soup = BeautifulSoup(html_text, 'html.parser')
    thumbnails = soup.find_all('img', alt='thumbnail')

    extracted = 0
    skipped_existing = 0
    replaced_size_changed = 0
    missing_isbn = 0
    invalid_image = 0
    rows_seen = 0
    seen_names: set[str] = set()
    results: list[dict] = []

    seq = 0
    for img in thumbnails:
        rows_seen += 1
        src = img.get('src')
        if not src or not src.startswith('data:image/'):
            continue
            
        match = re.match(r'data:image/([a-zA-Z0-9]+);base64,(.*)', src)
        if not match:
            continue
            
        subtype = match.group(1)
        b64_data = match.group(2)
        
        image_bytes = maybe_decode_base64(b64_data)
        if not image_bytes or len(image_bytes) < 512:
            invalid_image += 1
            continue
            
        # Traverse DOM to find details
        book_header_table = img.find_parent('table')
        title = ""
        author = ""
        date_added = ""
        
        if book_header_table:
            title_td = book_header_table.find('td', class_='title')
            if title_td:
                title = title_td.text.strip()
            author_td = book_header_table.find('td', class_='author')
            if author_td:
                author = author_td.text.strip()
                
        details_table = book_header_table.find_next_sibling('table') if book_header_table else None
        
        raw_isbn = ""
        if details_table:
            # Date Added
            date_label = details_table.find(string=re.compile('Date Added:'))
            if date_label:
                parent_td = date_label.find_parent('td')
                if parent_td:
                    spans = parent_td.find_all('span')
                    if len(spans) >= 3:
                        date_added = spans[2].text.strip()

            # ISBN
            isbn_label = details_table.find(string=re.compile('ISBN:'))
            if isbn_label:
                parent_td = isbn_label.find_parent('td')
                if parent_td:
                    spans = parent_td.find_all('span')
                    if len(spans) >= 3:
                        raw_isbn = spans[2].text.strip()

        isbn = normalize_isbn(raw_isbn)
        ext = ext_from_mime_subtype(subtype)

        if isbn:
            cover_id = isbn
            filename = f"{cover_id}.{ext}"
        else:
            cover_id = fallback_cover_id(
                row_index=rows_seen,
                title=title,
                author=author,
                date_added=date_added,
            )
            filename = f"{cover_id}.{ext}"
            missing_isbn += 1

        # Avoid collisions in same run (rare but possible for duplicated ISBN rows).
        if filename in seen_names:
            seq += 1
            stem = filename.rsplit(".", 1)[0]
            filename = f"{stem}-dup-{seq:04d}.{ext}"
        seen_names.add(filename)

        out_path = output_dir / filename
        
        # Cleanup old mismatching extension files
        if ext == 'jpg':
            old_png = output_dir / f"{cover_id}.png"
            if old_png.exists() and old_png != out_path:
                try:
                    old_png.unlink()
                except OSError:
                    pass
        elif ext == 'png':
            old_jpg = output_dir / f"{cover_id}.jpg"
            if old_jpg.exists() and old_jpg != out_path:
                try:
                    old_jpg.unlink()
                except OSError:
                    pass

        if out_path.exists() and not args.overwrite:
            existing_size = out_path.stat().st_size
            if existing_size == len(image_bytes):
                skipped_existing += 1
                status = "skipped_existing_same_size"
            else:
                out_path.write_bytes(image_bytes)
                replaced_size_changed += 1
                status = "replaced_size_changed"
        else:
            out_path.write_bytes(image_bytes)
            extracted += 1
            status = "extracted"

        results.append(
            {
                "rowIndex": rows_seen,
                "title": title,
                "author": author,
                "dateAddedRaw": date_added,
                "isbnRaw": raw_isbn,
                "isbn": isbn,
                "coverId": cover_id,
                "file": str(out_path),
                "bytes": len(image_bytes),
                "status": status,
            }
        )

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "inputHtml": str(input_html),
        "outputDir": str(output_dir),
        "rowsSeen": rows_seen,
        "extracted": extracted,
        "skippedExisting": skipped_existing,
        "replacedSizeChanged": replaced_size_changed,
        "missingIsbn": missing_isbn,
        "invalidImage": invalid_image,
        "results": results,
    }
    report_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(
        "rows="
        f"{rows_seen} extracted={extracted} "
        f"replaced_size_changed={replaced_size_changed} "
        f"skipped_existing={skipped_existing}"
    )
    print(f"missing_isbn={missing_isbn} invalid_image={invalid_image}")
    print(f"report={report_json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
