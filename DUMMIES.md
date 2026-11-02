# Guía para dummies

Todos los comandos se corren en la Terminal, desde la carpeta del proyecto:

```bash
cd /Users/jzuluaga/dev/jorgezuluaga
```

Si algo falla o necesitas más detalle, mira [QUICKSTART.md](QUICKSTART.md).

---

## 1. Tengo archivos nuevos de BookBuddy

1. Exporta desde BookBuddy el CSV y el HTML y cópialos a la carpeta `update/` con **estos nombres** (reemplazando los anteriores):
   - `update/bookbuddy.csv`
   - `update/bookbuddy.htm`
2. Trae lo último de GitHub (para evitar conflictos):
   ```bash
   make stash
   ```
3. Actualiza el catálogo con los libros nuevos:
   ```bash
   make library-bookbuddy-update
   ```
4. (Opcional) Si quieres las portadas nuevas del HTML:
   ```bash
   make library-bookbuddy-covers
   ```
5. Concilia con las ubicaciones (respalda `library*.json` en `info/backup/` y agrega los ISBN secundarios):
   ```bash
   make booklocation-backup
   make booklocation-recon
   ```
6. Abre `info/backup/reconciliation.md`: ahí están los libros con problemas (no están en el catálogo o ISBN no válido).
7. Publica:
   ```bash
   git add -A
   git commit -m "Actualiza catálogo BookBuddy"
   git push
   ```

> Ojo: si en BookBuddy cambiaste el ISBN de un libro, puede quedar duplicado en el catálogo. Revisa por título.

---

## 2. Escribí reseñas nuevas en Goodreads y quiero actualizar la biblioteca

1. Trae lo último de GitHub:
   ```bash
   make stash
   ```
2. Corre la actualización completa (libros nuevos, likes, reseñas, ISBN, enlaces de Buscalibre, estadísticas y correo a suscriptores):
   ```bash
   make library-daily-goodreads
   ```
   Si solo quieres bajar las últimas reseñas (sin el resto):
   ```bash
   make library-goodreads-reviews-latest
   ```
3. Si editaste el texto de una reseña ya publicada, tráelo de nuevo con su número (el que aparece en la URL de la reseña):
   ```bash
   make reviews-remirror-text REVIEW_IDS=8171377602
   ```
4. Mira cómo quedó:
   ```bash
   make status
   ```
5. Publica:
   ```bash
   git add -A
   git commit -m "Actualiza reseñas"
   git push
   ```

---

## Si algo sale mal

- **Conflicto de git al hacer `make stash`:** avísame o mira el archivo marcado como `both modified`; en `info/sync-state.json` conviene quedarse con la versión remota.
- **Lista de comandos disponibles:** `make help`.
