const LIBRARY_JSON = "./info/library.json";

function parseDate(dateText) {
  const raw = String(dateText ?? "").trim();
  if (!raw) return null;
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatRating(rating) {
  const value = Number(rating);
  if (!value) return "Sin calificación";
  const stars = Math.round(value);
  return "⭐".repeat(stars);
}

function renderBookList(container, items) {
  if (!container) return;
  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = "<p class=\"photo-card__error\">Sin datos disponibles.</p>";
    return;
  }

  const frag = document.createDocumentFragment();
  for (const item of items) {
    const entry = document.createElement("article");
    entry.className = "library-book-item";

    const title = document.createElement("h3");
    title.className = "library-book-item__title";
    title.textContent = item.title ?? "Libro sin título";

    const meta = document.createElement("p");
    meta.className = "library-book-item__meta";
    const author = item.author ? `Autor: ${item.author}` : "Autor: —";
    const date = item.dateRead || "Fecha: —";
    const likes = Number.isFinite(Number(item.reviewLikes))
      ? `Likes reseña: ${item.reviewLikes}`
      : "Likes reseña: —";
    meta.textContent = `${author} · Fecha: ${date} · Calificación: ${formatRating(item.rating)} · ${likes}`;

    const actions = document.createElement("p");
    actions.className = "library-book-item__actions";
    const reviewUrl = String(item.reviewUrl || "");
    if (reviewUrl.includes("/review/show/")) {
      const a = document.createElement("a");
      a.className = "link";
      a.href = reviewUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "Ver reseña";
      actions.appendChild(a);
    } else {
      actions.textContent = "(No hay reseña)";
    }

    entry.appendChild(title);
    entry.appendChild(meta);
    entry.appendChild(actions);
    frag.appendChild(entry);
  }
  container.replaceChildren(frag);
}

async function main() {
  const res = await fetch(LIBRARY_JSON, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar ${LIBRARY_JSON} (${res.status})`);
  const data = await res.json();
  const listEl = document.getElementById("all-books-list");
  if (!listEl) return;

  const books = [...(data.books ?? [])]
    .filter((b) => b && b.title)
    .map((b) => ({ ...b, _date: parseDate(b.dateRead) }))
    .sort((a, b) => (b._date?.getTime() ?? 0) - (a._date?.getTime() ?? 0));

  renderBookList(listEl, books);
}

main().catch((err) => {
  console.error(err);
  const listEl = document.getElementById("all-books-list");
  if (listEl) {
    listEl.innerHTML =
      "<p class=\"photo-card__error\"><strong>No se pudieron cargar los libros.</strong> Compruebe que exista <code>info/library.json</code>.</p>";
  }
});
