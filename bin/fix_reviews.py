#!/usr/bin/env python3
"""Fix Spanish orthography in review HTML files using Gemini."""

from __future__ import annotations

import argparse
import difflib
import glob
import os
import re
import time

from google import genai
from google.genai import types

SYS_INSTR = (
    "Eres un corrector experto en español. Corrige la ortografía, tildes, "
    "gramática y comas del usuario. Preserva el tono y estilo original. "
    "Mantén intactos los tags HTML internos como <br />. IMPORTANTE: Entrega "
    "ÚNICAMENTE el texto final corregido, sin notas, ni saludos, ni comillas "
    "extra de markdown."
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Corrige reseñas en reviews/*.html y guarda diff en reviews/corrections/*.diff",
    )
    parser.add_argument(
        "--api-key",
        required=True,
        help="Google API key para Gemini.",
    )
    parser.add_argument(
        "--model",
        default="gemini-flash-lite-latest",
        help="Modelo Gemini (default: gemini-flash-lite-latest).",
    )
    parser.add_argument(
        "--sleep-seconds",
        type=float,
        default=5.5,
        help="Pausa entre requests para evitar rate limit (default: 5.5).",
    )
    return parser.parse_args()


def cleaned_model_output(text: str) -> str:
    corrected_html = text.strip()
    if corrected_html.startswith("```html"):
        corrected_html = corrected_html[7:]
    if corrected_html.startswith("```"):
        corrected_html = corrected_html[3:]
    if corrected_html.endswith("```"):
        corrected_html = corrected_html[:-3]
    return corrected_html.strip()


def main() -> int:
    args = parse_args()
    client = genai.Client(api_key=args.api_key)

    files = sorted(glob.glob("reviews/*.html"))
    os.makedirs("reviews/corrections", exist_ok=True)

    processed = 0
    for review_file in files:
        basename = os.path.basename(review_file)
        diff_file = f"reviews/corrections/{basename.replace('.html', '.diff')}"

        # Process ONLY files without an existing correction diff.
        if os.path.exists(diff_file):
            continue

        try:
            with open(review_file, "r", encoding="utf-8") as file:
                original_content = file.read()

            article_match = re.search(
                r'(<article\s+class="card"[^>]*>)(.*?)(</article>)',
                original_content,
                re.IGNORECASE | re.DOTALL,
            )
            if not article_match:
                continue

            prefix = article_match.group(1)
            inner_raw = article_match.group(2)
            suffix = article_match.group(3)
            inner_html = inner_raw.strip()

            if not inner_html or len(inner_html.split()) < 3:
                continue

            print(f"Procesando {basename}...")
            response = client.models.generate_content(
                model=args.model,
                contents=inner_html,
                config=types.GenerateContentConfig(
                    system_instruction=SYS_INSTR,
                ),
            )
            corrected_html = cleaned_model_output(response.text or "")

            if not corrected_html or corrected_html == inner_html:
                with open(diff_file, "w", encoding="utf-8") as dfile:
                    dfile.write("")
                continue

            space_before = inner_raw[: len(inner_raw) - len(inner_raw.lstrip())]
            space_after = inner_raw[len(inner_raw.rstrip()) :]
            reconstructed_article = prefix + space_before + corrected_html + space_after + suffix

            new_content = (
                original_content[: article_match.start()]
                + reconstructed_article
                + original_content[article_match.end() :]
            )

            if new_content == original_content:
                with open(diff_file, "w", encoding="utf-8") as dfile:
                    dfile.write("")
                continue

            old_lines = original_content.splitlines(keepends=True)
            new_lines = new_content.splitlines(keepends=True)
            diff = list(
                difflib.unified_diff(
                    old_lines,
                    new_lines,
                    fromfile=f"{basename}.orig",
                    tofile=basename,
                ),
            )

            if diff:
                with open(diff_file, "w", encoding="utf-8") as dfile:
                    dfile.writelines(diff)
                with open(review_file, "w", encoding="utf-8") as hfile:
                    hfile.write(new_content)

            processed += 1
            print(f"-> {basename} actualizado.")
            time.sleep(args.sleep_seconds)

        except genai.errors.APIError as api_err:
            print(f"Error AI en {basename}: {api_err}. Pausando 30s...")
            time.sleep(30)
            continue
        except Exception as err:
            print(f"Error procesando {basename}: {err}")
            time.sleep(args.sleep_seconds)

    print(f"Completado. {processed} archivos procesados y actualizados en esta tanda.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
