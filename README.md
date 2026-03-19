# Hoja de vida en GitHub Pages (template)

Este repositorio es un **template de hoja de vida en HTML/CSS/JS**, pensado para publicarse fácilmente en **GitHub Pages**.  
La página es estática, pero la mayor parte del contenido se mantiene en archivos JSON dentro de `info/`.

## Estructura del sitio

- **`index.html`**: estructura de la página (contenedores/IDs y secciones).
- **`assets/`**: frontend (solo archivos estáticos del navegador).
  - `assets/app.js`: render dinámico (lee `info/*.json`).
  - `assets/style.css`: estilos (incluye reglas de impresión).
  - imágenes (p. ej. `assets/profile.jpg`).
- **`info/`**: **fuente de verdad** del contenido editable (JSON).
  - `info/profile.json`: nombre, headline, “Sobre mí”, experiencia laboral, etc.
  - `info/contact.json`: enlaces de contacto (WhatsApp, email, GitHub, web, CvLAC…).
  - `info/papers.json`: publicaciones (recent/top/preprint/hide).
  - otros JSON: educación, estancias, libros, logros, software, etc.
- **`bin/`**: scripts de mantenimiento.
  - `bin/sync_classroom.py`: sincroniza cursos desde Google Classroom hacia `info/teaching-classroom.json`.
- **`update/`**: **descargas manuales** (staging) para futuras actualizaciones.
  - Aquí van los archivos que descargas de Scholar/ORCID (HTML, BibTeX, etc.).
- **`sources/`**: insumos sensibles o históricos (por ejemplo credenciales/tokens de Classroom).  
  **No** se usan para el render del sitio público.

> Guía detallada de mantenimiento: ver `UPDATE.md`.

## Probar en local

> Importante: por seguridad, el navegador no permite `fetch()` desde `file://`. Usa un servidor local.

Desde la raíz del proyecto:

```bash
python3 -m http.server 8000
```

Luego abre `http://localhost:8000`.

Si tienes `make` disponible, también puedes usar:

```bash
make start
```

## Crear tu repositorio en GitHub (paso a paso)

Tienes dos opciones:

### Opción A (recomendada): sitio en la raíz `https://<tu-usuario>.github.io/`

1. En GitHub crea un repositorio llamado **`<tu-usuario>.github.io`**.
2. Clona tu repositorio vacío en tu computador:

```bash
git clone https://github.com/<tu-usuario>/<tu-usuario>.github.io.git
cd <tu-usuario>.github.io
```

3. Copia los archivos de este template dentro del repo (o usa “Use this template” desde GitHub si lo publicas como template).
4. Haz commit y push:

```bash
git add .
git commit -m "Publicar hoja de vida"
git push -u origin main
```

5. Activa GitHub Pages:
   - GitHub → **Settings** → **Pages**
   - **Source**: “Deploy from a branch”
   - **Branch**: `main`
   - **Folder**: `/(root)`

En 1–2 minutos, tu sitio quedará publicado en `https://<tu-usuario>.github.io/`.

### Opción B: sitio como “proyecto” `https://<tu-usuario>.github.io/<repo>/`

1. Crea un repositorio con cualquier nombre (p. ej. `mi-cv`).
2. Sube el contenido (commit/push).
3. Activa Pages igual que arriba (`main` + `/(root)`).

Este template usa rutas relativas (`./assets/...`, `./info/...`), así que funciona bien también bajo subruta.

## Cómo personalizar el contenido

- **Nombre, headline, “Sobre mí”, experiencia laboral**: edita `info/profile.json`.
- **Contacto**: edita `info/contact.json`.
- **Publicaciones**: edita `info/papers.json`.
- **Resto de secciones**: edita los JSON correspondientes en `info/`.

## Descargar insumos en `update/` (Scholar + ORCID)

Para futuras actualizaciones, guarda en `update/`:

- **Google Scholar (HTML del perfil)**: `update/google-scholar.html`
- **Google Scholar (BibTeX exportado)**: `update/google-scholar.bib`
- **ORCID (BibTeX exportado)**: `update/orcid.bib`

> Nota: la web no lee `update/` directamente. Es solo una carpeta de “descargas” para alimentar futuras actualizaciones de `info/papers.json`.

## Autor

**Jorge I. Zuluaga**. Este template fue desarrollado con **vibecoding** en **Cursor**, usando como plantilla de ejemplo el repositorio [`LucianoTreachi/curriculum-vitae-web`](https://github.com/LucianoTreachi/curriculum-vitae-web).

