# QUICKSTART — Biblioteca y datos del sitio

Guía corta para actualizar **Goodreads**, **BookBuddy**, clasificación **DCC/Gemini** y artefactos relacionados. Los comandos asumen que estás en la raíz del repositorio.

El **Makefile** lee por defecto **una línea** desde `.secrets/rss` y `.secrets/cookie` (directorios ignorados por git). Puedes sobreescribir con `RSS_URL=…` / `COOKIE=…` en la shell. Sin archivo `.secrets/rss`, el script diario aún puede usar `source.rssUrl` en `info/library.json`.

El paso RSS/scrape de `build_library_from_goodreads.py` muestra **progreso en consola por defecto**. Para silenciarlo: `python3 bin/build_library_from_goodreads.py … --quiet` (solo verás el mensaje final).

---

## Dependencias (Python)

Algunos scripts (p. ej. import de portadas desde BookBuddy) requieren paquetes extra.

```bash
python3 -m pip install -r requirements.txt
```

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

### Re-descargar solo el texto de una o pocas reseñas

**Qué hace:** trae de Goodreads (o del RSS si hace falta) el cuerpo actualizado de reseñas concretas y **solo reemplaza** el contenido de `<article class="card">` en `reviews/*.html`. No regenera la página entera: conserva portada, rating, Dr.Z, botones, `share-url`, etc.

Útil cuando editaste la reseña **en Goodreads** y quieres reflejar ese cambio aquí, sin pisar reseñas corregidas localmente con `make reviews-fix`.

Una reseña:

```bash
make reviews-remirror-text REVIEW_IDS=8171377602
```

Varias (separadas por coma):

```bash
make reviews-remirror-text REVIEW_IDS=8171377602,6294513698
```

Vista previa sin escribir archivos:

```bash
python3 bin/remirror_review_text.py --ids 8171377602 --dry-run
```

También acepta rutas: `python3 bin/remirror_review_text.py reviews/8171377602.html`

Actualiza `reviewCount` y `reviewTextSyncedAt` en `info/library.json`.

**No confundir con** `make reviews-force` (regenera **todas** las reseñas y borra correcciones locales) ni con `make reviews-remirror-placeholders` (solo las que tienen el mensaje de extracción fallida).

---

## Automatización diaria (A + C + estadísticas + correo a suscriptores)

El script `bin/run_daily_goodreads_sync.sh` encadena likes + últimas reseñas + `library-stats` + `library-drzrating-update`. Equivale a:

```bash
make library-daily-goodreads
```

Eso **no** envía correos a suscriptores. Para una actualización completa **con** notificación por correo (si hay reseñas nuevas), usa el runner periódico:

```bash
bash bin/run_periodic_data_sync.sh
```

**launchd:** `launchd/com.jorgezuluaga.cv-data-sync.plist` ejecuta ese mismo script (`run_periodic_data_sync.sh`) cada día a las 9:00. El flujo es:

1. Corre `run_daily_goodreads_sync.sh` (pasos anteriores).
2. Si existe `LOG_READ_TOKEN` (o `.secrets/log_read_token`), hace backup de logs de visitantes.
3. Ejecuta `make library-local-likes-sync`.
4. Opcionalmente llama a `.secrets/update-likes.sh` si está presente.
5. Intenta commit/push de los JSON relevantes.
6. Ejecuta `bin/notify_new_reviews.py`: si hay reseñas nuevas (según `.secrets/last-notified-reviews.json`) y suscriptores confirmados, envía el correo vía Gmail SMTP (requiere `.secrets/gmail-smtp-user`, `gmail-app-password` y `review-notify-token`). Si hay **más de una** reseña nueva, el correo incluye el primer párrafo de **todas** ellas. Al final siempre van las **5 reseñas más recientes** que no estén resaltadas en el cuerpo.

Correo de **prueba** (no actualiza el estado de reseñas ya notificadas):

```bash
make review-notify-test-send
```

Simular varias reseñas nuevas en la prueba:

```bash
make review-notify-test-send REVIEW_IDS=8709769014,8708090412,8611043258
```

Dar de baja un suscriptor (admin):

```bash
make review-notify-unsubscribe EMAIL=correo@ejemplo.com
```

Listar suscriptores: `make lista-suscritos` (solo correos). Detalle JSON: `python3 bin/review_notify_client.py list`

Copiar o actualizar el plist en `~/Library/LaunchAgents/` y cargar con `launchctl load -w ...` si cambias la ruta del repo.

---

## D. Actualizar lista desde BookBuddy

1. Exporta desde BookBuddy y coloca (o actualiza) **`info/bookbuddy.csv`**.
2. Opcional: export HTML con imágenes embebidas como **`info/bookbuddy.htm`** (fallback: `update/bookbuddy.htm`).

Importar filas nuevas a `library-details.json` y enlazar `bookId` con Goodreads:

```bash
make library-bookbuddy-update
```

Equivale a import CSV → `stub_empty_dcc_library_details.py` → `match_library_details_bookids.py`.

Portadas desde el HTML:

```bash
make library-bookbuddy-covers
```

(Usa por defecto `info/bookbuddy.htm` (fallback: `update/bookbuddy.htm`); directorio de salida `antilibrary/covers` salvo que cambies `OUTPUT_DIR`.)

Nota: el paso de `library-details-match` **ya no añade** libros “solo BookBuddy” a `info/library.json` (para no inflar los totales). Si alguna vez quieres sembrar la antibiblioteca con esos libros, ejecuta:

```bash
python3 bin/match_library_details_bookids.py --add-details-only-to-library
```

---

## E. Buscar cruces (cross-references)

Antes o después de `make library-details-match`, genera un informe legible de filas en `library-details` **sin `bookId`** y candidatos en `library.json`:

```bash
make library-cross-ref-report
```

Salida: `update/cross-reference-overrides.json`. Ábrelo y, para cada libro pendiente (en `library.json` con `matched:false`), rellena `chosenIsbn` con el ISBN correcto (idealmente uno de los `candidates[].isbn`; si no hay candidates, búscalo en `library-details.json` y pégalo). Luego:

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
make library-ddc-apply-gemini GEMINI_CLASSIFICATION_FILES='update/gemini-code-*.json'
```

Opcionalmente alinea la misma metadata Dewey hacia `library-details.json` para filas ya enlazadas por `bookId` / ISBN:

```bash
make sync-dcc-library-details
```

---

## H. Puntuación DrZ (Gemini → `drzrating`)

1) Exporta pendientes + contexto:

```bash
make library-drzrating-gemini-export
```

- Pendientes: `update/drzrating_pending.json`
- Contexto: `update/drzrating_context.json`
- Prompt del Gem: `update/gem-puntuacion.md`

2) Pasa `update/drzrating_pending.json` por tu Gem de Gemini y guarda la salida como un JSON con este formato:

```json
[
  { "bookId": "237811588", "DrZRating": 94 },
  { "bookId": "36006321", "DrZRating": 88 }
]
```

Guárdalo por ejemplo como: `update/drzrating_gemini_output.json`.

3) Aplica el puntaje a `info/library.json`:

```bash
make library-drzrating-gemini-apply IN=update/drzrating_gemini_output.json
```

Esto actualiza el campo `drzrating` de cada `bookId` encontrado.

---

## Cadena completa sugerida

```bash
make update-all-books
```

Ejecuta en orden: likes → últimas reseñas → import BookBuddy → stub `dcc_classes` → informe de cruces → generación de lotes Gemini. **No** aplica Gemini ni hace match automático tras el informe: revisa `update/cross-reference-report.md`, ejecuta `make library-details-match` cuando corresponda, sube los lotes a Gemini y luego `make library-ddc-apply-gemini`.

---

## 2) Flujo manual semestral (cursos, artículos, citaciones)

### A. Actualizar cursos (Google Classroom)

```bash
make classroom
```

Si hay cambios en contenido de cursos, revisa también:
- `info/teaching-course-details.json`.

### B. Actualizar artículos y citaciones

1) guarda insumos en `update/`:
- `update/google-scholar.html`
- `update/google-scholar.bib`
- `update/orcid.bib`

2) actualiza `info/papers.json` (manual o con apoyo de IA), validando:
- recientes,
- top citados,
- preprints.

### C. (Opcional semestral) recomputar stats derivados

```bash
make library-stats
```

---

## Más detalle

Para el procedimiento completo y troubleshooting, ver `UPDATE.md`.

