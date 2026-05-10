#!/usr/bin/env python3
"""Asegura que filas nuevas en library-details tengan dcc_classes vacío.

No rellena dcc_codes ni dcc_notes (reasoning/confidence): esos van vacíos hasta Gemini.
Solo añade la clave ``dcc_classes`` con objeto vacío si falta (marcador de pendiente).
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--library-details-json", default="info/library-details.json")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    root = Path(__file__).resolve().parent.parent
    path = root / args.library_details_json
    if not path.exists():
        raise SystemExit(f"No existe: {path}")

    print(f"[stub-dcc] Leyendo {path} …", flush=True)
    data = json.loads(path.read_text(encoding="utf-8"))
    books = data.get("books") if isinstance(data, dict) else None
    if not isinstance(books, list):
        raise SystemExit("Formato inválido: se esperaba {'books': [...]}")

    touched = 0
    for row in books:
        if not isinstance(row, dict):
            continue
        if "dcc_classes" in row:
            continue
        row["dcc_classes"] = {}
        touched += 1

    if args.dry_run:
        print(f"[dry-run] Filas que recibirían dcc_classes como objeto vacío -> {touched}")
        return 0

    if touched:
        data["generatedAt"] = datetime.now(timezone.utc).isoformat()
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"stub dcc_classes en {touched} filas -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
