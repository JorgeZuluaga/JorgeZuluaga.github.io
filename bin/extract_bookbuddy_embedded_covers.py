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


ROW_SPLIT_MARKER = '<tr><td style="vertical-align: top;"><img src="data:image'
IMG_RE = re.compile(r'src="data:image/([^;"]+);base64,([^"]+)"', re.IGNORECASE | re.DOTALL)
ISBN_RE = re.compile(
    r"<b>\s*ISBN:\s*</b>\s*</span>\s*<span>\s*</span>\s*<span[^>]*>\s*([^<]+)\s*</span>",
    re.IGNORECASE | re.DOTALL,
)
TITLE_RE = re.compile(
    r"<b>\s*Title:\s*</b>\s*</span>\s*<span>\s*</span>\s*<span[^>]*>\s*([^<]+)\s*</span>",
    re.IGNORECASE | re.DOTALL,
)
FIELD_RE = re.compile(
    r"<b>\s*([^:<]+):\s*</b>\s*</span>\s*<span>\s*</span>\s*<span[^>]*>\s*([^<]*)\s*</span>",
    re.IGNORECASE | re.DOTALL,
)


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

    html_text = input_html.read_text(encoding="utf-8", errors="ignore")
    parts = html_text.split(ROW_SPLIT_MARKER)

    extracted = 0
    skipped_existing = 0
    replaced_size_changed = 0
    missing_isbn = 0
    invalid_image = 0
    rows_seen = 0
    seen_names: set[str] = set()
    results: list[dict] = []

    seq = 0
    for idx, part in enumerate(parts):
        if idx == 0:
            continue
        rows_seen += 1
        chunk = "data:image" + part

        img_match = IMG_RE.search(chunk)
        if not img_match:
            continue

        subtype = img_match.group(1)
        b64_data = img_match.group(2)
        image_bytes = maybe_decode_base64(b64_data)
        if not image_bytes or len(image_bytes) < 512:
            invalid_image += 1
            continue

        fields = {}
        for m in FIELD_RE.finditer(chunk):
            key = re.sub(r"\s+", " ", m.group(1)).strip().lower()
            val = m.group(2).strip()
            if key and key not in fields and val:
                fields[key] = val

        title_match = TITLE_RE.search(chunk)
        isbn_match = ISBN_RE.search(chunk)
        title = (title_match.group(1).strip() if title_match else fields.get("title", ""))
        author = fields.get("author", "")
        date_added = fields.get("date added", "")
        raw_isbn = (isbn_match.group(1).strip() if isbn_match else fields.get("isbn", ""))
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
