#!/usr/bin/env python3
"""Genera info/locationstats.md (libros por lugar y por lugar/espacio) desde info/booklocation.json.

Las ubicaciones tienen la forma Lugar/Espacio/Nivel; el nivel se agrupa dentro del espacio.
"""
import json
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "info" / "booklocation.json"
OUT = ROOT / "info" / "locationstats.md"


def main():
    data = json.loads(SRC.read_text(encoding="utf-8"))
    locs = data["locations"]
    by_loc = Counter(b["location"] for b in data["books"].values())

    places, spaces, nlocs = Counter(), Counter(), Counter()
    for code, loc in locs.items():
        parts = [p.strip() for p in loc["name"].split("/")]
        place = parts[0]
        space = "/".join(parts[:2])
        n = by_loc.get(code, 0)
        places[place] += n
        spaces[space] += n
        nlocs[place] += 1

    total = sum(by_loc.values())
    orphan = sum(n for c, n in by_loc.items() if c not in locs)
    key = lambda s: s.lower()

    lines = [
        "# Libros por ubicación",
        "",
        f"Generado: {datetime.now().strftime('%Y-%m-%d %H:%M')} · Respaldo: {data.get('updatedAt', '')}",
        "",
        f"**{total}** libros localizados en **{len(locs)}** ubicaciones.",
        "",
        "## Por lugar",
        "",
        "| Lugar | Libros | % | Ubicaciones |",
        "|---|---:|---:|---:|",
    ]
    for p in sorted(places, key=key):
        lines.append(f"| {p} | {places[p]} | {places[p] * 100 / total:.1f}% | {nlocs[p]} |" if total else f"| {p} | 0 | 0% | {nlocs[p]} |")
    lines += ["", "## Por lugar/espacio", "", "| Lugar/Espacio | Libros | % |", "|---|---:|---:|"]
    for s in sorted(spaces, key=key):
        lines.append(f"| {s} | {spaces[s]} | {spaces[s] * 100 / total:.1f}% |" if total else f"| {s} | 0 | 0% |")
    if orphan:
        lines += ["", f"> {orphan} libros apuntan a ubicaciones que ya no existen."]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"OK: {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
