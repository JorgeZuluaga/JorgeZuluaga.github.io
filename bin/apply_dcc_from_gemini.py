#!/usr/bin/env python3
"""Aplica clasificaciones DCC desde archivos Gemini a library.json y library-details.json.

Qué hace:
1) Limpia clasificaciones antiguas:
   - library.json: elimina ddc, dcc, ddc_topic, dcc_topic
   - library-details.json: limpia DDC/DCC a "" y elimina ddc_topic/dcc_topic
2) Agrega nuevos campos por libro clasificado:
   - dcc_classes: clases principales (ej. 500 -> Ciencias Puras)
   - dcc_codes: códigos detectados (suggested + alternatives)
   - dcc_notes: reasoning/confidence (el de mayor confianza)

Uso:
  python3 bin/apply_dcc_from_gemini.py update/books-to-classify/gemini-code-*.json

Opciones:
  --library-json info/library.json
  --library-details info/library-details.json
  --dewey-plain assets/dewey-classes-plain.txt
  --dry-run
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


MAIN_CLASS_RE = re.compile(r"^(.+?)\s*\((\d{3})\)\s*$")
END_CODE_RE = re.compile(r"\((\d{3}(?:\.\d+)?)\)\s*$")


@dataclass
class BookAgg:
    codes: dict[str, str]
    notes_reasoning: str
    notes_confidence: float


def normalize_code(value: Any) -> str | None:
    """Normaliza códigos DCC/DDC a string estable.

    Ejemplos:
    - 560 -> "560"
    - 567.9 -> "567.9"
    - "560.0" -> "560"
    - " 567.90 " -> "567.9"
    """
    if value is None:
        return None

    if isinstance(value, int):
        return str(value)

    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return (f"{value}").rstrip("0").rstrip(".")

    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        m = re.search(r"\d{3}(?:\.\d+)?", s)
        if not m:
            return None
        token = m.group(0)
        try:
            fv = float(token)
            if fv.is_integer():
                return str(int(fv))
            return token.rstrip("0").rstrip(".")
        except ValueError:
            return token

    return None


def code_to_main_class(code: str) -> str | None:
    try:
        base = int(float(code))
    except ValueError:
        return None
    return f"{(base // 100) * 100:03d}"


def normalized_title_author(title: str, author: str) -> str:
    t = re.sub(r"\s+", " ", (title or "").strip().lower())
    a = re.sub(r"\s+", " ", (author or "").strip().lower())
    return f"{t}::{a}"


def generated_details_id(book: dict[str, Any], idx: int) -> str | None:
    title = (book.get("Title") or "").strip()
    author = (book.get("Author") or "").strip()
    if not title and not author:
        return None
    seed = f"details_{title}_{author}_{idx}"
    return "gen_" + hashlib.md5(seed.encode("utf-8")).hexdigest()[:12]


def load_dewey_maps(dewey_plain_path: Path) -> tuple[dict[str, str], dict[str, str]]:
    """Construye dos mapas:
    - main_classes: "500" -> "Ciencias Puras"
    - code_names: "560" -> "Paleontologia"
    """
    text = dewey_plain_path.read_text(encoding="utf-8")
    main_classes: dict[str, str] = {}
    code_names: dict[str, str] = {}

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue

        # Línea principal: "Ciencias Puras (500)"
        mm = MAIN_CLASS_RE.match(line)
        if mm:
            name, code = mm.groups()
            if code.endswith("00"):
                short_name = name.split(" - ", 1)[0].strip()
                main_classes[code] = short_name

        # Nombre de código al final de la línea
        m_end = END_CODE_RE.search(line)
        if not m_end:
            continue

        code = normalize_code(m_end.group(1))
        if not code:
            continue

        # Tomar el segmento final del path como nombre del código
        body = line[: m_end.start()].strip()
        if " - " in body:
            name = body.split(" - ")[-1].strip()
        else:
            name = body.strip()

        if code and name and code not in code_names:
            code_names[code] = name

    return main_classes, code_names


def parse_classification_file(path: Path) -> list[dict[str, Any]]:
    raw = path.read_text(encoding="utf-8")

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # Gemini web a veces emite números con cero a la izquierda (ej. 001.01),
        # que no son JSON estricto. Los convertimos a string de forma segura
        # (solo fuera de strings JSON).
        repaired = quote_leading_zero_numbers(raw)
        try:
            data = json.loads(repaired)
        except json.JSONDecodeError as exc:
            recovered = recover_objects_from_broken_json(repaired)
            if recovered:
                print(
                    f"[WARN] {path} tiene JSON incompleto; "
                    f"se recuperaron {len(recovered)} objetos válidos."
                )
                return recovered
            print(f"[WARN] No se pudo parsear {path}: {exc}")
            return []

    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if isinstance(data, dict):
        for key in ("classifications", "booksForClassification", "books", "results"):
            if isinstance(data.get(key), list):
                return [x for x in data[key] if isinstance(x, dict)]
    return []


def quote_leading_zero_numbers(text: str) -> str:
    out: list[str] = []
    i = 0
    n = len(text)
    in_string = False
    escaped = False

    while i < n:
        ch = text[i]

        if in_string:
            out.append(ch)
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            i += 1
            continue

        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue

        if ch == "0" and i + 1 < n and text[i + 1].isdigit():
            prev = text[i - 1] if i > 0 else ""
            if prev in " \t\r\n:[,":
                j = i + 1
                while j < n and (text[j].isdigit() or text[j] == "."):
                    j += 1
                token = text[i:j]
                nxt = text[j] if j < n else ""
                if nxt in " \t\r\n,]}" and token.count(".") <= 1:
                    out.append('"')
                    out.append(token)
                    out.append('"')
                    i = j
                    continue

        out.append(ch)
        i += 1

    return "".join(out)


def recover_objects_from_broken_json(text: str) -> list[dict[str, Any]]:
    """Recupera objetos JSON válidos de un array dañado, cuando sea posible."""
    blocks: list[str] = []
    in_string = False
    escaped = False
    depth = 0
    start = -1

    for i, ch in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
            continue

        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
            continue

        if ch == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start >= 0:
                blocks.append(text[start : i + 1])
                start = -1

    out: list[dict[str, Any]] = []
    for blk in blocks:
        try:
            obj = json.loads(blk)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            out.append(obj)
    return out


def build_aggregations(
    files: list[Path],
    main_classes: dict[str, str],
    dewey_code_names: dict[str, str],
) -> tuple[dict[str, BookAgg], dict[str, str]]:
    agg: dict[str, BookAgg] = {}
    aliases: dict[str, str] = {}

    for f in files:
        items = parse_classification_file(f)
        for item in items:
            book_id = str(item.get("bookId", "")).strip()
            if not book_id:
                continue

            suggested = normalize_code(item.get("suggestedDDC"))
            suggested_name = str(item.get("suggestedDDCName", "")).strip()
            reasoning = str(item.get("reasoning", "")).strip()

            try:
                confidence = float(item.get("confidence", 0.0) or 0.0)
            except (TypeError, ValueError):
                confidence = 0.0

            if book_id not in agg:
                agg[book_id] = BookAgg(codes={}, notes_reasoning="", notes_confidence=-1.0)

            aliases[book_id] = book_id

            isbn = str(item.get("isbn", "")).strip()
            if isbn:
                aliases[f"isbn_{isbn}"] = book_id

            ta = normalized_title_author(
                str(item.get("title", "")).strip(),
                str(item.get("author", "")).strip(),
            )
            if ta != "::":
                aliases[f"ta::{ta}"] = book_id

            target = agg[book_id]

            # Código sugerido
            if suggested:
                # Preferir nombre español de dewey para códigos base conocidos
                name = dewey_code_names.get(suggested) or suggested_name
                if not name:
                    base = normalize_code(code_to_main_class(suggested))
                    if base:
                        name = dewey_code_names.get(base, "")
                if name:
                    target.codes[suggested] = name

            # Alternativas
            alternatives = item.get("alternativeDDC", [])
            if isinstance(alternatives, list):
                for alt in alternatives:
                    code = normalize_code(alt)
                    if not code:
                        continue
                    name = dewey_code_names.get(code)
                    if not name:
                        base = normalize_code(code_to_main_class(code))
                        if base:
                            name = dewey_code_names.get(base, "")
                    if name:
                        target.codes[code] = name

            # Conservar razonamiento con mayor confianza
            if confidence >= target.notes_confidence:
                target.notes_confidence = confidence
                target.notes_reasoning = reasoning

    return agg, aliases


def build_classes_from_codes(codes: dict[str, str], main_classes: dict[str, str]) -> dict[str, str]:
    classes: dict[str, str] = {}
    for code in codes.keys():
        c_main = code_to_main_class(code)
        if not c_main:
            continue
        name = main_classes.get(c_main)
        if name:
            classes[c_main] = name
    return dict(sorted(classes.items(), key=lambda kv: int(kv[0])))


def clean_old_fields_library_json(book: dict[str, Any]) -> None:
    for key in ("ddc", "dcc", "ddc_topic", "dcc_topic"):
        book.pop(key, None)


def clean_old_fields_library_details(book: dict[str, Any]) -> None:
    # Usuario pidió limpiar DCC; cubrimos DDC y DCC por robustez.
    if "DDC" in book:
        book["DDC"] = ""
    if "DCC" in book:
        book["DCC"] = ""

    for key in ("ddc", "dcc", "ddc_topic", "dcc_topic"):
        book.pop(key, None)


def apply_to_library_json(
    lib_path: Path,
    agg: dict[str, BookAgg],
    aliases: dict[str, str],
    main_classes: dict[str, str],
) -> tuple[int, int, int]:
    data = json.loads(lib_path.read_text(encoding="utf-8"))
    books = data.get("books", []) if isinstance(data, dict) else []

    cleaned = 0
    updated = 0
    updated_by_title_author = 0

    for b in books:
        if not isinstance(b, dict):
            continue
        clean_old_fields_library_json(b)
        cleaned += 1

        bid = str(b.get("bookId", "")).strip()
        key: str | None = None
        if bid and bid in agg:
            key = bid
        else:
            ta = normalized_title_author(b.get("title", ""), b.get("author", ""))
            alias_key = f"ta::{ta}"
            if alias_key in aliases:
                key = aliases[alias_key]
                updated_by_title_author += 1

        if key:
            info = agg[key]
            dcc_codes = dict(sorted(info.codes.items(), key=lambda kv: float(kv[0])))
            dcc_classes = build_classes_from_codes(dcc_codes, main_classes)

            b["dcc_classes"] = dcc_classes
            b["dcc_codes"] = dcc_codes
            b["dcc_notes"] = {
                "reasoning": info.notes_reasoning,
                "confidence": round(info.notes_confidence, 6) if info.notes_confidence >= 0 else 0.0,
            }
            updated += 1

    lib_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return cleaned, updated, updated_by_title_author


def apply_to_library_details(
    lib_path: Path,
    agg: dict[str, BookAgg],
    aliases: dict[str, str],
    main_classes: dict[str, str],
) -> tuple[int, int, int, int, int]:
    data = json.loads(lib_path.read_text(encoding="utf-8"))
    books = data.get("books", []) if isinstance(data, dict) else []

    cleaned = 0
    updated = 0
    updated_by_isbn = 0
    updated_by_gen = 0
    updated_by_title_author = 0

    for idx, b in enumerate(books):
        if not isinstance(b, dict):
            continue
        clean_old_fields_library_details(b)
        cleaned += 1

        bid = str(b.get("bookId", "")).strip()
        isbn = str(b.get("ISBN", "")).strip()

        key: str | None = None
        if bid and bid in agg:
            key = bid
        elif isbn:
            synthetic = f"isbn_{isbn}"
            if synthetic in aliases:
                key = aliases[synthetic]
                updated_by_isbn += 1

        if not key:
            synthetic_gen = generated_details_id(b, idx)
            if synthetic_gen and synthetic_gen in aliases:
                key = aliases[synthetic_gen]
                updated_by_gen += 1

        if not key:
            ta = normalized_title_author(b.get("Title", ""), b.get("Author", ""))
            alias_key = f"ta::{ta}"
            if alias_key in aliases:
                key = aliases[alias_key]
                updated_by_title_author += 1

        if key:
            info = agg[key]
            dcc_codes = dict(sorted(info.codes.items(), key=lambda kv: float(kv[0])))
            dcc_classes = build_classes_from_codes(dcc_codes, main_classes)

            b["dcc_classes"] = dcc_classes
            b["dcc_codes"] = dcc_codes
            b["dcc_notes"] = {
                "reasoning": info.notes_reasoning,
                "confidence": round(info.notes_confidence, 6) if info.notes_confidence >= 0 else 0.0,
            }
            updated += 1

    lib_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return cleaned, updated, updated_by_isbn, updated_by_gen, updated_by_title_author


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Aplica DCC desde archivos Gemini a library.json y library-details.json")
    p.add_argument("classification_files", nargs="+", help="Lista de archivos JSON (gemini-code-*.json)")
    p.add_argument("--library-json", default="info/library.json", help="Ruta de library.json")
    p.add_argument("--library-details", default="info/library-details.json", help="Ruta de library-details.json")
    p.add_argument("--dewey-plain", default="assets/dewey-classes-plain.txt", help="Ruta de dewey-classes-plain.txt")
    p.add_argument("--dry-run", action="store_true", help="Solo reporta, no escribe cambios")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    root = Path(__file__).resolve().parent.parent
    classification_files = [Path(f).resolve() for f in args.classification_files]
    lib_json = (root / args.library_json).resolve()
    lib_details = (root / args.library_details).resolve()
    dewey_plain = (root / args.dewey_plain).resolve()

    missing = [str(p) for p in [lib_json, lib_details, dewey_plain] + classification_files if not p.exists()]
    if missing:
        raise FileNotFoundError("No se encontraron rutas:\n- " + "\n- ".join(missing))

    main_classes, dewey_code_names = load_dewey_maps(dewey_plain)
    agg, aliases = build_aggregations(classification_files, main_classes, dewey_code_names)

    if args.dry_run:
        print(json.dumps({
            "classification_files": len(classification_files),
            "books_classified_detected": len(agg),
            "classification_aliases_detected": len(aliases),
            "library_json": str(lib_json),
            "library_details": str(lib_details),
            "dewey_plain": str(dewey_plain),
        }, ensure_ascii=False, indent=2))
        return

    cleaned_json, updated_json, updated_json_by_title_author = apply_to_library_json(lib_json, agg, aliases, main_classes)
    cleaned_details, updated_details, updated_details_by_isbn, updated_details_by_gen, updated_details_by_title_author = apply_to_library_details(lib_details, agg, aliases, main_classes)

    print(json.dumps({
        "classification_files": len(classification_files),
        "books_classified_detected": len(agg),
        "classification_aliases_detected": len(aliases),
        "library_json": {
            "cleaned_books": cleaned_json,
            "updated_books": updated_json,
            "updated_by_title_author": updated_json_by_title_author,
            "path": str(lib_json),
        },
        "library_details": {
            "cleaned_books": cleaned_details,
            "updated_books": updated_details,
            "updated_by_isbn": updated_details_by_isbn,
            "updated_by_gen": updated_details_by_gen,
            "updated_by_title_author": updated_details_by_title_author,
            "path": str(lib_details),
        },
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
