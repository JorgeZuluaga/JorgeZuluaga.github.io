# Cómo actualizar el CV (estructura + fuentes de datos)

Este sitio mezcla **contenido estático** (marcado en `index.html`) con **contenido dinámico** renderizado por JavaScript (principalmente `assets/app.js`). Para mantenimiento, la regla es: **cuando un bloque sea repetible (lista de ítems con campos), lo ideal es que viva en JSON y lo renderice `app.js`**.

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

## Verificación local (recomendado)

Desde la raíz del proyecto:
```bash
python3 -m http.server 8000
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
python3 bin/sync_classroom.py
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

