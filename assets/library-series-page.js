import {
  getPageLang,
  t,
  withLangQuery,
  applyThemeAriaFromLang,
} from "./i18n.js";
import { applyHeaderLangChrome, applyLibrarySectionNav } from "./library-nav.js";
import { trackPageView } from "./visitor-tracker.js";

function getLibraryData() {
  return Promise.all([
    fetch("./info/library.json").then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }),
    fetch("./info/book_series.json").then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }),
  ]);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
        localLink.href = withLangQuery(localReviewUrl);
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

function applySagasTranslations(lang) {
  document.title = t("library_sagas_page_title", lang) + " — " + t("library_title", lang);
  applyHeaderLangChrome(lang, {
    esId: "lib-series-lang-es",
    enId: "lib-series-lang-en",
    hrefEs: "./biblioteca-series.html",
    hrefEn: "./biblioteca-series.html?lang=en",
  });

  const titleEl = document.getElementById("library-sagas-page-title");
  if (titleEl) titleEl.textContent = t("library_sagas_page_title", lang);

  const introEl = document.getElementById("library-sagas-page-intro");
  if (introEl) introEl.textContent = t("library_sagas_page_intro", lang);

  const backLink = document.querySelector(".photos-back");
  if (backLink) {
    backLink.textContent = t("library_back", lang);
    backLink.setAttribute("href", withLangQuery("./biblioteca.html"));
  }

  const footer = document.querySelector("footer.print-mode-target p");
  if (footer) {
    const href = withLangQuery("./index.html");
    footer.innerHTML = `${t("footer_line", lang)} <a class="link" href="${href}">${escapeHtml(t("footer_cv_link", lang))}</a>`;
  }

  applyLibrarySectionNav(lang, "series");
}

async function initSagasPage() {
  trackPageView("library_sagas_page");
  const lang = getPageLang();
  applySagasTranslations(lang);
  applyThemeAriaFromLang(lang);

  const container = document.getElementById("all-series-list");
  if (container) {
    container.innerHTML = `<p style="opacity: 0.7;">Cargando colecciones...</p>`;
  }

  try {
    const [libData, seriesData] = await getLibraryData();
    const books = Array.isArray(libData?.books) ? libData.books : [];
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

    renderSeriesList(container, seriesWithMatches, booksById, lang);
  } catch (err) {
    console.error("Error cargando sagas:", err);
    if (container) {
      container.innerHTML = `<p class="error">${t("library_list_error", lang)}</p>`;
    }
  }
}

document.addEventListener("DOMContentLoaded", initSagasPage);
