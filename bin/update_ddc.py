import json
import time
import os
import urllib.request
import urllib.error

try:
    import requests
except ModuleNotFoundError:
    requests = None

# Mapeo de géneros comunes a clases CDD principales
GENRE_TO_DDC = {
    "Science": "500",
    "Ciencia": "500",
    "Mathematics": "510",
    "Physics": "530",
    "Quantum theory": "530",
    "Cosmology": "520",
    "Nature": "508",
    "Fiction": "800",
    "Ficción": "800",
    "Literary Collections": "800",
    "Literature and Fiction": "800",
    "Literary Criticism": "800",
    "Juvenile Fiction": "800",
    "Humor": "817",
    "History": "900",
    "Historia": "900",
    "Biography & Autobiography": "920",
    "Biography": "920",
    "Travel": "910",
    "Social Science": "300",
    "Social Studies": "300",
    "Political Science": "320",
    "Business & Economics": "330",
    "Capitalism": "330",
    "Law": "340",
    "Education": "370",
    "Philosophy": "100",
    "Complexity (Philosophy)": "100",
    "Psychology": "150",
    "Self-Help": "158",
    "Religion": "200",
    "Bibles": "220",
    "Body, Mind & Spirit": "200",
    "Language Arts & Disciplines": "400",
    "Foreign Language Study": "400",
    "Technology & Engineering": "600",
    "Technology": "600",
    "Medical": "610",
    "Computers": "004",
    "Art": "700",
    "Music": "780",
    "Architecture": "720",
    "Reference": "030",
    "Nonfiction": "000",
    "Juvenile Nonfiction": "000",
}

DDC_TOPICS = {
    "000": {
        "es": "Generalidades",
        "en": "Computer Science, Information & General Works",
    },
    "100": {"es": "Filosofía y Psicología", "en": "Philosophy & Psychology"},
    "200": {"es": "Religión", "en": "Religion"},
    "300": {"es": "Ciencias Sociales", "en": "Social Sciences"},
    "400": {"es": "Lenguas", "en": "Language"},
    "500": {"es": "Ciencias Puras", "en": "Science"},
    "600": {"es": "Tecnología", "en": "Technology"},
    "700": {"es": "Artes y Recreación", "en": "Arts & Recreation"},
    "800": {"es": "Literatura", "en": "Literature"},
    "900": {"es": "Historia y Geografía", "en": "History & Geography"},
}


def get_ddc_topic(ddc_code):
    if not ddc_code or not str(ddc_code).strip():
        return None
    # Toma el primer dígito y lo completa con 00 para buscar en DDC_TOPICS
    main_class = str(ddc_code)[0] + "00"
    return DDC_TOPICS.get(main_class)


def get_ddc_from_openlibrary(isbn, session):
    """Obtiene la Clasificación Decimal Dewey usando el ISBN a través de Open Library."""
    if not isbn:
        return None
    url = f"https://openlibrary.org/search.json?isbn={isbn}"
    try:
        if session is not None:
            response = session.get(url, timeout=3)
            if response.status_code == 200:
                data = response.json()
            else:
                return None
        else:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0"},
            )
            with urllib.request.urlopen(req, timeout=3) as response:
                if response.status != 200:
                    return None
                data = json.loads(response.read().decode("utf-8"))

        docs = data.get("docs", [])
        if docs:
            ddc_list = docs[0].get("ddc", [])
            if ddc_list:
                return ddc_list[0]
    except Exception as e:
        print(f"Error fetching {isbn}: {e}")
    return None


def main():
    # Obtener el directorio raíz del proyecto (una carpeta arriba de 'update')
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    details_path = os.path.join(base_dir, "info", "library-details.json")
    lib_path = os.path.join(base_dir, "info", "library.json")

    with open(details_path, "r", encoding="utf-8") as f:
        lib_details = json.load(f)

    with open(lib_path, "r", encoding="utf-8") as f:
        lib_main = json.load(f)

    # Diccionario para mapear ID de libro o título al DDC y así sincronizar
    ddc_map = {}
    modified_details = False

    # Session para mantener la conexión viva y acelerar (si requests está disponible)
    session = None
    if requests is not None:
        session = requests.Session()
        session.headers.update({"User-Agent": "Mozilla/5.0"})

    books = lib_details.get("books", [])
    total_books = len(books)
    processed_count = 0

    print(f"Total de libros a procesar en library-details.json: {total_books}")

    for i, book in enumerate(books):
        ddc = book.get("DDC", "")

        # Si no tiene DDC asignado
        if not ddc:
            isbn = book.get("ISBN", "")
            genre = book.get("Genre", "")
            title = book.get("Title", "")

            # 1. Intentar con OpenLibrary usando ISBN
            new_ddc = get_ddc_from_openlibrary(isbn, session) if isbn else None

            # 2. Si falla, intentar usando el mapeo de Géneros local
            if not new_ddc and genre:
                main_genre = genre.split(",")[0].strip()
                new_ddc = GENRE_TO_DDC.get(main_genre)
                if not new_ddc:
                    new_ddc = GENRE_TO_DDC.get(genre)

            if new_ddc:
                # Limpiar el código DDC para quedarse con los 3 dígitos principales
                clean_ddc = str(new_ddc).split(".")[0]
                clean_ddc = "".join(filter(str.isdigit, clean_ddc))
                if clean_ddc:
                    clean_ddc = clean_ddc.zfill(3)[:3]
                    book["DDC"] = clean_ddc
                    modified_details = True
                    print(f"[{i+1}/{total_books}] {title[:30]:<30} -> CDD: {clean_ddc}")
                    processed_count += 1
            
            # Pausa muy pequeña para no saturar OpenLibrary (si usamos la API)
            if isbn and new_ddc:
                time.sleep(0.2)
            elif isbn:
                time.sleep(0.1)

        # Guardar en mapa de sincronización y agregar ddc_topic local
        if book.get("DDC"):
            current_topic = get_ddc_topic(book.get("DDC"))
            if current_topic and book.get("ddc_topic") != current_topic:
                book["ddc_topic"] = current_topic
                modified_details = True

            book_id = book.get("bookId")
            if book_id:
                ddc_map[book_id] = {"ddc": book.get("DDC"), "topic": current_topic}
            title = book.get("Title", "").lower().strip()
            if title:
                ddc_map[title] = {"ddc": book.get("DDC"), "topic": current_topic}

    if modified_details:
        with open(details_path, "w", encoding="utf-8") as f:
            json.dump(lib_details, f, indent=2, ensure_ascii=False)
        print("-> library-details.json actualizado correctamente.")
    else:
        print("-> Ningún cambio nuevo en library-details.json.")

    # Sincronizar el campo DDC en library.json
    modified_lib = False
    for book in lib_main.get("books", []):
        book_id = book.get("bookId")
        title = book.get("title", "").lower().strip()

        assigned_data = ddc_map.get(book_id)
        if not assigned_data:
            assigned_data = ddc_map.get(title)

        if assigned_data:
            assigned_ddc = assigned_data["ddc"]
            assigned_topic = assigned_data["topic"]
            if (
                book.get("ddc") != assigned_ddc
                or book.get("ddc_topic") != assigned_topic
            ):
                book["ddc"] = assigned_ddc
                if assigned_topic:
                    book["ddc_topic"] = assigned_topic
                modified_lib = True

    if modified_lib:
        with open(lib_path, "w", encoding="utf-8") as f:
            json.dump(lib_main, f, indent=2, ensure_ascii=False)
        print("-> library.json sincronizado correctamente.")
    else:
        print("-> Ningún cambio nuevo en library.json.")


if __name__ == "__main__":
    main()
