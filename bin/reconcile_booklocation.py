#!/usr/bin/env python3
"""Concilia info/booklocation.json con el catálogo (library-details + library).

Para cada libro escaneado cuyo ISBN no está en el catálogo, busca por título
(y autor si hay) el libro más parecido. Escribe un informe en Markdown y, con
--apply, guarda las coincidencias seguras en info/booklocation-aliases.json
(ISBN escaneado -> ISBN del catálogo). No modifica library*.json.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import unicodedata
from pathlib import Path


def norm(value: object) -> str:
    t = unicodedata.normalize("NFKD", str(value or "").lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"\([^)]*\)", " ", t)
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", t)).strip()


def isbn13(raw: object) -> str:
    s = re.sub(r"[\s-]", "", str(raw or "")).upper()
    if re.fullmatch(r"\d{13}", s):
        return s
    if re.fullmatch(r"\d{9}[\dX]", s):
        core = "978" + s[:9]
        total = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(core))
        return core + str((10 - total % 10) % 10)
    return ""


def load_catalog(root: Path) -> list[dict]:
    rows: list[dict] = []
    det = json.loads((root / "info/library-details.json").read_text("utf-8"))
    for b in det.get("books", []):
        rows.append({"title": b.get("Title", ""), "author": b.get("Author", ""), "isbn": isbn13(b.get("ISBN"))})
    lib = json.loads((root / "info/library.json").read_text("utf-8"))
    for b in lib.get("books", []):
        rows.append({"title": b.get("title", ""), "author": b.get("author", ""), "isbn": isbn13(b.get("isbn"))})
    return [r for r in rows if r["title"]]


def best_match(title: str, author: str, catalog: list[dict]) -> tuple[float, dict | None]:
    t = norm(title)
    best: tuple[float, dict | None] = (0.0, None)
    for row in catalog:
        score = difflib.SequenceMatcher(None, t, norm(row["title"])).ratio()
        if author and norm(author) and norm(row["author"]):
            a_tokens, b_tokens = set(norm(author).split()), set(norm(row["author"]).split())
            if a_tokens & b_tokens:
                score += 0.1
        if score > best[0]:
            best = (score, row)
    return best


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--booklocation", default="info/booklocation.json")
    ap.add_argument("--report", default="update/booklocation-reconcile.md")
    ap.add_argument("--aliases", default="info/booklocation-aliases.json")
    ap.add_argument("--threshold", type=float, default=0.9, help="similitud mínima para --apply")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    loc = json.loads((root / args.booklocation).read_text("utf-8"))
    catalog = load_catalog(root)
    known = {r["isbn"] for r in catalog if r["isbn"]}

    aliases_path = root / args.aliases
    aliases = json.loads(aliases_path.read_text("utf-8")).get("aliases", {}) if aliases_path.exists() else {}

    matched, titled, untitled = [], [], []
    for isbn, info in loc.get("books", {}).items():
        if isbn in known or isbn in aliases:
            continue
        title, author = info.get("title", ""), info.get("author", "")
        if not title:
            untitled.append(isbn)
            continue
        score, row = best_match(title, author, catalog)
        (matched if row and score >= 0.75 else titled).append((isbn, title, score, row))

    lines = ["# Conciliación de ubicaciones", ""]
    lines.append(f"## Coincidencias por título ({len(matched)})")
    for isbn, title, score, row in matched:
        lines.append(f"- `{isbn}` «{title}» → «{row['title']}» ({row['author']}) `{row['isbn'] or 'sin ISBN'}` · similitud {score:.2f}")
    lines += ["", f"## Con título pero sin coincidencia ({len(titled)})"]
    lines += [f"- `{i}` «{t}»" for i, t, _, _ in titled]
    lines += ["", f"## Sin título ({len(untitled)})"]
    lines += [f"- `{i}`" for i in untitled]
    out = root / args.report
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", "utf-8")
    print(f"Informe: {out} (coinciden {len(matched)}, sin coincidencia {len(titled)}, sin título {len(untitled)})")

    if args.apply:
        for isbn, _, score, row in matched:
            if score >= args.threshold and row["isbn"]:
                aliases[isbn] = row["isbn"]
        aliases_path.write_text(json.dumps({"aliases": aliases}, indent=2, ensure_ascii=False) + "\n", "utf-8")
        print(f"Alias guardados: {len(aliases)} en {aliases_path}")


if __name__ == "__main__":
    main()
