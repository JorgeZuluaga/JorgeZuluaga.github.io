#!/usr/bin/env python3
"""Update info/library-stats.json from info/library.json."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime
from pathlib import Path


def read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def parse_date(value: str) -> datetime | None:
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d")
    except ValueError:
        return None


def has_review(item: dict) -> bool:
    return "/review/show/" in str(item.get("reviewUrl") or "")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate info/library-stats.json from info/library.json."
    )
    parser.add_argument(
        "library_json",
        help="Path to info/library.json",
    )
    parser.add_argument(
        "--out",
        default="info/library-stats.json",
        help="Output JSON path.",
    )
    args = parser.parse_args()

    in_path = Path(args.library_json)
    out_path = Path(args.out)
    if not in_path.exists():
        raise SystemExit(f"Archivo no encontrado: {in_path}")

    src = read_json(in_path)
    existing = read_json(out_path)
    books = src.get("books", [])

    normalized = []
    counts: Counter[int] = Counter()
    for b in books:
        dt = parse_date(b.get("dateRead", ""))
        if not dt:
            continue
        counts[dt.year] += 1
        item = dict(b)
        item["_dateSort"] = dt.isoformat()
        normalized.append(item)

    normalized.sort(key=lambda x: x["_dateSort"], reverse=True)
    reviewed = [b for b in normalized if has_review(b)]
    top_reviewed = sorted(
        reviewed,
        key=lambda x: (
            int(x.get("reviewLikes", 0)),
            int(x.get("rating", 0)),
            x["_dateSort"],
        ),
        reverse=True,
    )

    def clean(items: list[dict], limit: int) -> list[dict]:
        out = []
        for item in items[:limit]:
            copy = dict(item)
            copy.pop("_dateSort", None)
            copy.pop("scrapeStatus", None)
            copy.pop("hasReview", None)
            out.append(copy)
        return out

    data = {
        "title": existing.get("title", "Biblioteca personal"),
        "intro": existing.get(
            "intro",
            "En esta página comparto un resumen de mis hábitos de lectura, con estadísticas por año y una selección de libros leídos en los últimos años junto con sus reseñas.",
        ),
        "profileLabel": existing.get("profileLabel", "Mi perfil en Goodreads"),
        "profileUrl": existing.get("profileUrl", "https://www.goodreads.com/user/show/91991657"),
        "sourceNote": existing.get(
            "sourceNote",
            "Datos derivados de info/library.json.",
        ),
        "yearlyReads": [
            {"year": y, "count": counts[y]} for y in sorted(counts.keys(), reverse=True)
        ],
        "latestRead": clean(normalized, 5),
        "topReviewedByLikes": clean(top_reviewed, 10),
        "latestReviewed": clean(reviewed, 5),
        "totals": {
            "booksRead": len(normalized),
            "booksReviewed": len(reviewed),
            "totalReviewLikes": sum(int(b.get("reviewLikes", 0)) for b in reviewed),
        },
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Actualizado {out_path} desde {in_path} ({len(normalized)} libros).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
