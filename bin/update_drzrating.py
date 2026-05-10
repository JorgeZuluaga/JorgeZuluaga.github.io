#!/usr/bin/env python3
"""Calculates drzrating for books that have drzrating: 0 in info/library.json."""

import argparse
import json
import os
from bs4 import BeautifulSoup
from pathlib import Path

def calculate_drzrating(book, base_path):
    rating = book.get("rating", 0)
    base_score = rating * 20
    
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
    
    if final_score > 100:
        final_score = 100
    elif final_score < 1:
        final_score = 1
        
    return final_score

def main() -> int:
    parser = argparse.ArgumentParser(description="Update drzrating for new books (where drzrating=0).")
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
    pending = sum(1 for b in books if isinstance(b, dict) and b.get("drzrating") == 0)
    print(f"[drzrating] Libros con drzrating=0 a evaluar: {pending}", flush=True)
    changed = 0

    for book in books:
        if book.get("drzrating") == 0:
            new_rating = calculate_drzrating(book, args.base_dir)
            if new_rating != 0:
                book["drzrating"] = new_rating
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
