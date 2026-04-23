import {
  applyThemeAriaFromLang,
  getPageLang,
  t,
  withLangQuery,
} from "./i18n.js";
import { trackPageView } from "./visitor-tracker.js";

const LIBRARY_JSON = "./info/library.json";
const BOOK_SERIES_JSON = "./info/book_series.json";

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

function formatRating(rating, lang) {
  const value = Number(rating);
  if (!value) return t("library_no_rating", lang);
  const stars = Math.round(value);
  return "⭐".repeat(stars) + '<span style="filter: grayscale(100%); opacity: 0.4;">⭐</span>'.repeat(5 - stars);
}

function renderBookList(container, items, lang) {
  if (!container) return;
  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = `<p class="photo-card__error">${escapeLibrary(t("library_no_data", lang))}</p>`;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const item of items) {
    const entry = document.createElement("article");
    entry.className = "library-book-item";

    const title = document.createElement("h3");
    title.className = "library-book-item__title";
    title.textContent = item.title ?? t("library_book_title_fallback", lang);

    const meta = document.createElement("p");
    meta.className = "library-book-item__meta";
    const author = item.author
      ? `${t("library_by_author", lang)} ${item.author}`
      : `${t("library_by_author", lang)} —`;
    const datePart = item.dateRead || item.dateAdded || "—";
    const likesLine = Number.isFinite(Number(item.reviewLikes))
      ? `${t("library_review_likes", lang)} ${item.reviewLikes}`
      : `${t("library_review_likes", lang)} —`;
    meta.innerHTML = `${author} · ${t("library_date", lang)} ${datePart} · ${t("library_rating_label", lang)}: ${formatRating(item.rating, lang)} · ${likesLine}`;

    const actions = document.createElement("p");
    actions.className = "library-book-item__actions";
    const reviewUrl = String(item.reviewUrl || "");
    const localReviewUrl = String(item.reviewLocalUrl || "");
    const hasReviewUrl = reviewUrl.includes("/review/show/");
    const hasLocalReview = localReviewUrl.endsWith(".html");
    if (hasLocalReview) {
      const localLink = document.createElement("a");
      localLink.className = "link";
      localLink.href = localReviewUrl;
      localLink.textContent = t("library_view_review_local", lang);
      actions.appendChild(localLink);
    }
    if (hasReviewUrl && hasLocalReview) {
      actions.append(" - ");
    }
    if (hasReviewUrl) {
      const goodreadsLink = document.createElement("a");
      goodreadsLink.className = "link";
      goodreadsLink.href = reviewUrl;
      goodreadsLink.target = "_blank";
      goodreadsLink.rel = "noopener noreferrer";
      goodreadsLink.textContent = t("library_view_review_goodreads", lang);
      actions.appendChild(goodreadsLink);
    }
    if (!hasReviewUrl && !hasLocalReview) {
      actions.textContent = t("library_no_review", lang);
    } else {
      actions.setAttribute("aria-label", t("library_review_links", lang));
    }

    entry.appendChild(title);
    entry.appendChild(meta);
    entry.appendChild(actions);
    frag.appendChild(entry);
  }
  container.replaceChildren(frag);
}

function renderSeriesList(container, seriesItems, booksById, lang) {
  if (!container) return;
  if (!Array.isArray(seriesItems) || seriesItems.length === 0) {
    container.replaceChildren();
    return;
  }

  const frag = document.createDocumentFragment();

  for (const series of seriesItems) {
    const entry = document.createElement("article");
    entry.className = "library-book-item";

    const title = document.createElement("h3");
    title.className = "library-book-item__title";
    title.textContent = series.name || "Saga";

    const meta = document.createElement("p");
    meta.className = "library-book-item__meta";
    meta.textContent = series.author || "—";

    const list = document.createElement("ul");
    list.className = "library-book-item__series";

    for (const bookRef of series.books || []) {
      const li = document.createElement("li");
      const bookId = String(bookRef.libraryBookId || "");
      const matchedBook = booksById.get(bookId);
      const bookTitle = String(bookRef.title || matchedBook?.title || "Libro");
      const localReviewUrl = String(matchedBook?.reviewLocalUrl || "");
      const dateRead = String(matchedBook?.dateRead || "");

      const titleSpan = document.createElement("span");
      titleSpan.textContent = bookTitle;
      li.appendChild(titleSpan);

      const links = [];
      if (localReviewUrl.endsWith(".html")) {
        const localLink = document.createElement("a");
        localLink.className = "link";
        localLink.href = localReviewUrl;
        localLink.target = "_blank";
        localLink.rel = "noopener noreferrer";
        localLink.textContent = t("library_view_review_local", lang);
        links.push(localLink);
      }

      if (dateRead) {
        li.appendChild(document.createTextNode(` (${t("library_date", lang)} ${dateRead})`));
      }

      if (links.length) {
        li.appendChild(document.createTextNode(" — "));
        links.forEach((lnk, idx) => {
          if (idx > 0) li.appendChild(document.createTextNode(" · "));
          li.appendChild(lnk);
        });
      }

      list.appendChild(li);
    }

    entry.appendChild(title);
    entry.appendChild(meta);
    entry.appendChild(list);
    frag.appendChild(entry);
  }

  container.replaceChildren(frag);
}

function escapeLibrary(s) {
  return (s ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function applyLibraryChrome(lang) {
  document.documentElement.lang = lang === "en" ? "en" : "es";
  document.title =
    lang === "en"
      ? "Personal library — Jorge I. Zuluaga"
      : "Biblioteca personal — Jorge I. Zuluaga";

  const back = document.querySelector(".photos-back");
  if (back) {
    back.textContent = t("library_back_cv", lang);
    back.setAttribute("href", withLangQuery("./index.html"));
  }

  const libEs = document.getElementById("lib-lang-es");
  const libEn = document.getElementById("lib-lang-en");
  if (libEs) {
    libEs.href = "./biblioteca.html";
    libEs.textContent = t("lang_es", lang);
  }
  if (libEn) {
    libEn.href = "./biblioteca.html?lang=en";
    libEn.textContent = t("lang_en", lang);
  }

  const skip = document.querySelector(".skip-link");
  if (skip) skip.textContent = t("skip", lang);

  document.querySelectorAll(".theme-button").forEach((btn) => {
    btn.setAttribute("aria-label", t("theme_toggle", lang));
  });
  applyThemeAriaFromLang(lang);

  const hYear = document.getElementById("library-h2-year");
  if (hYear) hYear.textContent = t("library_by_year", lang);
  const hLatest = document.getElementById("library-h2-latest");
  if (hLatest) hLatest.textContent = t("library_latest10", lang);
  const hTop = document.getElementById("library-h2-top");
  if (hTop) hTop.textContent = t("library_top10", lang);
  const hSeries = document.getElementById("library-h2-series");
  if (hSeries) hSeries.textContent = lang === "en" ? "Personal series and collections" : "Sagas y colecciones personales";

  const allLink = document.querySelector(".library-all-link");
  if (allLink) {
    allLink.textContent = t("library_show_all", lang);
    allLink.setAttribute("href", withLangQuery("./biblioteca-todos.html"));
  }

  const footer = document.querySelector("footer.print-mode-target p");
  if (footer) {
    const href = withLangQuery("./index.html");
    footer.innerHTML = `${t("footer_line", lang)} <a class="link" href="${href}">${escapeLibrary(t("footer_cv_link", lang))}</a>`;
  }
}

async function main() {
  const lang = getPageLang();
  trackPageView("library_page");
  applyLibraryChrome(lang);

  const res = await fetch(LIBRARY_JSON, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar ${LIBRARY_JSON} (${res.status})`);
  const data = await res.json();
  const seriesData = await fetch(BOOK_SERIES_JSON, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { series: [] }))
    .catch(() => ({ series: [] }));

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
  const seriesReadEl = document.getElementById("library-series-read");
  const seriesCardEl = seriesReadEl?.closest(".library-list-card");
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
    !topReviewedEl ||
    !seriesReadEl
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
  const booksById = new Map(books.map((b) => [String(b.bookId || ""), b]));
  const seriesWithMatches = (seriesData.series || [])
    .map((series) => ({
      ...series,
      books: (series.books || []).filter((bookRef) => {
        const id = String(bookRef?.libraryBookId || "");
        return id && booksById.has(id);
      }),
    }))
    .filter((series) => Array.isArray(series.books) && series.books.length > 0);
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

  titleEl.textContent = t("library_title", lang);
  introEl.textContent = t("library_intro", lang);
  profileEl.href = "https://www.goodreads.com/user/show/91991657";
  profileEl.textContent = t("library_profile", lang);
  sourceEl.textContent = "";
  totalReadEl.textContent = `${totalRead}`;
  totalReviewedEl.textContent = `${totalReviewed} (${reviewedPct.toFixed(1)}%)`;
  totalLikesEl.textContent = `${totalLikes}`;

  const label1 = document.querySelector(
    ".library-report__card:nth-of-type(1) .library-report__label",
  );
  if (label1) label1.textContent = t("library_read", lang);
  const label2 = document.querySelector(
    ".library-report__card:nth-of-type(2) .library-report__label",
  );
  if (label2) label2.textContent = t("library_reviewed", lang);
  const label3 = document.querySelector(
    ".library-report__card:nth-of-type(3) .library-report__label",
  );
  if (label3) label3.textContent = t("library_likes", lang);

  document.querySelector(".library-chart")?.setAttribute("aria-label", t("library_by_year", lang));

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
    label.textContent = `${row.count} ${t("library_books_per_year", lang)}`;

    barWrap.appendChild(bar);
    barWrap.appendChild(label);
    item.appendChild(year);
    item.appendChild(barWrap);
    frag.appendChild(item);
  }

  chartEl.replaceChildren(frag);
  renderBookList(latestReadEl, latestRead, lang);
  renderBookList(topReviewedEl, topReviewedByLikes, lang);
  if (seriesCardEl) {
    seriesCardEl.hidden = seriesWithMatches.length === 0;
  }
  renderSeriesList(seriesReadEl, seriesWithMatches, booksById, lang);
}

main().catch((err) => {
  console.error(err);
  const chartEl = document.getElementById("library-yearly-chart");
  const lang = getPageLang();
  if (chartEl) {
    chartEl.innerHTML = `<p class="photo-card__error">${t("library_stats_error", lang)}</p>`;
  }
});
