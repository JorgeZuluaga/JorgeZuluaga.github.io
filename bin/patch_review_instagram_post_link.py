#!/usr/bin/env python3
"""Inserta enlace a post.html en mirrors locales reviews/*.html (sin re-descargar)."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "bin"))

from mirror_first_review import patch_review_html_instagram_post  # noqa: E402


def review_id_from_path(path: Path) -> str:
    match = re.match(r"^(\d+)\.html$", path.name)
    return match.group(1) if match else ""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Inserta enlace «Crea un post para instagram» en reseñas locales."
    )
    parser.add_argument(
        "--reviews-dir",
        default=str(REPO / "reviews"),
        help="Directorio con reviews/*.html",
    )
    parser.add_argument("--dry-run", action="store_true", help="Solo reportar cambios.")
    args = parser.parse_args()

    reviews_dir = Path(args.reviews_dir)
    if not reviews_dir.is_dir():
        print(f"No existe {reviews_dir}", file=sys.stderr)
        return 1

    changed = 0
    scanned = 0
    for path in sorted(reviews_dir.glob("*.html")):
        scanned += 1
        original = path.read_text(encoding="utf-8", errors="ignore")
        patched = patch_review_html_instagram_post(original, review_id_from_path(path))
        if patched == original:
            continue
        changed += 1
        if args.dry_run:
            print(f"would update: {path.name}")
            continue
        path.write_text(patched, encoding="utf-8")

    verb = "Actualizarían" if args.dry_run else "Actualizados"
    print(f"{verb} {changed} de {scanned} archivos en {reviews_dir}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
