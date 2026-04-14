import {
  applyThemeAriaFromLang,
  getPageLang,
  t,
  withLangQuery,
} from "./i18n.js";

const LIBRARY_JSON = "./info/library.json";

function parseDate(dateText) {
  const raw = String(dateText ?? "").trim();
  if (!raw) return null;
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatRating(rating, lang) {
  const value = Number(rating);
  if (!value) return t("library_no_rating", lang);
  const stars = Math.round(value);
  return "⭐".repeat(stars) + '<span style="filter: grayscale(100%); opacity: 0.4;">⭐</span>'.repeat(5 - stars);
}

function escapeLibrary(s) {
  return (s ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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
    const datePart = item.dateRead || "—";
    const likesLine = Number.isFinite(Number(item.reviewLikes))
      ? `${t("library_review_likes", lang)} ${item.reviewLikes}`
      : `${t("library_review_likes", lang)} —`;
    meta.innerHTML = `${author} · ${t("library_date", lang)} ${datePart} · ${t("library_rating_label", lang)}: ${formatRating(item.rating, lang)} · ${likesLine}`;

    const actions = document.createElement("p");
    actions.className = "library-book-item__actions";
    const reviewUrl = String(item.reviewUrl || "");
    if (reviewUrl.includes("/review/show/")) {
      const a = document.createElement("a");
      a.className = "link";
      a.href = reviewUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = t("library_view_review", lang);
      actions.appendChild(a);
    } else {
      actions.textContent = t("library_no_review", lang);
    }

    entry.appendChild(title);
    entry.appendChild(meta);
    entry.appendChild(actions);
    frag.appendChild(entry);
  }
  container.replaceChildren(frag);
}

function applyLibraryAllChrome(lang) {
  document.documentElement.lang = lang === "en" ? "en" : "es";
  document.title =
    lang === "en" ? "All books — Personal library" : "Todos los libros — Biblioteca personal";

  const back = document.querySelector(".photos-back");
  if (back) {
    back.textContent = t("library_back", lang);
    back.setAttribute("href", withLangQuery("./biblioteca.html"));
  }

  const libEs = document.getElementById("lib-all-lang-es");
  const libEn = document.getElementById("lib-all-lang-en");
  if (libEs) {
    libEs.href = "./biblioteca-todos.html";
    libEs.textContent = t("lang_es", lang);
  }
  if (libEn) {
    libEn.href = "./biblioteca-todos.html?lang=en";
    libEn.textContent = t("lang_en", lang);
  }

  const skip = document.querySelector(".skip-link");
  if (skip) skip.textContent = t("skip", lang);

  document.querySelectorAll(".theme-button").forEach((btn) => {
    btn.setAttribute("aria-label", t("theme_toggle", lang));
  });
  applyThemeAriaFromLang(lang);

  const h1 = document.querySelector("#all-books-main h1.title-section");
  if (h1) h1.textContent = t("library_all_title", lang);
  const intro = document.querySelector("#all-books-main .photos-intro");
  if (intro) intro.textContent = t("library_all_intro", lang);

  const footer = document.querySelector("footer.print-mode-target p");
  if (footer) {
    const href = withLangQuery("./index.html");
    footer.innerHTML = `${t("footer_line", lang)} <a class="link" href="${href}">${escapeLibrary(t("footer_cv_link", lang))}</a>`;
  }
}

async function main() {
  const lang = getPageLang();
  applyLibraryAllChrome(lang);

  const res = await fetch(LIBRARY_JSON, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar ${LIBRARY_JSON} (${res.status})`);
  const data = await res.json();
  const listEl = document.getElementById("all-books-list");
  if (!listEl) return;

  const books = [...(data.books ?? [])]
    .filter((b) => b && b.title)
    .map((b) => ({ ...b, _date: parseDate(b.dateRead) }))
    .sort((a, b) => (b._date?.getTime() ?? 0) - (a._date?.getTime() ?? 0));

  renderBookList(listEl, books, lang);
}

main().catch((err) => {
  console.error(err);
  const listEl = document.getElementById("all-books-list");
  const lang = getPageLang();
  if (listEl) {
    listEl.innerHTML = `<p class="photo-card__error">${t("library_list_error", lang)}</p>`;
  }
});
