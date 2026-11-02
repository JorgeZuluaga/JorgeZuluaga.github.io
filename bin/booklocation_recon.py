#!/usr/bin/env python3
"""Conciliación: ubicaciones vs. catálogo. Escribe ISBN2 directamente en info/library-details.json
(y "isbn2" en info/library.json para libros que solo están allí), tras respaldar ambos en info/backup/.

Genera:
  - info/library-details-recon.json: copia del catálogo donde cada libro con una edición
    distinta escaneada recibe el campo "ISBN2" (ISBN secundario; varios separados por coma).
  - info/booklocation-recon.md: coincidencias aplicadas, dudosas, libros que faltan en el
    catálogo (candidatos a incluir) y códigos que no parecen ISBN válidos.

La página ubicaciones.html usa library-details-recon.json si existe.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

from reconcile_booklocation import isbn13, norm

AUTO_STRICT = 0.97  # título prácticamente igual (autor igual o desconocido)
AUTO_WITH_AUTHOR = 0.85  # título parecido pero con autor en común
REVIEW_MIN = 0.75


def tokens(author: str) -> set[str]:
    return {t for t in norm(author).split() if len(t) >= 3}


def title_forms(title: str, subtitle: str = "") -> set[str]:
    forms = {norm(title)}
    head = re.split(r"\s*[:–—]\s*|\s+-\s+", title, maxsplit=1)[0]
    forms.add(norm(head))
    if subtitle:
        forms.add(norm(f"{title} {subtitle}"))
    return {f for f in forms if f}


def valid_ean13(s: str) -> bool:
    if not re.fullmatch(r"\d{13}", s):
        return False
    total = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(s[:12]))
    return (10 - total % 10) % 10 == int(s[12])


def subset(a_forms: set[str], b_forms: set[str]) -> bool:
    """Un título contiene todas las palabras del otro (p. ej. con subtítulo o artículo añadido)."""
    return any(set(a.split()) <= set(b.split()) or set(b.split()) <= set(a.split()) for a in a_forms for b in b_forms)


def score(a_forms: set[str], b_forms: set[str]) -> float:
    return max(difflib.SequenceMatcher(None, a, b).ratio() for a in a_forms for b in b_forms)


def ask(isbn: str, title: str, author: str, where: str, row: dict, s: float) -> str | None:
    """Pregunta si el candidato es el mismo libro. Devuelve 's', 'n' o None (decidir después)."""
    print(f"\nLibro localizado: {title} — {author}  [{isbn}]  📍 {where}")
    print(f"  ¿Es el del catálogo?  {row.get('Title')} — {row.get('Author')}  [ISBN {row.get('ISBN') or 'sin ISBN'}]  (similitud {s:.2f})")
    while True:
        a = input("  [s] sí, es el mismo · [n] no · [Enter] decidir después: ").strip().lower()
        if a in ("s", "n", ""):
            return a or None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--booklocation", default="info/booklocation.json")
    ap.add_argument("--catalog", default="info/library-details.json")
    ap.add_argument("--report", default="info/backup/reconciliation.md")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    loc = json.loads((root / args.booklocation).read_text("utf-8"))
    cat = json.loads((root / args.catalog).read_text("utf-8"))
    lib = json.loads((root / "info/library.json").read_text("utf-8"))
    rows = cat["books"]

    dec_path = root / "info/booklocation-decisions.json"
    decisions = json.loads(dec_path.read_text("utf-8")) if dec_path.exists() else {}
    interactive = sys.stdin.isatty()
    changed = False

    # Respaldo con fecha antes de modificar nada.
    stamp = datetime.now().strftime("%Y%m%d")
    bdir = root / "info/backup"
    bdir.mkdir(parents=True, exist_ok=True)
    for name in ("library.json", "library-details.json"):
        dst = bdir / f"{name[:-5]}-{stamp}.json"
        if dst.exists():  # ya hay respaldo de hoy: este lleva también la hora
            dst = bdir / f"{name[:-5]}-{stamp}-{datetime.now().strftime('%H%M')}.json"
        shutil.copy2(root / "info" / name, dst)

    # Parte de los ISBN2 ya existentes: se conservan y cuentan como conocidos.
    known: set[str] = set()
    for r in rows:
        for raw in [r.get("ISBN"), *str(r.get("ISBN2", "")).split(",")]:
            k = isbn13(raw)
            if k:
                known.add(k)
    for b in lib.get("books", []):
        for raw in [b.get("isbn"), *str(b.get("isbn2", "")).split(",")]:
            k = isbn13(raw)
            if k:
                known.add(k)

    forms = [title_forms(r.get("Title", ""), r.get("Subtitle", "")) for r in rows]
    atoks = [tokens(r.get("Author", "")) for r in rows]
    locs = loc.get("locations", {})
    place = lambda code: (locs.get(code, {}).get("name") or code) + (f" ({locs[code]['key']})" if locs.get(code, {}).get("key") else "")

    libs = [(b, title_forms(b.get("title", "")), tokens(b.get("author", ""))) for b in lib.get("books", []) if b.get("title")]
    applied, review, missing, notisbn, inlib = [], [], [], [], []
    for isbn, info in loc.get("books", {}).items():
        title, author = info.get("title", ""), info.get("author", "")
        where = place(info.get("location", ""))
        invalid = not valid_ean13(isbn) or not isbn.startswith(("978", "979"))
        if invalid:
            notisbn.append((isbn, title, author, where))
        if isbn in known:
            continue
        if not title:
            missing.append((isbn, title, author, where))
            continue
        sf, st = title_forms(title), tokens(author)
        best = (0.0, -1, False)
        for i, row in enumerate(rows):
            s = score(sf, forms[i])
            common = bool(st & atoks[i])
            if (s, common) > (best[0], best[2]):
                best = (s, i, common)
        s, i, common = best
        unknown_author = not st or (i >= 0 and not atoks[i])
        ok = i >= 0 and (
            (s >= AUTO_STRICT and (common or unknown_author))
            or (s >= AUTO_WITH_AUTHOR and common and (s >= 0.92 or subset(sf, forms[i])))
        )
        item = (isbn, title, author, where, s, rows[i] if i >= 0 else None, common)
        if ok:
            applied.append(item)
            cur = [x for x in str(rows[i].get("ISBN2", "")).split(",") if x]
            rows[i]["ISBN2"] = ",".join(cur + [isbn])
        else:
            # ¿Está al menos en library.json (Goodreads)? Ahí no se puede añadir ISBN2.
            lb = max(((score(sf, f), bool(st & a), b) for b, f, a in libs), key=lambda x: (x[0], x[1]), default=(0, False, None))
            if lb[2] and ((lb[0] >= AUTO_STRICT and (lb[1] or not st)) or (lb[0] >= AUTO_WITH_AUTHOR and lb[1])):
                inlib.append((isbn, title, author, where, lb[0], lb[2]))
                cur = [x for x in str(lb[2].get("isbn2", "")).split(",") if x]
                lb[2]["isbn2"] = ",".join(cur + [isbn])
                continue
            if i >= 0 and s >= REVIEW_MIN:
                row = rows[i]
                d = decisions.get(isbn)
                if d and d.get("ok"):  # decisión guardada: se busca la fila por título y autor
                    row = next((r for r in rows if r.get("Title") == d["title"] and r.get("Author") == d["author"]), None)
                    if row is not None:
                        applied.append((isbn, title, author, where, s, row, common))
                        cur = [x for x in str(row.get("ISBN2", "")).split(",") if x]
                        if isbn not in cur:
                            row["ISBN2"] = ",".join(cur + [isbn])
                        continue
                    d = None
                same = d and d.get("title") == rows[i].get("Title") and d.get("author") == rows[i].get("Author")
                if not same:  # sin decisión previa, o el mejor candidato cambió
                    ans = ask(isbn, title, author, where, row, s) if interactive else None
                    if ans:
                        decisions[isbn] = {"ok": ans == "s", "title": row.get("Title"), "author": row.get("Author")}
                        changed = True
                    if ans == "s":
                        applied.append(item)
                        cur = [x for x in str(row.get("ISBN2", "")).split(",") if x]
                        row["ISBN2"] = ",".join(cur + [isbn])
                        continue
                    if ans is None:
                        review.append(item)
            missing.append((isbn, title, author, where))

    if changed:
        dec_path.write_text(json.dumps(decisions, indent=2, ensure_ascii=False, sort_keys=True) + "\n", "utf-8")
    (root / "info/library-details.json").write_text(json.dumps(cat, indent=2, ensure_ascii=False) + "\n", "utf-8")
    (root / "info/library.json").write_text(json.dumps(lib, indent=2, ensure_ascii=False) + "\n", "utf-8")

    total = len(loc.get("books", {}))
    # Libros prestados (ubicación «préstamo»): no son de tu biblioteca, no se reportan como problema.
    loaned = {x[0] for x in missing if "prestamo" in norm(x[3]) or "prestaron" in norm(x[3])}
    missing = [x for x in missing if x[0] not in loaned]
    problems = {x[0] for x in missing}
    rev = {x[0]: x for x in review}
    bad = {x[0]: x for x in notisbn}
    miss = {x[0] for x in missing}
    L = ["# Conciliación de ubicaciones: libros con problemas", "",
         f"Generado: {datetime.now().strftime('%Y-%m-%d %H:%M')} · Respaldos en `info/backup/` (`*-{stamp}.json`).", "",
         f"- Libros localizados: **{total}**",
         f"- Sin problemas: **{total - len(problems)}** (ya en el catálogo: {total - len(applied) - len(missing) - len(inlib)}, `ISBN2` asignado en `library-details.json`: {len(applied)}, `isbn2` asignado en `library.json`: {len(inlib)})",
         f"- Con problemas: **{len(problems)}** (no están en el catálogo; {len([x for x in notisbn if x[0] in problems])} de ellos además con ISBN no válido). Un ISBN no válido solo es problema si el libro no está en el catálogo. Excluidos por estar en préstamo: {len(loaned)}", "",
         f"## Libros con problemas ({len(problems)})", "",
         "| ISBN | Título | Autor | Ubicación | Problema |", "|---|---|---|---|---|"]
    for isbn, t, a, w in sorted(missing, key=lambda x: (norm(x[3]), norm(x[1] or "~"))):
        notes = ["no está en el catálogo"] if isbn in miss else []
        if isbn in rev:
            r = rev[isbn][5]
            notes[0] += f" (¿? parecido a «{r.get('Title')}» — {r.get('Author')}, {r.get('ISBN') or 'sin ISBN'}, {rev[isbn][4]:.2f})"
        if isbn in bad:
            notes.append("ISBN no válido" + ("" if isbn in miss else " (código del producto; ya conciliado por título, ISBN2 asignado)"))
        L.append(f"| {isbn} | {t or '(sin título)'} | {a} | {w} | {'; '.join(notes)} |")
    rep = root / args.report
    rep.parent.mkdir(parents=True, exist_ok=True)
    rep.write_text("\n".join(L) + "\n", "utf-8")
    print(f"OK: ISBN2 en detalles {len(applied)}, isbn2 en library.json {len(inlib)}, con problemas {len(problems)} (no-ISBN: {len([x for x in notisbn if x[0] in problems])})")
    print(f"    respaldo info/backup/*-{stamp}.json · {args.report}")


if __name__ == "__main__":
    main()
