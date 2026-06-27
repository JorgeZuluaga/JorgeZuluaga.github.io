#!/usr/bin/env python3
"""Calculates provisional drzrating for books still pending (drzrating -1 or 0).

Heuristic scores are clamped to 0–90 so Gemini can assign the full 0–100 range
(including 91–100 for standout titles) using richer criteria.
"""

import argparse
import json
import os
from bs4 import BeautifulSoup
from pathlib import Path

AUTO_DRZ_MIN = 0
AUTO_DRZ_MAX = 90
_STARS_TO_AUTO_MAX = AUTO_DRZ_MAX // 5  # 18 points per Goodreads star


def calculate_drzrating(book, base_path):
    rating = book.get("rating", 0)
    base_score = rating * _STARS_TO_AUTO_MAX
    
    if rating == 0:
        return 0

    if not book.get("hasReview"):
        return -1

    local_url = book.get("reviewLocalUrl", "")
    if not local_url.endswith(".html"):
        return base_score
        
    review_path = local_url.replace("./", "")
    full_path = os.path.join(base_path, review_path)
    
    if not os.path.exists(full_path):
        return base_score

    try:
        with open(full_path, "r", encoding="utf-8") as f:
            html_content = f.read()
    except Exception as e:
        print(f"Error reading {full_path}: {e}")
        return base_score

    soup = BeautifulSoup(html_content, "html.parser")
    article = soup.find("article", class_="card")
    if not article:
        return base_score

    text = article.get_text(separator=" ", strip=True).lower()
    
    words = len(text.split())
    positive_words = ["obra maestra", "excelente", "imprescindible", "maravilla", "favorito", "me encantó", "brillante", "recomiendo", "recomendado", "fascinante", "apasionante", "fantástico", "genial", "disfruté"]
    negative_words = ["aburrido", "decepción", "pesado", "tedioso", "lento", "malo", "pésimo", "mediocre", "no me gustó", "decepcionante", "flojo"]
    
    pos_count = sum(text.count(w) for w in positive_words)
    neg_count = sum(text.count(w) for w in negative_words)
    
    modifier = 0
    modifier += (pos_count * 5)
    modifier -= (neg_count * 5)
    
    if words > 300:
        modifier += 10
    elif words > 150:
        modifier += 5
    elif words < 50:
        modifier -= 5
        
    final_score = base_score + modifier
    final_score = round(final_score)
    
    if final_score > AUTO_DRZ_MAX:
        final_score = AUTO_DRZ_MAX
    elif final_score < AUTO_DRZ_MIN:
        final_score = AUTO_DRZ_MIN
        
    return final_score

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Update drzrating for pending books (drzrating is -1 or 0)."
    )
    parser.add_argument("--library-json", default="info/library.json", help="Path to library.json")
    parser.add_argument("--base-dir", default=".", help="Base directory for resolving review paths")
    args = parser.parse_args()

    json_path = Path(args.library_json)
    if not json_path.exists():
        print(f"File not found: {json_path}")
        return 1

    with json_path.open("r", encoding="utf-8") as f:
        data = json.load(f)
        
    books = data.get("books", [])

    def _pending_drz(b: dict) -> bool:
        return isinstance(b, dict) and b.get("drzrating") in (-1, 0)

    pending = sum(1 for b in books if _pending_drz(b))
    print(f"[drzrating] Libros pendientes (drzrating -1 o 0) a evaluar: {pending}", flush=True)
    changed = 0

    for book in books:
        if _pending_drz(book):
            new_rating = calculate_drzrating(book, args.base_dir)
            if new_rating != 0:
                book["drzrating"] = new_rating
                book["drzratingAuto"] = True
                changed += 1
                print(f"[DRZRATING] '{book.get('title', '')[:40]}...' -> {new_rating}")

    if changed > 0:
        with json_path.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"Updated {changed} books with new drzrating.")
    else:
        print("No new books needed drzrating updates.")

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
