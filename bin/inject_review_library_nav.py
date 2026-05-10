#!/usr/bin/env python3
"""Insert library subnav into existing reviews/*.html (idempotent).

Uses the same markup as new mirrors from ``mirror_first_review.build_local_page``.
Run from repo root: ``python3 bin/inject_review_library_nav.py``

Future ``mirror_all_reviews`` / ``mirror_first_review`` output already includes this nav.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent


def _load_mirror_first_review():
    path = _SCRIPT_DIR / "mirror_first_review.py"
    spec = importlib.util.spec_from_file_location("mirror_first_review", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"No se pudo cargar {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_REVIEW_MOD = _load_mirror_first_review()
REVIEW_PAGE_LIBRARY_SUBNAV_HTML = _REVIEW_MOD.REVIEW_PAGE_LIBRARY_SUBNAV_HTML

# Match header end before main (mirrored review layout).
NEEDLE = "      </div>\n    </header>\n    <main id=\"review-main\""


def main() -> int:
    repo_root = _SCRIPT_DIR.parent
    reviews_dir = repo_root / "reviews"
    if not reviews_dir.is_dir():
        raise SystemExit(f"No existe: {reviews_dir}")

    replacement = (
        "      </div>\n"
        f"{REVIEW_PAGE_LIBRARY_SUBNAV_HTML}\n"
        '    </header>\n    <main id="review-main"'
    )

    updated = 0
    skipped_have_nav = 0
    skipped_pattern = 0

    for path in sorted(reviews_dir.glob("*.html")):
        text = path.read_text(encoding="utf-8")
        if 'id="library-section-nav"' in text:
            skipped_have_nav += 1
            continue
        if NEEDLE not in text:
            skipped_pattern += 1
            print(f"[SKIP pattern] {path.name}")
            continue
        path.write_text(text.replace(NEEDLE, replacement, 1), encoding="utf-8")
        updated += 1

    print(f"Actualizados: {updated}")
    print(f"Ya tenían menú: {skipped_have_nav}")
    print(f"Sin patrón esperado: {skipped_pattern}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
