# QUICKSTART — Biblioteca y datos del sitio

Guía corta para actualizar **Goodreads**, **BookBuddy**, clasificación **DCC/Gemini** y artefactos relacionados. Los comandos asumen que estás en la raíz del repositorio.

El **Makefile** lee por defecto **una línea** desde `.secrets/rss` y `.secrets/cookie` (directorios ignorados por git). Puedes sobreescribir con `RSS_URL=…` / `COOKIE=…` en la shell. Sin archivo `.secrets/rss`, el script diario aún puede usar `source.rssUrl` en `info/library.json`.

El paso RSS/scrape de `build_library_from_goodreads.py` muestra **progreso en consola por defecto**. Para silenciarlo: `python3 bin/build_library_from_goodreads.py … --quiet` (solo verás el mensaje final).

---

## A. Actualizar solo los likes de Goodreads

**Qué hace:** vuelve a leer el RSS (para tener la lista actual de libros leídos en la ventana paginada), **fusiona** con tu `library.json` existente y **recorre las páginas de reseña** en Goodreads para actualizar `reviewLikes`. No genera ni actualiza los HTML locales en `reviews/`.

```bash
make library-goodreads-likes
```

Opcional: variables en la shell o archivos en `.secrets/`; `RSS_PAGES=100` para más páginas del feed.

**Separado de las reseñas locales:** el mirror HTML está en la sección **C** (`make library-goodreads-reviews-latest`).

---

## B. Actualizar la lista de libros leídos (sin reseñas ni likes)

**Qué hace:** incorpora desde el RSS los libros leídos que falten; **no** hace scrape de likes (`scrape-likes-mode none`). Los `bookId` que ya existían en `library.json` no se duplican; los campos se fusionan desde el RSS pero **`title` no se sobrescribe** si ya tenías uno guardado (`--preserve-existing-titles`), para evitar cambios raros de Goodreads.

```bash
make library-goodreads-books-only
```

Tras incorporar libros nuevos, conviene marcar en `library-details.json` las filas nuevas con clasificación pendiente:

```bash
make library-stub-dcc-details
```

Eso solo añade `"dcc_classes": {}` donde falta la clave; **no** rellena `dcc_codes` ni `dcc_notes` (reasoning/confidence).

---

## C. Descargar solo las últimas reseñas (mirror local)

**Qué hace:** ejecuta `mirror_all_reviews.py` con `--refresh-latest 10`: regenera prioritariamente las diez reseñas más recientes. Las portadas en `reviews/covers/` se intentan cuando el RSS de respaldo aporta URL de imagen (comportamiento ya existente del mirror).

```bash
make library-goodreads-reviews-latest
```

Opcional: `COOKIE='...'` si hace falta para contenido autenticado.

---

## Automatización diaria (A + C + estadísticas)

El script `bin/run_daily_goodreads_sync.sh` encadena likes + últimas reseñas + `library-stats` + `library-drzrating-update`. Equivale a:

```bash
make library-daily-goodreads
```

**launchd:** `launchd/com.jorgezuluaga.cv-data-sync.plist` ejecuta `bin/run_periodic_data_sync.sh`, que ahora:

1. Corre `run_daily_goodreads_sync.sh` (pasos anteriores).
2. Si existe `LOG_READ_TOKEN` (o `.secrets/log_read_token`), hace backup de logs de visitantes.
3. Ejecuta `make library-local-likes-sync`.
4. Opcionalmente llama a `.secrets/update-likes.sh` si está presente.
5. Intenta commit/push de los JSON relevantes.

Copiar o actualizar el plist en `~/Library/LaunchAgents/` y cargar con `launchctl load -w ...` si cambias la ruta del repo.

---

## D. Actualizar lista desde BookBuddy

1. Exporta desde BookBuddy y coloca (o actualiza) **`info/bookbuddy.csv`**.
2. Opcional: export HTML con imágenes embebidas como **`update/bookbuddy.htm`** (nombre por defecto del extractor).

Importar filas nuevas a `library-details.json` y enlazar `bookId` con Goodreads:

```bash
make library-bookbuddy-update
```

Equivale a import CSV → `stub_empty_dcc_library_details.py` → `match_library_details_bookids.py`.

Portadas desde el HTML:

```bash
make library-bookbuddy-covers
```

(Usa por defecto `update/bookbuddy.htm`; directorio de salida `antilibrary/covers` salvo que cambies `OUTPUT_DIR`.)

---

## E. Buscar cruces (cross-references)

Antes o después de `make library-details-match`, genera un informe legible de filas en `library-details` **sin `bookId`** y candidatos en `library.json`:

```bash
make library-cross-ref-report
```

Salida: `update/cross-reference-report.md`. Revísalo y corrige a mano si hace falta; luego:

```bash
make library-details-match
```

---

## F. Generar lotes para clasificación detallada (Gemini)

Los JSON se generan para libros que **aún no tienen razonamiento Gemini** (`dcc_notes.reasoning` vacío o ausente) en `library.json` o en filas de `library-details.json`.

```bash
make library-ddc-generate-pending
```

Archivos típicos: `update/books_to_classify.json` o `update/books_to_classify_001.json`, … Súbelos/procésalos con tu flujo Gemini y guarda las respuestas como `update/books-to-classify/gemini-code-*.json`.

---

## G. Aplicar clasificaciones de Gemini

```bash
make library-ddc-apply-gemini GEMINI_CLASSIFICATION_FILES='update/books-to-classify/gemini-code-*.json'
```

Opcionalmente alinea la misma metadata Dewey hacia `library-details.json` para filas ya enlazadas por `bookId` / ISBN:

```bash
make sync-dcc-library-details
```

---

## Cadena completa sugerida

```bash
make update-all-books
```

Ejecuta en orden: likes → últimas reseñas → import BookBuddy → stub `dcc_classes` → informe de cruces → generación de lotes Gemini. **No** aplica Gemini ni hace match automático tras el informe: revisa `update/cross-reference-report.md`, ejecuta `make library-details-match` cuando corresponda, sube los lotes a Gemini y luego `make library-ddc-apply-gemini`.

---

## Otros objetivos útiles (`make help`)

| Target | Uso |
|--------|-----|
| `library-stats` | Regenera `info/library-stats.json`. |
| `reviews-all` / `reviews-force` | Mirror completo de reseñas (pesado). |
| `library-update` | Flujo **legado** `FORCE=0|1|2` + reviews + details-sync (preferir A/B/C arriba). |
| `notebooklm-reviews-export` | Exporta reseñas a Markdown en `update/reviews/`. |

---

## Scripts viejos

Herramientas sustituidas o poco usadas están en **`update/deprecated-bin/`** (véase el README allí).
