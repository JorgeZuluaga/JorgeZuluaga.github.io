# Cómo actualizar el CV (estructura + fuentes de datos)

Este sitio mezcla **contenido estático** (marcado en `index.html`) con **contenido dinámico** renderizado por JavaScript (principalmente `assets/app.js`). Para mantenimiento, la regla es: **cuando un bloque sea repetible (lista de ítems con campos), lo ideal es que viva en JSON y lo renderice `app.js`**.

## Inicio Rápido (actualización anual)

Si dentro de 1 año necesitas actualizar la hoja de vida completa, sigue este orden:

Tip: para ver todos los comandos disponibles:

```bash
make help
```

### 1) Actualizar publicaciones (artículos)

1. Descarga insumos y guárdalos en `update/`:
   - `update/google-scholar.html`
   - `update/google-scholar.bib`
   - `update/orcid.bib`
2. Actualiza `info/papers.json` (manual o con el prompt de esta guía).
3. Revisa que en la web se actualicen:
   - “Publicaciones más recientes”
   - “Más citados”
   - “Preprints”

### 2) Actualizar cursos (docencia)

1. Ejecuta:
   ```bash
   make classroom
   ```
2. Si hay cursos nuevos o cambió el contenido, actualiza:
   - `info/teaching-course-details.json` (descripción y tópicos).
3. Verifica sección “Docencia”.

### 3) Actualizar libros y reseñas (Goodreads)

1. Obtén/renueva tu cookie de Goodreads (ver sección Biblioteca personal).
2. Exporta variable:
   ```bash
   export GR_COOKIE='session-id=...; at-main=...; ccsid=...; locale=en; ...'
   ```
3. Genera `info/library.json` desde RSS con likes:
   ```bash
   make library-build \
     RSS_URL="https://www.goodreads.com/review/list_rss/91991657?key=kpN1wAHi2GZUUO7BHv1v3ZCOGhOk_QjljXSDnXSc3kA-lzU7&shelf=%23ALL%23" \
     RSS_PAGES=60 \
     COOKIE="$GR_COOKIE"
   ```
4. Genera resumen derivado:
   ```bash
   make library-stats
   ```
5. Genera/actualiza mirrors locales de reseñas:
   ```bash
   make reviews-all COOKIE="$GR_COOKIE" REVIEW_RSS_PAGES=80
   ```
6. Verifica en `biblioteca.html`:
   - reporte (leídos, reseñados, likes),
   - barras por año,
   - últimos 5 leídos,
   - top 10 reseñas por likes,
   - últimos 5 reseñados.

### 4) Actualizar fotos de galería

1. Copia fotos nuevas en `info/photos/`.
2. Renombra archivos con convención clara (ej. `jorge-zuluaga-evento-YYYY-MM-01.jpg`).
3. Actualiza `info/photos/photos.json` con:
   - `file`, `title`, `dateLabel`, `year`, `month`,
   - `description`, `width`, `height`, `sizeBytes`.
4. Verifica en `photos.html`:
   - miniatura,
   - vista previa,
   - descarga.

### 5) Actualizar datos generales de CV (si aplica)

Edita JSONs según cambios:
- `info/profile.json` (perfil, experiencia laboral, resumen)
- `info/education.json`, `info/research.json`, `info/awards.json`
- `info/logros-profesionales.json`, `info/libros.json`, `info/software.json`
- `info/contact.json`

### 6) Verificación local final

1. Levanta servidor:
   ```bash
   make dev
   ```
2. Abre `http://localhost:8000` y revisa:
   - `index.html` completo (publicaciones, docencia, contacto, etc.)
   - `photos.html`
   - `biblioteca.html`
3. Revisa consola del navegador por errores de carga/fetch.

### 7) Publicar cambios

1. Revisa estado:
   ```bash
   git status
   ```
2. Commit:
   ```bash
   git add .
   git commit -m "Actualiza CV: publicaciones, cursos, biblioteca y galería"
   ```
3. Push:
   ```bash
   git push
   ```

## Fuentes de verdad (qué archivo tocar)

### Perfil y datos personales (dinámico desde JSON)
- Archivo: `info/profile.json`
- Campos relevantes:
  - `name`: nombre del encabezado (`#name`)
  - `headline`: texto del subtítulo (soporta `<br/>` via `setTextWithBr`)
  - `aboutMe`: contenido de “Sobre mí” (se inyecta en `#about-me`)
  - `teaching.supervision`: lista bajo “Docencia” (elemento `#teaching-supervision`)
  - `awards`: lista bajo “Docencia” (elemento `#awards`)
  - `experienceLaboral`: lista bajo “Experiencia laboral” (elemento contenedor `#experience-laboral-items`)

### Contacto (dinámico desde JSON)
- Archivo: `info/contact.json`
- Se inyecta en los links del bloque `#contacto` usando los atributos `data-contact`.

### Educación / Investigación / Premios (dinámico desde JSON)
- Educación: `info/education.json` -> contenedor `#education-items`
- Investigación (estancias): `info/research.json` -> contenedor `#research-items`
- Premios: `info/awards.json` -> contenedor `#awards-items`

### Docencia – listado de cursos (dinámico desde JSON)
- Archivo: `info/teaching-classroom.json`
- Uso:
  - `assets/app.js` carga este archivo y filtra cursos donde `section` contenga `UdeA` o `UdeM`.
  - Además excluye nombres: `Curso Modelo` y `Modelo de Curso`.

> Importante: el texto “Descripción” y “Tópicos importantes” no se toma de `teaching-classroom.json`, sino del mapeo de `assets/app.js` (ver siguiente sección).

### Docencia – descripción y tópicos (dinámico desde JSON)
- Archivo: `info/teaching-course-details.json`
- Uso:
  - `assets/app.js` carga este JSON y mapea `nombre del curso` -> `{ description, topics }`.
  - Render:
    - `Descripción` se muestra como `description`
    - `Tópicos importantes` se muestra como `topics`
    - `topics` se separa por bullets grandes: el código reemplaza separadores `⋅`/`·` por `• `.

### Publicaciones (dinámico desde JSON)
- Archivo: `info/papers.json`
- Render:
  - `assets/app.js` carga este archivo y renderiza:
    - “Publicaciones más recientes” (`#latest`) desde `selection: "recent"` (primeros 5)
    - “Más citados” (`#top-cited`) desde `selection: "top"` (primeros 5)
    - “Preprints” (`#preprints`) desde `selection: "preprint"` (primeros 5)

### Experiencia laboral (dinámico desde JSON)
- Archivo: `info/profile.json`
- Secciones:
  - “Experiencia laboral” está en `index.html` como contenedor `#experience-laboral-items`.
  - `assets/app.js` rellena esa lista leyendo `profile.experienceLaboral`.

### Contenido dinámico (render desde JSON)
- “Logros profesionales” (se renderiza en `#logros-profesionales-items` desde `info/logros-profesionales.json`)
- “Libros” (se renderiza en `#libros-items` desde `info/libros.json`)
- “Paquetes de software” (se renderiza en `#software-items` desde `info/software.json`)
- “Contacto” (labels/href desde `info/contact.json`)
- “Sobre mí” (texto desde `info/profile.json` -> `aboutMe`)
- “Educación” (desde `info/education.json`)
- “Estancias de investigación” (desde `info/research.json`)
- “Premios y reconocimientos” (desde `info/awards.json`)

> Nota: `index.html` conserva markup “placeholder” para no romper el layout si algo falla al cargar JSON; `assets/app.js` intenta limpiar esos contenedores y reemplazarlos por el render dinámico.

## Cómo actualizar: checklist rápido

1. Cambiar **nombre/headline/experiencia/supervisión/premios**: edita `info/profile.json`.
2. Cambiar **“Sobre mí”**: edita `info/profile.json` en `aboutMe`.
3. Cambiar **Contacto**: edita `info/contact.json`.
4. Cambiar **Educación / Estancias / Premios**: edita `info/education.json`, `info/research.json`, `info/awards.json`.
5. Cambiar **cursos** (lista y semestres): edita `info/teaching-classroom.json`.
6. Cambiar **descripción/tópicos** de un curso específico: edita `info/teaching-course-details.json`.
7. Cambiar **publicaciones**: edita `info/papers.json`.
8. Cambiar **estética o layout**: `assets/style.css` y/o `index.html` (solo estructura).

## Directorio `update/` (descargas manuales para futuras actualizaciones)

Para mantener el repo ordenado, cualquier **archivo descargado manualmente** (fuentes externas) debe guardarse en el directorio:

- `update/`

> Nota: este directorio es solo “staging” para actualizar datos. La página **no** lo lee directamente: la página consume únicamente `info/*.json`.

### Publicaciones y citaciones (Google Scholar + ORCID)

Los datos de **citaciones** se obtienen de **Google Scholar** (no de Google Classroom). Para futuras actualizaciones, guarda en `update/`:

- **Export de Google Scholar (HTML)**: guarda la página de tu perfil de Scholar como HTML.
  - Nombre sugerido: `update/google-scholar.html`
  - Uso típico: extraer conteos de citaciones por artículo y/o métricas agregadas.

- **BibTeX desde Google Scholar**:
  - En tu perfil de Scholar, selecciona los artículos (o “Seleccionar todo” si aplica).
  - Usa el botón **Exportar** → **BibTeX**.
  - Guarda el archivo como: `update/google-scholar.bib`

- **BibTeX desde ORCID**:
  - En tu perfil ORCID, ve a **Works**.
  - Usa **Export works** → **BibTeX**.
  - Guarda el archivo como: `update/orcid.bib`

### Cursos (Google Classroom)

La lista de cursos se actualiza **vía API** (no hay descarga manual “recomendada”). El JSON que consume la página es:

- `info/teaching-classroom.json`

Y se actualiza con:

```bash
make classroom
```

Credenciales/tokens:
- Credenciales OAuth: `sources/client_secret_*.json`
- Token: `sources/token_classroom.json`

> Importante: **no** guardes credenciales ni tokens dentro de `info/` o `assets/`.

### Biblioteca personal (fuente principal: `info/library.json`)

La página `biblioteca.html` **lee directamente**:

- `info/library.json` (fuente de verdad)

Y el archivo derivado para otros usos es:

- `info/library-stats.json` (resumen calculado desde `library.json`)

#### 0) Nota para mi yo del futuro: snapshot de likes locales (respaldo)

Problema que resolvimos:
- Si el worker falla/no responde, `biblioteca.html`, `biblioteca-todos.html` y `reviews/*.html` no deberían perder los “me gusta locales”.
- Se agregó respaldo persistente dentro de `info/library.json`.

Qué se implementó:
- Script: `bin/sync_local_review_likes.py`
- Make target: `make library-local-likes-sync`
- Campos nuevos por libro con reseña:
  - `reviewLocalLikes`
  - `reviewLocalLikesUpdatedAt`
- Bloque global:
  - `localLikesSnapshot` (fecha, totales y razones de fallo)

Comando normal:

```bash
make library-local-likes-sync
```

Comando con más detalle de progreso:

```bash
python3 -u bin/sync_local_review_likes.py --progress-every 50
```

Qué verás en consola:
- inicio con total de reseñas,
- progreso cada N reseñas,
- primeros fallos con `reviewId` y causa (`http_403`, `timeout`, etc.),
- resumen final de fallos.

Lección importante (incidente real):
- Si ves `failed=XXX` para todas, revisa `User-Agent`.
- Con `urllib` sin UA, el worker devolvía `403`.
- El script ya envía `User-Agent` (`curl/8.0`) por defecto para evitar ese bloqueo.

Fallback en frontend (ya integrado):
- `assets/library-page.js` y `assets/library-all-page.js` usan primero snapshot/cache y luego worker.
- `assets/review-page.js` usa snapshot local si el worker no devuelve conteo útil.

#### 1) Generar/actualizar `info/library.json` desde Goodreads RSS

Script:

- `bin/build_library_from_goodreads.py`

Comando recomendado (con scraping de likes y progreso):

```bash
make library-build \
  RSS_URL="https://www.goodreads.com/review/list_rss/<USER_ID>?key=<KEY>&shelf=%23ALL%23" \
  RSS_PAGES=40 \
  COOKIE="$GR_COOKIE"
```

RSS de este sitio:

- `https://www.goodreads.com/review/list_rss/91991657?key=kpN1wAHi2GZUUO7BHv1v3ZCOGhOk_QjljXSDnXSc3kA-lzU7&shelf=%23ALL%23`

Qué hace:
- descarga el RSS paginado (`--rss-pages`),
- filtra libros leídos,
- extrae título, autor, fecha de lectura, rating, URL de reseña (si existe),
- scrapea likes por reseña (si usas `--scrape-likes` + `--cookie`),
- y guarda `info/library.json`.

#### 2) Cómo obtener el cookie para `--cookie`

1. Inicia sesión en Goodreads.
2. Abre una reseña (`https://www.goodreads.com/review/show/...`).
3. Abre DevTools (`F12`).
4. Ve a **Network**.
5. Recarga la página.
6. Abre el request principal (`document`) de `review/show/...`.
7. En **Request Headers**, copia el valor completo de `cookie`.
8. Cárgalo en variable de entorno:

```bash
export GR_COOKIE='session-id=...; at-main=...; ccsid=...; locale=en; ...'
```

#### 3) Generar/actualizar `info/library-stats.json` desde `library.json`

Script:

- `bin/update_library_stats.py`

Comando:

```bash
make library-stats
```

Qué calcula:
- `yearlyReads`,
- `latestRead` (5),
- `topReviewedByLikes` (10),
- `latestReviewed` (5),
- `totals` (`booksRead`, `booksReviewed`, `totalReviewLikes`).

Notas:
- Si faltan libros, sube `--rss-pages` (por ejemplo `60`).
- Sin `--cookie`, muchas reseñas devolverán login y los likes quedarán en `0`.
- Trata el cookie como contraseña: no lo subas al repo ni lo compartas.

#### 3.1) Automatización con launchd (logs históricos + likes locales)

Para no depender de ejecución manual, quedó listo un job de macOS `launchd` que corre ambas tareas:

1) backup histórico de logs del worker (`make visitor-logs-sync`)
2) snapshot local de likes de reseñas (`make library-local-likes-sync`)

Archivos:
- `bin/run_periodic_data_sync.sh` (runner)
- `launchd/com.jorgezuluaga.cv-data-sync.plist` (job)

Paso 1: guarda el token en archivo local (fuera de git):

```bash
mkdir -p ".secrets"
printf '%s\n' 'TU_LOG_READ_TOKEN' > ".secrets/log_read_token"
chmod 600 ".secrets/log_read_token"
```

Paso 2: da permisos al script:

```bash
chmod +x bin/run_periodic_data_sync.sh
```

Paso 3: instala el job en `launchd` (usuario actual):

```bash
mkdir -p "$HOME/Library/LaunchAgents"
cp launchd/com.jorgezuluaga.cv-data-sync.plist "$HOME/Library/LaunchAgents/"
launchctl unload "$HOME/Library/LaunchAgents/com.jorgezuluaga.cv-data-sync.plist" 2>/dev/null || true
launchctl load "$HOME/Library/LaunchAgents/com.jorgezuluaga.cv-data-sync.plist"
```

Qué hace:
- corre al cargar sesión (`RunAtLoad`)
- corre diariamente a las 09:00 (`StartCalendarInterval`)
- ejecuta `make visitor-logs-sync` + `make library-local-likes-sync`
- hace `git add/commit/push` automático si hay cambios en snapshots
- escribe logs en:
  - `.secrets/cv-data-sync.out.log`
  - `.secrets/cv-data-sync.err.log`

Verificar estado:

```bash
launchctl list | rg cv-data-sync
```

Forzar ejecución manual del job:

```bash
launchctl kickstart -k gui/$(id -u)/com.jorgezuluaga.cv-data-sync
```

Desinstalar:

```bash
launchctl unload "$HOME/Library/LaunchAgents/com.jorgezuluaga.cv-data-sync.plist"
rm -f "$HOME/Library/LaunchAgents/com.jorgezuluaga.cv-data-sync.plist"
```

#### 4) Mirror local de reseñas (HTML en `reviews/`)

Scripts:

- `bin/mirror_all_reviews.py`: mirror masivo de todas las reseñas con `reviewUrl`.

Comandos:

```bash
# Mirror de todas las reseñas (salta las ya mirrorizadas)
make reviews-all COOKIE="$GR_COOKIE" REVIEW_RSS_PAGES=80

# Regenerar todas, incluso las ya existentes
make reviews-force COOKIE="$GR_COOKIE" REVIEW_RSS_PAGES=80
```

Notas importantes del mirror:

- Goodreads suele devolver página `Sign in` al abrir `review/show/...` sin autenticación.
- Cuando eso pasa, el script usa fallback al texto `user_review` del RSS.
- Por eso en el script masivo el valor por defecto de `--rss-pages` es **80** (para alcanzar reseñas antiguas).
- Si aun así faltan reseñas, sube más el rango (`--rss-pages 100`, por ejemplo) o usa `--cookie`.
- `mirror_all_reviews.py` muestra avance en consola (`[i/N] SKIP|OK|ERROR`) y actualiza `info/library.json` al final del proceso.
- Tras escribir `library.json`, el mirror recalcula **`reviewCount`**: número de palabras del cuerpo de la reseña en el HTML local (`<article class="card">`), para cada libro con `reviewUrl`.
- Para refrescar solo los conteos (p. ej. tras editar `reviews/*.html` a mano o con `reviews-fix`): `make library-review-counts` (script `bin/review_word_count.py`).

#### 5) Corrección ortográfica de reseñas (Gemini) sin exponer API key

Problema que resolvimos:
- Había una Google API key hardcodeada en `fix_reviews.py` (riesgo de seguridad).

Qué se cambió:
- El script se movió de raíz a `bin/fix_reviews.py`.
- Ahora la key es obligatoria por CLI: `--api-key`.
- El Makefile expone workflow seguro por variable de entorno:
  - `make reviews-fix` (requiere `GOOGLE_API_KEY`).
- El script corrige **solo** reseñas que NO tengan diff en:
  - `reviews/corrections/*.diff`

Uso recomendado:

```bash
GOOGLE_API_KEY="$(cat .secrets/googleapi)" make reviews-fix
```

Notas operativas:
- Si ya existe `reviews/corrections/<id>.diff`, esa reseña se salta.
- Si no hay cambios, se crea diff vacío y también se considera “ya revisada”.
- Mantiene pausa entre requests para no chocar con rate limits.

Higiene de seguridad (obligatorio si vuelves a ver alertas):
- Rotar/revocar inmediatamente una key filtrada.
- Nunca volver a guardar keys en código.
- Mantener `.secrets/googleapi` fuera de git (ya está ignorado con `.secrets/`).

## Verificación local (recomendado)

Desde la raíz del proyecto:
```bash
make dev
```
Luego abre `http://localhost:8000` y revisa:
- “Experiencia laboral” carga desde `profile.json`
- “Docencia” carga cursos desde `teaching-classroom.json`
- “Contacto” carga desde `contact.json`
- “Sobre mí” usa `profile.aboutMe`
- “Educación” carga desde `education.json`
- “Estancias de investigación” carga desde `research.json`
- “Premios y reconocimientos” carga desde `awards.json`
- “Descripción/Tópicos” aparecen solo para cursos que existan en `info/teaching-course-details.json`
- “Logros/Libros/Paquetes” cargan desde sus JSON (`logros-profesionales.json`, `libros.json`, `software.json`)
- “Publicaciones” se cargan desde `info/papers.json`

## Scripts (bin/)

### Sincronizar cursos de Google Classroom → `info/teaching-classroom.json`

El script usa tus credenciales/token guardados en `sources/` y genera el JSON que la página consume.

```bash
make classroom
```

## Notas de formato (evitar errores silenciosos)

- **`info/*.json` debe ser JSON válido**:
  - No uses comentarios `// ...`
  - Evita saltos de línea “crudos” dentro de strings (si necesitas párrafos, usa un solo string con espacios, o usa un arreglo de párrafos)

## Prompts (IA en VS Code / Antigravity / Cursor)

Esta sección contiene prompts listos para copiar/pegar y pedirle a un agente que actualice automáticamente archivos JSON del sitio.

> Recomendación: antes de ejecutar, coloca en `update/` los insumos descargados (ver sección “Directorio `update/`”).

### Prompt: actualizar `info/papers.json` (Scholar + ORCID)

Objetivo: reconstruir/actualizar `info/papers.json` usando **solo** los insumos en `update/` y manteniendo el esquema actual del sitio.

Prompt:

"""
Eres un agente de mantenimiento de este repositorio (hoja de vida web). Necesito que actualices `info/papers.json` usando como fuentes únicamente los archivos dentro de `update/`:

- `update/google-scholar.html` (para extraer el número de citaciones por artículo; si hay métricas agregadas, no son críticas)
- `update/google-scholar.bib` (lista de trabajos desde Scholar)
- `update/orcid.bib` (lista de trabajos desde ORCID)

Requisitos:
- El archivo final debe ser JSON válido (sin comentarios, sin trailing commas).
- El archivo destino es `info/papers.json` (no `assets/`).
- Cada entrada debe mantener el formato existente (campos típicos: `selection`, `title`, `author`, `journal`/`booktitle`, `year`, `doi`, `url`, `citations`, `source`).
- `selection` solo puede ser: `recent`, `top`, `preprint`, `hide`.
- NO dupliques artículos. Deduplica por DOI; si no hay DOI, por (título normalizado + año).
- Mantén/actualiza `citations` para TODOS los artículos (incluyendo preprints) a partir de `update/google-scholar.html` cuando sea posible. Si no se encuentra, usa `0`.
- Normaliza títulos: reemplaza entidades HTML tipo `&amp;` por `&`.
- Orden final: primero `recent`, luego `top`, luego `preprint`, luego `hide`; dentro de cada grupo ordena por año desc, citaciones desc, título asc. Muestra solo los primeros 5 por grupo en la web (el JSON puede tener más).

Entrega:
- Modifica `info/papers.json`.
- Si cambias el esquema, también ajusta `assets/app.js` para que siga funcionando, pero evita cambios innecesarios.
"""

### Prompt: actualizar `info/teaching-course-details.json` (microcurrículos)

Objetivo: extraer y/o resumir **Descripción** y **Tópicos importantes** de los microcurrículos en `sources/Microcurriculos/` y del archivo `sources/Microcurriculos/courses_summary.md`.

Prompt:

"""
Eres un agente de mantenimiento de este repositorio (hoja de vida web). Necesito que actualices `info/teaching-course-details.json` a partir de:

- `sources/Microcurriculos/courses_summary.md` (si un curso está ahí, usa esa información como base)
- los microcurrículos dentro de `sources/Microcurriculos/` (PDF/MD/DOCX según existan) para cursos que no estén en el summary o que tengan info incompleta.

Requisitos de salida (`info/teaching-course-details.json`):
- JSON válido.
- Debe ser un arreglo de objetos con estructura:
  - `name` (debe coincidir EXACTAMENTE con el nombre del curso en `info/teaching-classroom.json`)
  - `description` (texto en español, resumido; objetivo ~300 caracteres, ideal <= 300)
  - `topics` (string con tópicos separados por ` • `)
- NO uses puntos suspensivos (…).
- No recortes: resume hasta quedar alrededor de 300 caracteres (no truncar con ellipsis).
- Si un curso NO tiene descripción confiable, omítelo del JSON (la web mostrará solo “Ofrecido en”).
- Para `topics`, usa siempre el separador ` • ` (punto grande + espacios).

Entrega:
- Modifica `info/teaching-course-details.json`.
- Si encuentras nombres que no empatan por tildes/mayúsculas, NO cambies los nombres del JSON a “parecidos”: busca el nombre exacto usado en `info/teaching-classroom.json` y úsalo tal cual.
"""

## Próximo paso (opcional)

Ya se unificó la generación dinámica desde JSON. Si quieres dejar el repo aún más limpio, el siguiente paso sería:
- eliminar los placeholders antiguos de `index.html` (dejando solo `div` vacíos con `id`), para que no quede contenido duplicado en el HTML.

