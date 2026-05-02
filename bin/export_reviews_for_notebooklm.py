#!/usr/bin/env python3
"""Export local review HTML files into NotebookLM-friendly Markdown batches."""

from __future__ import annotations

import argparse
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from html import unescape


@dataclass
class ReviewDoc:
    review_id: str
    title: str
    author: str
    review_date: str
    source_url: str
    local_url: str
    text: str


def normalize_ws(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text).strip()


def html_to_text(fragment: str) -> str:
    value = fragment
    value = re.sub(r"(?i)<br\s*/?>", "\n", value)
    value = re.sub(r"(?i)</p\s*>", "\n\n", value)
    value = re.sub(r"(?i)</div\s*>", "\n", value)
    value = re.sub(r"<[^>]+>", "", value)
    value = unescape(value)
    lines = [normalize_ws(x) for x in value.splitlines()]
    lines = [x for x in lines if x]
    return "\n".join(lines).strip()


def extract_review_text_from_html(path: Path) -> str:
    raw = path.read_text(encoding="utf-8", errors="ignore")
    match = re.search(
        r'<article\s+class="card"[^>]*>(.*?)</article>',
        raw,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return ""
    return html_to_text(match.group(1))


def parse_review_id(review_url: str) -> str:
    match = re.search(r"/review/show/(\d+)", review_url or "")
    return match.group(1) if match else ""


def collect_reviews(library_json: Path, repo_root: Path) -> list[ReviewDoc]:
    data = json.loads(library_json.read_text(encoding="utf-8"))
    books = data.get("books")
    if not isinstance(books, list):
        return []

    out: list[ReviewDoc] = []
    for book in books:
        if not isinstance(book, dict):
            continue
        review_url = str(book.get("reviewUrl") or "").strip()
        local_url = str(book.get("reviewLocalUrl") or "").strip()
        if not review_url or not local_url:
            continue
        review_id = parse_review_id(review_url)
        if not review_id:
            continue
        local_path = Path(local_url[2:] if local_url.startswith("./") else local_url)
        abs_local_path = repo_root / local_path
        if not abs_local_path.exists():
            continue

        text = extract_review_text_from_html(abs_local_path)
        if not text:
            continue

        out.append(
            ReviewDoc(
                review_id=review_id,
                title=str(book.get("title") or "").strip() or f"Review {review_id}",
                author=str(book.get("author") or "").strip(),
                review_date=str(book.get("reviewDate") or book.get("dateRead") or "").strip(),
                source_url=review_url,
                local_url=local_url,
                text=text,
            )
        )

    out.sort(key=lambda r: (r.review_date, r.review_id), reverse=True)
    return out


def ensure_clean_output_dir(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for p in output_dir.glob("reviews-batch-*.md"):
        p.unlink()
    index_file = output_dir / "README.md"
    if index_file.exists():
        index_file.unlink()


def write_batches(reviews: list[ReviewDoc], output_dir: Path, chunk_size: int) -> list[Path]:
    files: list[Path] = []
    total_batches = max(1, math.ceil(len(reviews) / chunk_size)) if reviews else 0
    for batch_idx in range(total_batches):
        start = batch_idx * chunk_size
        end = min(len(reviews), start + chunk_size)
        group = reviews[start:end]
        file_path = output_dir / f"reviews-batch-{batch_idx + 1:03d}.md"

        blocks: list[str] = [
            f"# Reseñas para NotebookLM ({batch_idx + 1}/{total_batches})",
            "",
            f"Contiene reseñas {start + 1} a {end} de {len(reviews)}.",
            "",
        ]
        for pos, review in enumerate(group, start=start + 1):
            blocks.extend(
                [
                    f"## {pos}. {review.title}",
                    f"- Review ID: `{review.review_id}`",
                    f"- Autor: {review.author or 'Desconocido'}",
                    f"- Fecha: {review.review_date or 'Sin fecha'}",
                    f"- URL Goodreads: {review.source_url}",
                    f"- URL local: {review.local_url}",
                    "",
                    review.text,
                    "",
                    "---",
                    "",
                ]
            )

        file_path.write_text("\n".join(blocks).strip() + "\n", encoding="utf-8")
        files.append(file_path)
    return files


def write_index(output_dir: Path, generated_files: list[Path], total_reviews: int, chunk_size: int) -> None:
    lines = [
        "# Export de reseñas para NotebookLM",
        "",
        f"- Total reseñas exportadas: **{total_reviews}**",
        f"- Tamaño de lote: **{chunk_size}**",
        f"- Total archivos: **{len(generated_files)}**",
        "",
        "## Archivos",
        "",
    ]
    for p in generated_files:
        lines.append(f"- `{p.name}`")
    lines.append("")
    (output_dir / "README.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Exporta reseñas locales en lotes Markdown para NotebookLM.",
    )
    parser.add_argument("--library-json", default="info/library.json")
    parser.add_argument("--output-dir", default="update/reviews")
    parser.add_argument("--chunk-size", type=int, default=5)
    args = parser.parse_args()

    repo_root = Path.cwd()
    library_json = repo_root / args.library_json
    output_dir = repo_root / args.output_dir
    chunk_size = max(1, int(args.chunk_size))

    if not library_json.exists():
        raise SystemExit(f"Archivo no encontrado: {library_json}")

    reviews = collect_reviews(library_json=library_json, repo_root=repo_root)
    ensure_clean_output_dir(output_dir)
    files = write_batches(reviews=reviews, output_dir=output_dir, chunk_size=chunk_size)
    write_index(
        output_dir=output_dir,
        generated_files=files,
        total_reviews=len(reviews),
        chunk_size=chunk_size,
    )

    print(
        "Export completado: "
        f"reseñas={len(reviews)} lotes={len(files)} output={output_dir}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
