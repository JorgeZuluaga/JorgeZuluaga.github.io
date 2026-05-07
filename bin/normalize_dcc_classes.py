#!/usr/bin/env python3
"""Normaliza etiquetas de dcc_classes a nombre corto.

Ejemplo:
"800": "Literatura y retorica (800) - Literatura, retorica y critica"
->
"800": "Literatura y retorica"
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


def normalize_class_label(code: str, label: str) -> str:
    text = (label or "").strip()

    # Si viene con estructura "Principal - detalle", conservar solo principal.
    if " - " in text:
        text = text.split(" - ", 1)[0].strip()

    # Eliminar ocurrencias del código entre paréntesis: (800), (300), etc.
    text = text.replace(f"({code})", "")
    text = re.sub(r"\(\s*\d{3}\s*\)", "", text)

    # Limpiar duplicados de espacios y bordes.
    text = re.sub(r"\s+", " ", text).strip(" -,:;")

    return text


def normalize_file(path: Path) -> tuple[int, int]:
    data = json.loads(path.read_text(encoding="utf-8"))
    books = data.get("books", []) if isinstance(data, dict) else []

    changed_books = 0
    changed_values = 0

    for book in books:
        if not isinstance(book, dict):
            continue

        dcc_classes = book.get("dcc_classes")
        if not isinstance(dcc_classes, dict):
            continue

        book_changed = False
        for code, label in list(dcc_classes.items()):
            if not isinstance(label, str):
                continue
            new_label = normalize_class_label(str(code), label)
            if new_label and new_label != label:
                dcc_classes[code] = new_label
                changed_values += 1
                book_changed = True

        if book_changed:
            changed_books += 1

    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return changed_books, changed_values


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Normaliza valores de dcc_classes en archivos de biblioteca")
    p.add_argument("files", nargs="+", help="Archivos JSON a procesar")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    report: dict[str, Any] = {"files": []}

    for f in args.files:
        path = Path(f).resolve()
        changed_books, changed_values = normalize_file(path)
        report["files"].append(
            {
                "path": str(path),
                "changed_books": changed_books,
                "changed_values": changed_values,
            }
        )

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
