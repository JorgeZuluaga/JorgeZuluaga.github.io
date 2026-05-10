#!/usr/bin/env python3
"""Apply Dewey classification and metadata from update/books_classification_manual.xlsx."""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_XLSX = ROOT / "update" / "books_classification_manual.xlsx"
LIB_JSON = ROOT / "info" / "library.json"
DET_JSON = ROOT / "info" / "library-details.json"

CLASS_CELL_RE = re.compile(r"^(.+?)\s*\((\d{3})\)\s*$")
CODE_CELL_RE = re.compile(r"^(.+?)\s*\((\d{3}(?:\.\d+)?)\)\s*$")


def norm_ws(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def norm_title_author_key(title: str, author: str) -> str:
    return f"{norm_ws(title).lower()}|{norm_ws(author).lower()}"


def excel_scalar(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        s = str(value).strip()
        if re.fullmatch(r"\d+\.0", s):
            return s[:-2]
        return s
    return str(value).strip()


def normalize_isbn_digits(raw: object) -> str:
    s = excel_scalar(raw) or ""
    return "".join(c for c in s if c.isdigit()).upper()


def parse_cross(value: object) -> tuple[str, str | None]:
    """Returns (kind, payload). kind in: empty, repetido, isbn, bookid."""
    s = excel_scalar(value)
    if not s:
        return ("empty", None)
    u = s.upper().strip()
    if u == "REPETIDO":
        return ("repetido", None)
    digits = "".join(c for c in s if c.isdigit())
    if len(digits) >= 13:
        return ("isbn", digits)
    if len(digits) == 10:
        return ("isbn", digits)
    if digits.isdigit() and len(digits) <= 12:
        return ("bookid", digits)
    return ("empty", None)


def confidence_float(value: object) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip().replace(",", "."))
    except ValueError:
        return None


def parse_classification(clase_cells: list[str], code_cells: list[str]) -> tuple[dict[str, str], dict[str, str]]:
    dcc_classes: dict[str, str] = {}
    dcc_codes: dict[str, str] = {}
    seen_class: set[str] = set()

    for raw in clase_cells:
        cell = norm_ws(raw)
        if not cell:
            continue
        m = CLASS_CELL_RE.match(cell)
        if not m:
            continue
        desc, code = m.group(1).strip(), m.group(2)
        if code in seen_class:
            continue
        seen_class.add(code)
        dcc_classes[code] = cell

    seen_codes: set[str] = set()
    for raw in code_cells:
        cell = norm_ws(raw)
        if not cell:
            continue
        m = CODE_CELL_RE.match(cell)
        if not m:
            continue
        desc, code = m.group(1).strip(), m.group(2)
        if code in seen_codes:
            continue
        seen_codes.add(code)
        dcc_codes[code] = desc

    return dcc_classes, dcc_codes


def strip_legacy_classification(book: dict) -> None:
    for k in ("ddc", "dcc", "ddc_topic", "dcc_topic"):
        if k in book:
            book.pop(k, None)
    if book.get("DDC") is not None:
        book["DDC"] = ""


def find_details_book(
    books: list[dict],
    excel_isbn_raw: object,
    excel_title: str,
    excel_author: str,
) -> dict | None:
    want_isbn = normalize_isbn_digits(excel_isbn_raw)
    et, ea = norm_ws(excel_title), norm_ws(excel_author)
    if want_isbn:
        hits = [
            b
            for b in books
            if isinstance(b, dict) and normalize_isbn_digits(b.get("ISBN")) == want_isbn
        ]
        if len(hits) == 1:
            return hits[0]
        if len(hits) > 1:
            return None
        # ISBN en Excel sin coincidencia en JSON (ISBN vacío o distinto): ubicar por título/autor.

    # Title + author exact (normalized)
    key = norm_title_author_key(et, ea)
    hits = []
    for b in books:
        if not isinstance(b, dict):
            continue
        bk = norm_title_author_key(b.get("Title", ""), b.get("Author", ""))
        if bk == key:
            hits.append(b)
    if len(hits) == 1:
        return hits[0]

    # Relaxed title prefix + author equality
    et_low = et.lower()
    ea_low = ea.lower()
    loose = []
    for b in books:
        if not isinstance(b, dict):
            continue
        jt = norm_ws(b.get("Title", "")).lower()
        ja = norm_ws(b.get("Author", "")).lower()
        if ja != ea_low:
            continue
        if jt == et_low or jt.startswith(et_low + " ") or jt.startswith(et_low + "("):
            loose.append(b)
        elif et_low and et_low in jt and ja == ea_low:
            loose.append(b)
    return loose[0] if len(loose) == 1 else None


def load_rows(path: Path) -> list[dict]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb["Libros"]
    rows_out: list[dict] = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or row[0] is None:
            continue
        fuente = str(row[0]).strip()
        if fuente not in ("library.json", "library-details.json"):
            continue
        bid_or_isbn = row[1]
        rows_out.append(
            {
                "fuente": fuente,
                "id_cell": bid_or_isbn,
                "cross_raw": row[3],
                "title": row[4],
                "author": row[5],
                "clases": [row[6], row[7], row[8]],
                "codigos": [row[9], row[10], row[11]],
                "reasoning": row[12],
                "confidence": row[13],
            }
        )
    wb.close()
    return rows_out


def apply_row_to_library(book: dict, row: dict, stats: dict) -> None:
    strip_legacy_classification(book)
    t = excel_scalar(row["title"])
    a = excel_scalar(row["author"])
    if t:
        book["title"] = t
    if a:
        book["author"] = a

    classes, codes = parse_classification(
        [excel_scalar(x) or "" for x in row["clases"]],
        [excel_scalar(x) or "" for x in row["codigos"]],
    )
    book["dcc_classes"] = classes
    book["dcc_codes"] = codes
    reasoning = norm_ws(row["reasoning"])
    conf = confidence_float(row["confidence"])
    book["dcc_notes"] = {"reasoning": reasoning, "confidence": conf if conf is not None else 0.0}

    ck, payload = parse_cross(row["cross_raw"])
    if ck == "repetido":
        book["libraryDuplicateHidden"] = True
        stats["repetido_library"] += 1
    elif ck == "empty":
        book.pop("libraryDuplicateHidden", None)
    else:
        book.pop("libraryDuplicateHidden", None)

    if ck == "isbn" and payload:
        book["isbn"] = payload
        stats["cross_library_isbn"] += 1
    stats["updated_library"] += 1


def apply_row_to_details(book: dict, row: dict, stats: dict) -> None:
    strip_legacy_classification(book)
    id_digits = normalize_isbn_digits(row["id_cell"])
    if len(id_digits) in (10, 13):
        book["ISBN"] = id_digits

    t = excel_scalar(row["title"])
    a = excel_scalar(row["author"])
    if t:
        book["Title"] = t
    if a:
        book["Author"] = a

    classes, codes = parse_classification(
        [excel_scalar(x) or "" for x in row["clases"]],
        [excel_scalar(x) or "" for x in row["codigos"]],
    )
    book["dcc_classes"] = classes
    book["dcc_codes"] = codes
    reasoning = norm_ws(row["reasoning"])
    conf = confidence_float(row["confidence"])
    book["dcc_notes"] = {"reasoning": reasoning, "confidence": conf if conf is not None else 0.0}

    ck, payload = parse_cross(row["cross_raw"])
    if ck == "repetido":
        book["libraryDuplicateHidden"] = True
        stats["repetido_details"] += 1
    elif ck == "empty":
        book.pop("libraryDuplicateHidden", None)
    else:
        book.pop("libraryDuplicateHidden", None)

    if ck == "bookid" and payload:
        book["bookId"] = payload
        stats["cross_details_bookid"] += 1
    stats["updated_details"] += 1


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--xlsx", type=Path, default=DEFAULT_XLSX)
    p.add_argument("--library-json", type=Path, default=LIB_JSON)
    p.add_argument("--library-details", type=Path, default=DET_JSON)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    rows = load_rows(args.xlsx)
    stats = {
        "updated_library": 0,
        "updated_details": 0,
        "skipped_library": 0,
        "skipped_details": 0,
        "repetido_library": 0,
        "repetido_details": 0,
        "cross_library_isbn": 0,
        "cross_details_bookid": 0,
        "cross_nonempty_rows": 0,
    }

    for row in rows:
        if parse_cross(row["cross_raw"])[0] not in ("empty", "repetido"):
            stats["cross_nonempty_rows"] += 1

    with args.library_json.open(encoding="utf-8") as f:
        lib_root = json.load(f)
    with args.library_details.open(encoding="utf-8") as f:
        det_root = json.load(f)

    lib_books = lib_root.get("books") or []
    det_books = det_root.get("books") or []

    lib_by_id = {str(b.get("bookId", "")).strip(): b for b in lib_books if isinstance(b, dict)}

    for row in rows:
        if row["fuente"] == "library.json":
            bid = excel_scalar(row["id_cell"])
            if not bid:
                stats["skipped_library"] += 1
                continue
            book = lib_by_id.get(bid)
            if not book:
                stats["skipped_library"] += 1
                continue
            if args.dry_run:
                stats["updated_library"] += 1
                continue
            apply_row_to_library(book, row, stats)
        else:
            book = find_details_book(det_books, row["id_cell"], excel_scalar(row["title"]) or "", excel_scalar(row["author"]) or "")
            if not book:
                stats["skipped_details"] += 1
                continue
            if args.dry_run:
                stats["updated_details"] += 1
                continue
            apply_row_to_details(book, row, stats)

    if args.dry_run:
        print(json.dumps({**stats, "dry_run": True}, indent=2))
        return 0

    now = datetime.now(timezone.utc).isoformat()
    lib_root["generatedAt"] = now
    det_root["generatedAt"] = now

    args.library_json.write_text(json.dumps(lib_root, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.library_details.write_text(json.dumps(det_root, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(stats, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
