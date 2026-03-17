# CV en GitHub Pages

Este repositorio contiene una hoja de vida (CV) **estática** para publicar en GitHub Pages. La página lee y muestra automáticamente tus publicaciones desde archivos en `sources/`.

## Estructura

- `index.html`: página principal (edita aquí tu nombre, enlaces y contacto).
- `assets/style.css`: estilos.
- `assets/app.js`: carga y parsea `sources/*.txt` y renderiza la lista.
- `sources/`: fuentes de publicaciones (exportes tipo BibTeX/ORCID).

## Probar en local

> Importante: por seguridad, el navegador no permite `fetch()` desde `file://`. Usa un servidor local.

Desde la raíz del proyecto:

```bash
python3 -m http.server 8000
```

Luego abre `http://localhost:8000`.

## Publicar en GitHub Pages (recomendado: `tu-usuario.github.io`)

1. En GitHub, crea un repo llamado **`<tu-usuario>.github.io`**.
2. En esta carpeta, inicializa git y sube el contenido:

```bash
git init
git add .
git commit -m "Add CV site"
git branch -M main
git remote add origin git@github.com:<tu-usuario>/<tu-usuario>.github.io.git
git push -u origin main
```

3. En GitHub → **Settings** → **Pages**:
   - Source: **Deploy from a branch**
   - Branch: **main**
   - Folder: **/(root)**

En 1–2 minutos tu página debe quedar en `https://<tu-usuario>.github.io/`.

## Publicar en GitHub Pages (alternativa: repo de proyecto)

Si prefieres publicar como proyecto (por ejemplo `https://<tu-usuario>.github.io/new-cv-zuluaga/`):

1. Crea un repo con cualquier nombre (ej. `new-cv-zuluaga`).
2. Sube el contenido igual que arriba.
3. En Settings → Pages, selecciona `main` y `/(root)`.

Nota: en este modo el sitio vive bajo un subpath, pero como usamos rutas relativas (`./assets/...`, `./sources/...`) funciona sin cambios.

## Actualizar publicaciones

- Reemplaza/actualiza los archivos en `sources/`.
- Haz commit y push.
- GitHub Pages se actualiza automáticamente.

