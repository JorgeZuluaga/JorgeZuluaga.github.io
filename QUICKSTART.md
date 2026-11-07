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

**Qué hace:** ejecuta `mirror_all_reviews.py` con `--refresh-latest 10`: regenera prioritariamente las diez reseñas más recientes. Además, **reintenta** mirrors locales que siguen con el placeholder «No fue posible extraer…» si `reviewDate`/`dateRead` cae en los últimos **180 días** (`REVIEW_RETRY_FAILED_DAYS`; pon `0` para reintentar todos los placeholders). Así, si la primera descarga falló porque aún no había texto en Goodreads, el sync diario lo corrige aunque la reseña quede fuera del top 10. Las portadas en `reviews/covers/` se intentan cuando el RSS aporta URL de imagen.

```bash
make library-goodreads-reviews-latest
```

Para reintentar **todos** los placeholders de una vez (puede tardar): `make reviews-remirror-placeholders`.

Opcional: `COOKIE='...'` si hace falta para contenido autenticado.

### Re-descargar solo el texto de una o pocas reseñas

**Qué hace:** trae de Goodreads (o del RSS si hace falta) el cuerpo actualizado de reseñas concretas y **solo reemplaza** el contenido de `<article class="card">` en `reviews/*.html`. No regenera la página entera: conserva portada, rating, Dr.Z, botones, `share-url`, etc.

Útil cuando editaste la reseña **en Goodreads** y quieres reflejar ese cambio aquí, sin pisar reseñas corregidas localmente con `make reviews-fix`.

Una reseña:

```bash
make reviews-remirror-text REVIEW_IDS=8171377602
```

Tras actualizar una reseña ya notificada antes, encolarla para el próximo correo diario:

```bash
make reviews-remirror-text REVIEW_IDS=8640936306 INQUEUE=1
# equivalente:
python3 bin/remirror_review_text.py --ids 8640936306 --inqueue
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

Actualiza `reviewCount`, `reviewTextSyncedAt` y, si el texto termina con `YYYY/MM/DD`, `reviewDate` en `info/library.json`.

Con `--inqueue` (o `INQUEUE=1` en make) añade el ID a `queuedReviewIds` en `info/review-notify-state.json`. El sync diario (`review-notify-send`) enviará esa reseña aunque ya figure en `notifiedReviewIds` (caso típico: remirror de una reseña ampliada después del primer aviso).

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

**Automatización diaria en GitHub Actions:** el workflow **Daily library sync** (`.github/workflows/daily-sync.yml`) corre cada día a las **06:00 America/Bogotá** (11:00 UTC). Usa los [GitHub Secrets](https://github.com/JorgeZuluaga/JorgeZuluaga.github.io/settings/secrets/actions) del repo (`GMAIL_SMTP_USER`, `GMAIL_APP_PASSWORD`, `REVIEW_NOTIFY_TOKEN`, opcional `GOODREADS_COOKIE` y `LOG_READ_TOKEN`). El RSS se lee de `source.rssUrl` en `info/library.json`. BookBuddy sigue siendo local.

Disparo manual desde la web: **Actions → Daily library sync → Run workflow**. Entrada del job: `bash bin/run_github_actions_sync.sh` → `bin/run_periodic_data_sync.sh`.

Tras cada corrida exitosa en GitHub, en tu Mac:

```bash
git pull
make status
```

**Seguir el lanzamiento desde la terminal** (requiere [`gh`](https://cli.github.com/) autenticado contra el repo):

```bash
# Últimas corridas del workflow
gh run list --workflow=daily-sync.yml --limit 5

# Progreso en vivo (pasos del job; Ctrl+C para salir)
gh run watch

# Progreso de una corrida concreta (copia el ID de la lista anterior)
gh run watch 12345678901

# Resumen de una corrida
gh run view 12345678901

# Log completo (solo cuando ya terminó)
gh run view 12345678901 --log
```

Enlace directo en el navegador: `https://github.com/JorgeZuluaga/JorgeZuluaga.github.io/actions/workflows/daily-sync.yml`. Para ver el log **en vivo** con detalle (Goodreads, Buscalibre, etc.), abre la corrida → job **sync** → paso **Run daily sync**.

Disparo manual desde terminal (si `gh` tiene permisos de admin en Actions):

```bash
gh workflow run "Daily library sync"
```

**launchd (local, deshabilitado):** `launchd/com.jorgezuluaga.cv-data-sync.plist` tenía el mismo flujo a las 9:00; el plist en el repo lleva `Disabled=true`. Para una corrida local manual:

```bash
bash bin/run_periodic_data_sync.sh
```

El flujo periódico completo es:

1. Corre `run_daily_goodreads_sync.sh` (pasos anteriores).
2. Si existe `LOG_READ_TOKEN` (o `.secrets/log_read_token`), hace backup de logs de visitantes.
3. Ejecuta `make library-local-likes-sync`.
4. Opcionalmente llama a `.secrets/update-likes.sh` si está presente.
5. Intenta commit/push de los JSON relevantes.
6. Ejecuta `bin/notify_new_reviews.py`: si hay reseñas nuevas (según `info/review-notify-state.json`) y suscriptores confirmados, envía el correo vía Gmail SMTP (requiere credenciales en Secrets o `.secrets/gmail-smtp-user`, `gmail-app-password` y `review-notify-token`). Si hay **más de una** reseña nueva, el correo incluye el primer párrafo de **todas** ellas. Al final siempre van las **5 reseñas más recientes** que no estén resaltadas en el cuerpo.

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

Si reactivas launchd local: copia o actualiza el plist en `~/Library/LaunchAgents/` y `launchctl load -w ...` (el del repo está deshabilitado por defecto).

---

## Preview de portada al compartir `book.html` (WhatsApp / Twitter)

`book.html?bookid=…` es una SPA: los crawlers de WhatsApp/Twitter **no ejecutan JavaScript**, así que las meta OG no pueden ponerse solo en el cliente.

Solución: Worker `book-og-worker` que sirve HTML con `og:image` (portada) a bots y redirige humanos a GitHub Pages.

```bash
make book-og-deploy   # solo cuando cambias book-og-worker.js
make book-og-check    # tras sync / BookBuddy: verifica que el worker responda
```

**Importante:** el worker **no guarda** el catálogo. Lee `info/library.json`, `info/library-details.json` y portadas (`reviews/covers/`, `antilibrary/covers/`) desde GitHub Pages. El sync diario y BookBuddy **no necesitan** `wrangler deploy` por libros nuevos: basta con **commit + push** de esos archivos. El sync periódico ya incluye `library-details.json` y `antilibrary/covers/` en el push, y luego corre `book_og_ensure.sh`.

URL para compartir (botón **Compartir** en la página del libro):

```text
https://book-og-worker.drz-academy.workers.dev/?bookid=89009188
```

También vale `/?isbn=9788418741838` o `/book/89009188`.

Desplegado en la cuenta Cloudflare de `soydoctorz@gmail.com` (workers.dev: `drz-academy`). Redeploy de código opcional: `BOOK_OG_DEPLOY=1 make book-og-ensure`.

---

## D. Actualizar lista desde BookBuddy

1. Exporta desde BookBuddy y coloca (o actualiza) **`update/bookbuddy.csv`**.
2. Opcional: export HTML con imágenes embebidas como **`update/bookbuddy.htm`**.

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

## I. Ubicación de libros (`ubicaciones.html`)

App privada (página + Worker de Cloudflare con KV) para registrar en qué ubicación física está cada libro. No modifica `info/library*.json`.

### I.1 Localizar libros (día a día)

1. Abre `https://jorgezuluaga.github.io/ubicaciones.html` (necesita HTTPS para usar la cámara). La primera vez pide el token (`.secrets/booklocation-token`).
2. **Ubicaciones**: crea cada lugar con el formato `Lugar/Espacio/Nivel` y una clave corta (se propone sola, p. ej. `CMCN1`). Imprime o descarga las etiquetas QR y pégalas en cada estante.
3. **Asignar**: escanea el QR de la ubicación (o escribe su clave o parte del nombre) → «＋ Nuevo libro» → escanea el código de barras, o escribe el ISBN o parte del título → revisa título, autor y ubicación → Guardar. Repite con el siguiente libro. Si el libro ya estaba en otra ubicación, la ficha indica la ubicación anterior y propone la actual; el libro se mueve solo cuando pulsas Guardar.
   En **Autor**, toca el campo para ver los autores del catálogo en orden alfabético; escribe para filtrar la lista o introduce un nombre nuevo.
4. Si el ISBN no está en tu catálogo, la ficha propone coincidencias por título («¿Es este el libro?») y busca en Google Books/Open Library. Si rellena datos de Internet, la ficha muestra el texto en rojo y señala la fuente para que los revises.
5. **Buscar**: escribe o escanea el ISBN (o el título) para ver dónde está; desde ahí puedes moverlo o quitarlo.
6. Al clasificarlo en **A/Me los prestaron**, aparece también **Ubicación secundaria**. Elige una ubicación ya creada para indicar dónde están físicamente esos libros. Ese campo solo se guarda para los libros prestados.

Si cambias `assets/booklocation-page.js` o `assets/booklocation.css`, actualiza el `?v=AAAAMMDDHHMM` en `ubicaciones.html` (también es la versión que muestra la página; evita que Safari use una copia vieja) y haz commit/push.

Si cambias `booklocation-worker.js`, redespliega:

```bash
make booklocation-deploy
```

### I.2 Respaldo y estadísticas

```bash
make booklocation-backup
```

- Descarga las ubicaciones del Worker (usa `.secrets/booklocation-token` o `BOOKLOC_TOKEN=...`) y las guarda ordenadas y legibles en `info/booklocation.json`.
- Genera `info/locationstats.md` (libros por lugar y por lugar/espacio; también se puede regenerar solo con `python3 bin/booklocation_stats.py`).
- Después, haz commit/push de ambos archivos:

```bash
git add info/booklocation.json info/locationstats.md
git commit -m "chore: respaldo de ubicaciones"
git push
```

Hazlo al terminar cada sesión de localización. `make booklocation-export` es un alias.

### I.3 Conciliación

Muchos libros del catálogo tienen el ISBN de otra edición (la encontrada en internet al ingresarlos a BookBuddy), distinto al de tu ejemplar. La conciliación cruza por título y autor los libros localizados con el catálogo y guarda el ISBN escaneado como **ISBN secundario**.

```bash
make booklocation-backup   # 1) respaldo de ubicaciones actualizado
make booklocation-recon    # 2) concilia
```

`make booklocation-recon` hace, en orden:

1. Respalda `info/library.json` y `info/library-details.json` en `info/backup/` con la fecha (`library-AAAAMMDD.json`, `library-details-AAAAMMDD.json`; si ya hay uno del día, agrega la hora: `-AAAAMMDD-HHMM`).
2. Escribe el campo `ISBN2` (varios separados por coma) directamente en `info/library-details.json`. Si el libro solo está en `library.json`, escribe `isbn2` allí. Los `ISBN2` existentes se conservan.
3. Para los libros con un candidato dudoso («¿?») **pregunta en la terminal** si es el mismo libro: `s` (sí: se guarda el ISBN escaneado como `ISBN2`), `n` (no) o Enter (decidir después). Las respuestas se guardan en `info/booklocation-decisions.json` y no se vuelve a preguntar. Los ISBN no válidos no se preguntan.
4. Genera `info/backup/reconciliation.md` solo con los **libros con problemas**: los que no están en el catálogo (candidatos a incluir en BookBuddy; «¿?» indica un parecido dudoso no aplicado). Un ISBN no válido solo cuenta como problema si además el libro no está en el catálogo. De los demás solo da el conteo.

La página `ubicaciones.html` busca por el ISBN principal y por los secundarios. Haz commit/push de `info/`. Tras actualizar el catálogo desde BookBuddy, repite la conciliación (el script de actualización debe conservar `ISBN2`/`isbn2`).

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
