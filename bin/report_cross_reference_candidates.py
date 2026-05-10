#!/usr/bin/env python3
"""Informe de cruces library.json ↔ library-details para revisión manual.

Lista filas en library-details sin bookId (o con bookId vacío) y candidatos en
library.json por título/autor normalizado. Si hay varios candidatos o ninguno,
queda marcado para corrección manual antes de ejecutar match_library_details_bookids.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from match_library_details_bookids import (
    author_compatible,
    build_indexes,
    normalize_text,
)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--library-json", default="info/library.json")
    ap.add_argument("--library-details-json", default="info/library-details.json")
    ap.add_argument("--out", default="update/cross-reference-report.md")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    lib_path = root / args.library_json
    det_path = root / args.library_details_json
    out_path = root / args.out

    print(f"[cross-ref] Analizando {det_path} vs {lib_path} …", flush=True)
    library_data = json.loads(lib_path.read_text(encoding="utf-8"))
    details_data = json.loads(det_path.read_text(encoding="utf-8"))

    goodreads_books = list(library_data.get("books") or [])
    by_title_author, by_title = build_indexes(goodreads_books)

    if isinstance(details_data, dict):
        details_books = details_data.get("books") or []
    else:
        details_books = details_data if isinstance(details_data, list) else []

    lines: list[str] = [
        "# Cruces sugeridos (library-details sin bookId)",
        "",
        "Revise cada fila; cuando esté conforme, ejecute `make library-details-match`.",
        "",
    ]

    for row in details_books:
        if not isinstance(row, dict):
            continue
        bid = str(row.get("bookId") or "").strip()
        if bid:
            continue
        title = str(row.get("Title") or "").strip()
        author = str(row.get("Author") or "").strip()
        nt = normalize_text(title)
        na = normalize_text(author)
        key_ta = f"{nt}|{na}"
        cands = list(by_title_author.get(key_ta, []))
        if not cands and nt:
            alt = []
            for gb in by_title.get(nt, []):
                if author_compatible(str(gb.get("author") or ""), author):
                    alt.append(gb)
            cands = alt

        lines.append(f"## {title} — {author}")
        lines.append("")
        if not cands:
            lines.append("- **Candidatos:** ninguno (revisar ISBN o título).")
        elif len(cands) == 1:
            b = cands[0]
            lines.append(
                f"- **Candidato único:** bookId `{b.get('bookId')}` "
                f"({b.get('title')} / {b.get('author')})"
            )
        else:
            lines.append("- **Varios candidatos:** elegir uno:")
            for b in cands:
                lines.append(
                    f"  - `{b.get('bookId')}` — {b.get('title')} ({b.get('author')}) "
                    f"— leído {b.get('dateRead') or '?'}"
                )
        lines.append("")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Informe escrito: {out_path} ({len(lines)} líneas)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
