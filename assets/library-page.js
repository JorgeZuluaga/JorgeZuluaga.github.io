const LIBRARY_JSON = "./info/library.json";

function parseDate(dateText) {
  const raw = String(dateText ?? "").trim();
  if (!raw) return null;
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function hasReview(item) {
  return String(item?.reviewUrl ?? "").includes("/review/show/");
}

function normalizeBooks(rawBooks) {
  return [...(rawBooks ?? [])]
    .filter((b) => b && b.title)
    .map((b) => ({
      ...b,
      _date: parseDate(b.dateRead),
      rating: Number.isFinite(Number(b.rating)) ? Number(b.rating) : 0,
      reviewLikes: Number.isFinite(Number(b.reviewLikes)) ? Number(b.reviewLikes) : 0,
    }));
}

function computeYearlyReads(books) {
  const byYear = new Map();
  for (const b of books) {
    const y = b._date?.getFullYear();
    if (!y) continue;
    byYear.set(y, (byYear.get(y) ?? 0) + 1);
  }
  return [...byYear.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => b.year - a.year);
}

function formatRating(rating) {
  const value = Number(rating);
  if (!value) return "Sin calificación";
  return `${value}/5`;
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
    const date = item.dateRead || item.dateAdded || "Fecha: —";
    const likes = Number.isFinite(Number(item.reviewLikes))
      ? `Likes reseña: ${item.reviewLikes}`
      : "Likes reseña: —";
    meta.textContent = `${author} · Fecha: ${date} · Calificación: ${formatRating(item.rating)} · ${likes}`;

    const actions = document.createElement("p");
    actions.className = "library-book-item__actions";
    const reviewUrl = String(item.reviewUrl || "");
    const hasReviewUrl = reviewUrl.includes("/review/show/");
    if (hasReviewUrl) {
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

  const titleEl = document.getElementById("library-page-title");
  const introEl = document.getElementById("library-page-intro");
  const profileEl = document.getElementById("goodreads-profile-link");
  const sourceEl = document.getElementById("library-source-note");
  const totalReadEl = document.getElementById("library-report-total-read");
  const totalReviewedEl = document.getElementById("library-report-reviewed");
  const totalLikesEl = document.getElementById("library-report-likes");
  const chartEl = document.getElementById("library-yearly-chart");
  const latestReadEl = document.getElementById("library-latest-read");
  const topReviewedEl = document.getElementById("library-top-reviewed");
  if (
    !titleEl ||
    !introEl ||
    !profileEl ||
    !sourceEl ||
    !totalReadEl ||
    !totalReviewedEl ||
    !totalLikesEl ||
    !chartEl ||
    !latestReadEl ||
    !topReviewedEl
  ) {
    return;
  }

  const books = normalizeBooks(data.books);
  const rows = computeYearlyReads(books);
  const latestRead = [...books]
    .filter((b) => b._date)
    .sort((a, b) => b._date - a._date)
    .slice(0, 10);
  const reviewed = books.filter((b) => hasReview(b));
  const topReviewedByLikes = [...reviewed]
    .sort((a, b) => {
      if (b.reviewLikes !== a.reviewLikes) return b.reviewLikes - a.reviewLikes;
      if (b.rating !== a.rating) return b.rating - a.rating;
      return (b._date?.getTime() ?? 0) - (a._date?.getTime() ?? 0);
    })
    .slice(0, 10);

  const totalRead = books.length;
  const totalReviewed = reviewed.length;
  const reviewedPct = totalRead ? (totalReviewed / totalRead) * 100 : 0;
  const totalLikes = reviewed.reduce((acc, b) => acc + (b.reviewLikes || 0), 0);

  titleEl.textContent = "Biblioteca personal";
  introEl.textContent =
    "En esta página incluyo estadísticas de lectura y una selección de libros leídos en años recientes con sus reseñas en Goodreads.";
  profileEl.href = "https://www.goodreads.com/user/show/91991657";
  profileEl.textContent = "Mi perfil en Goodreads";
  sourceEl.textContent = `Datos cargados desde info/library.json (${totalRead} libros leídos).`;
  totalReadEl.textContent = `${totalRead}`;
  totalReviewedEl.textContent = `${totalReviewed} (${reviewedPct.toFixed(1)}%)`;
  totalLikesEl.textContent = `${totalLikes}`;

  const maxCount = Math.max(...rows.map((r) => r.count), 1);
  const frag = document.createDocumentFragment();

  for (const row of rows) {
    const item = document.createElement("article");
    item.className = "library-chart__row";

    const year = document.createElement("div");
    year.className = "library-chart__year";
    year.textContent = String(row.year);

    const barWrap = document.createElement("div");
    barWrap.className = "library-chart__bar-wrap";

    const bar = document.createElement("div");
    bar.className = "library-chart__bar";
    bar.style.width = `${Math.max((row.count / maxCount) * 100, 2)}%`;

    const label = document.createElement("span");
    label.className = "library-chart__value";
    label.textContent = `${row.count} libros`;

    barWrap.appendChild(bar);
    barWrap.appendChild(label);
    item.appendChild(year);
    item.appendChild(barWrap);
    frag.appendChild(item);
  }

  chartEl.replaceChildren(frag);
  renderBookList(latestReadEl, latestRead);
  renderBookList(topReviewedEl, topReviewedByLikes);
}

main().catch((err) => {
  console.error(err);
  const chartEl = document.getElementById("library-yearly-chart");
  if (chartEl) {
    chartEl.innerHTML =
      "<p class=\"photo-card__error\"><strong>No se pudieron cargar las estadísticas de lectura.</strong> Compruebe que exista <code>info/library.json</code>.</p>";
  }
});
