# QUICKSTART

Guía corta para operar este repo sin entrar en todos los detalles.

## 1) Flujo manual frecuente (likes, reseñas, ortografía, BookBuddy)

### A. Actualizar likes y traer últimas reseñas

Desde la raíz del repo:

```bash
bash .secrets/update-likes.sh
```

Esto ejecuta en cadena:
- refresh de likes desde Goodreads,
- snapshot de likes locales,
- refresh de las últimas reseñas locales (top recientes).

### B. Corregir ortografía de reseñas nuevas

```bash
GOOGLE_API_KEY="$(cat .secrets/googleapi)" make reviews-fix
```

Notas rápidas:
- el script salta reseñas que ya tengan diff en `reviews/corrections/`,
- corrige solo pendientes.

### C. Cuando agregues libros nuevos en BookBuddy

1) sube/actualiza `info/bookbuddy.csv`  
2) corre:

```bash
make library-details-sync
```

Esto hace:
- import a `info/library-details.json`,
- match de `bookId` contra `info/library.json`.

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
