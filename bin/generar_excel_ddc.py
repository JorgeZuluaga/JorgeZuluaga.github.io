import json
import pandas as pd

# Load both jsons
books = []

with open("info/library.json", "r", encoding="utf-8") as f:
    data = json.load(f)
    for b in data.get("books", []):
        books.append(b)

with open("info/library-details.json", "r", encoding="utf-8") as f:
    data = json.load(f)
    for b in data.get("books", []):
        books.append(b)

# Deduplicate by title
seen = set()
unique_books = []
for b in books:
    # book.title for library.json, book.Title for library-details.json
    title = b.get("title") or b.get("Title")
    if not title:
        continue
    title = str(title).strip()
    if title in seen:
        continue
    seen.add(title)
    unique_books.append(b)

rows = []
for b in unique_books:
    title = b.get("title") or b.get("Title")
    
    ddc = b.get("ddc") or b.get("DDC") or ""
    ddc_topic = b.get("ddc_topic", {})
    
    # Topic string
    topic_str = ""
    if isinstance(ddc_topic, dict):
        topic_str = ddc_topic.get("es", "")
    elif isinstance(ddc_topic, str):
        topic_str = ddc_topic
        
    if ddc and topic_str:
        clasificacion = f"{topic_str} ({ddc})"
    elif ddc:
        clasificacion = f"Sin categoría ({ddc})"
    elif topic_str:
        clasificacion = topic_str
    else:
        clasificacion = "Sin clasificar"
        
    rows.append({
        "Título del libro": title,
        "Clasificación DCC automática": clasificacion,
        "Clasificación DCC manual": clasificacion
    })

# Sort by title
rows.sort(key=lambda x: x["Título del libro"].lower() if isinstance(x["Título del libro"], str) else "")

df = pd.DataFrame(rows)
df.to_excel("Clasificacion_DDC_Manual.xlsx", index=False)
print("Archivo Excel generado con éxito en Clasificacion_DDC_Manual.xlsx")
