#!/usr/bin/env python3
"""
Generates a markdown file containing book reviews with their metadata 
to be used as context for LLMs (like Gemini Pro).
Only includes reviews that don't have a valid drzrating yet (-1 or 0).
"""

import json
import os
from bs4 import BeautifulSoup

def main():
    base_dir = "/Users/jzuluaga/Library/CloudStorage/GoogleDrive-zuluagajorge@gmail.com/Mi unidad/Dropbox/Personal/ArchivoPersonal/CurriculumVItae/jorgezuluaga"
    json_path = os.path.join(base_dir, "info", "library.json")
    
    if not os.path.exists(json_path):
        print(f"Error: No se encontró {json_path}")
        return
        
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    books = data.get("books", [])
    
    valid_books = []
    
    for book in books:
        if not book.get("hasReview"):
            continue
            
        drz = book.get("drzrating", -1)
        if drz != -1 and drz != 0:
            continue
            
        local_url = book.get("reviewLocalUrl", "")
        if not local_url.endswith(".html"):
            continue
            
        review_path = local_url.replace("./", "")
        full_path = os.path.join(base_dir, review_path)
        if not os.path.exists(full_path):
            continue
        
        valid_books.append((book, full_path, local_url))
        
    total_reviews = len(valid_books)
    if total_reviews == 0:
        print("No se encontraron reseñas válidas pendientes por calificar.")
        return
        
    output_path = os.path.join(base_dir, "update", "reviews_context_for_ai.md")
    
    with open(output_path, "w", encoding="utf-8") as out:
        out.write(f"# Contexto de Reseñas de Libros de Jorge Zuluaga\n\n")
        out.write("A continuación se presentan las reseñas de libros. Por favor, evalúa cada una y genera un 'drzrating' del 0 al 100 basado en el texto de la reseña y el rating original.\n\n")
        out.write("---\n\n")
        
        count = 0
        for book, full_path, local_url in valid_books:
            try:
                with open(full_path, "r", encoding="utf-8") as f:
                    html_content = f.read()
            except Exception as e:
                print(f"No se pudo leer {full_path}: {e}")
                continue
                
            soup = BeautifulSoup(html_content, "html.parser")
            article = soup.find("article", class_="card")
            if not article:
                continue
                
            text = article.get_text(separator="\n\n", strip=True)
            
            title = book.get("title", "Sin título")
            author = book.get("author", "Sin autor")
            rating = book.get("rating", 0)
            likes = book.get("reviewLikes", 0)
            
            review_id = os.path.basename(local_url).replace(".html", "")
            
            out.write(f"## {title}\n")
            out.write(f"**Review ID:** {review_id}\n")
            out.write(f"**Autor:** {author}\n")
            out.write(f"**Rating Original:** {rating} / 5\n")
            out.write(f"**Likes en la Reseña:** {likes}\n\n")
            out.write(f"### Reseña:\n")
            out.write(f"{text}\n\n")
            out.write("---\n\n")
            
            count += 1
            
    print(f"Archivo generado exitosamente en {output_path} con {count} reseñas.")

if __name__ == "__main__":
    main()
