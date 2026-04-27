#!/usr/bin/env python3
import json
import csv
import os
import sys

def main():
    if len(sys.argv) < 2:
        print("Uso: python3 apply_gemini_ratings.py <nombre_del_archivo_csv>")
        print("Ejemplo: python3 apply_gemini_ratings.py gemini-code-1777256506024.txt")
        sys.exit(1)
        
    csv_filename = sys.argv[1]
    base_dir = "/Users/jzuluaga/Library/CloudStorage/GoogleDrive-zuluagajorge@gmail.com/Mi unidad/Dropbox/Personal/ArchivoPersonal/CurriculumVItae/jorgezuluaga"
    csv_path = os.path.join(base_dir, "update", csv_filename)
    json_path = os.path.join(base_dir, "info", "library.json")
    
    if not os.path.exists(csv_path):
        print(f"Error: El archivo {csv_path} no existe.")
        sys.exit(1)
    
    # 1. Read CSV and get mapping of ReviewID -> DrZRating
    gemini_ratings = {}
    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                review_id = row.get("ReviewID", "").strip()
                drz_rating_str = row.get("DrZRating", "").strip()
                if review_id and drz_rating_str.isdigit():
                    gemini_ratings[review_id] = int(drz_rating_str)
    except Exception as e:
        print(f"Error leyendo CSV: {e}")
        return

    print(f"Se cargaron {len(gemini_ratings)} calificaciones de Gemini.")

    # 2. Update library.json
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error leyendo library.json: {e}")
        return
        
    books = data.get("books", [])
    updated_count = 0
    
    for book in books:
        if not book.get("hasReview"):
            continue
            
        local_url = book.get("reviewLocalUrl", "")
        if not local_url.endswith(".html"):
            continue
            
        review_id = os.path.basename(local_url).replace(".html", "")
        
        if review_id in gemini_ratings:
            book["drzrating"] = gemini_ratings[review_id]
            updated_count += 1

    # Save library.json
    try:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"Se actualizaron {updated_count} libros en library.json.")
    except Exception as e:
        print(f"Error escribiendo library.json: {e}")
        return

if __name__ == "__main__":
    main()
