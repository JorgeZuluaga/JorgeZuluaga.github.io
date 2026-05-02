import {
  applyThemeAriaFromLang,
  getPageLang,
  t,
  withLangQuery,
} from "./i18n.js";
import { trackPageView } from "./visitor-tracker.js";

const LIBRARY_JSON = "./info/library.json";
const LOCAL_LIKES_CACHE_PREFIX = "review_local_likes_count_";
const DEFAULT_PAGE_SIZE = 50;

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
  return (
    `<span class="library-rating-stars">${"★".repeat(stars)}</span>` +
    `<span class="library-rating-stars library-rating-stars--empty">${"★".repeat(5 - stars)}</span>`
  );
}

function parseReviewIdFromUrl(reviewUrl) {
  const match = String(reviewUrl || "").match(/\/review\/show\/(\d+)/);
  return match ? match[1] : "";
}

function endpointFromMeta() {
  const el = document.querySelector('meta[name="visitor-log-endpoint"]');
  return String(el?.getAttribute("content") || "").trim();
}

function workerBaseFromLogEndpoint() {
  const endpoint = endpointFromMeta();
  if (!endpoint) return "";
  try {
    const url = new URL(endpoint, window.location.href);
    if (url.pathname.endsWith("/log")) {
      url.pathname = url.pathname.slice(0, -4) || "/";
    } else {
      url.pathname = "/";
    }
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function localLikesCacheKey(reviewId) {
  return `${LOCAL_LIKES_CACHE_PREFIX}${reviewId}`;
}

function readCachedLocalLikes(reviewId) {
  const raw = sessionStorage.getItem(localLikesCacheKey(reviewId));
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function writeCachedLocalLikes(reviewId, count) {
  const safe = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
  sessionStorage.setItem(localLikesCacheKey(reviewId), String(safe));
}

function localLikesSuffixHtml(reviewId, lang) {
  if (!reviewId) return "";
  return ` · <span class="library-tooltip" data-title="${escapeLibrary(t("library_likes_local_hover", lang))}" data-local-likes-for="${reviewId}">👏 —</span>`;
}

function readSnapshotLocalLikes(item) {
  const value = Number(item?.reviewLocalLikes);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function pickBestKnownLocalLikes(snapshotValue, cachedValue) {
  if (snapshotValue === null && cachedValue === null) return null;
  if (snapshotValue === null) return cachedValue;
  if (cachedValue === null) return snapshotValue;
  return Math.max(snapshotValue, cachedValue);
}

async function fetchLocalLikeCount(base, reviewId) {
  if (!base || !reviewId) return null;
  try {
    const response = await fetch(`${base}/review-like-count/${reviewId}`, { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    const count = Number(data?.count);
    return Number.isFinite(count) ? Math.max(0, count) : null;
  } catch {
    return null;
  }
}

function renderLocalLikesInContainer(container, map, lang) {
  if (!container || !map?.size) return;
  container.querySelectorAll("[data-local-likes-for]").forEach((node) => {
    const reviewId = String(node.getAttribute("data-local-likes-for") || "");
    if (!reviewId || !map.has(reviewId)) return;
    node.textContent = `👏 ${map.get(reviewId)}`;
  });
}

async function mapWithConcurrency(items, worker, concurrency = 8) {
  const queue = [...items];
  const runners = [];
  for (let i = 0; i < Math.max(1, concurrency); i += 1) {
    runners.push((async () => {
      while (queue.length) {
        const next = queue.shift();
        if (!next) return;
        await worker(next);
      }
    })());
  }
  await Promise.all(runners);
}

async function hydrateLocalLikes(container, items, lang) {
  if (!container || !Array.isArray(items) || items.length === 0) return;
  const base = workerBaseFromLogEndpoint();
  if (!base) return;

  const reviewIds = [...new Set(items.map((x) => parseReviewIdFromUrl(x?.reviewUrl)).filter(Boolean))];
  if (reviewIds.length === 0) return;

  const counts = new Map();
  const missing = [];
  const bookByReviewId = new Map();
  for (const item of items) {
    const reviewId = parseReviewIdFromUrl(item?.reviewUrl);
    if (reviewId) bookByReviewId.set(reviewId, item);
  }
  for (const reviewId of reviewIds) {
    const fromSnapshot = readSnapshotLocalLikes(bookByReviewId.get(reviewId));
    const cached = readCachedLocalLikes(reviewId);
    const known = pickBestKnownLocalLikes(fromSnapshot, cached);
    if (known !== null) {
      counts.set(reviewId, known);
      if (cached === null || known > cached) {
        writeCachedLocalLikes(reviewId, known);
      }
      continue;
    }
    missing.push(reviewId);
  }
  renderLocalLikesInContainer(container, counts, lang);

  await mapWithConcurrency(missing, async (reviewId) => {
    const count = await fetchLocalLikeCount(base, reviewId);
    if (count === null) return;
    writeCachedLocalLikes(reviewId, count);
    counts.set(reviewId, count);
  }, 8);

  renderLocalLikesInContainer(container, counts, lang);
}

function escapeLibrary(s) {
  return (s ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildPagerLabels(lang) {
  if (lang === "en") {
    return {
      prev: "Previous",
      next: "Next",
      perPage: "Books per page",
      showAll: "Show all",
      showPaged: "Use pagination",
      page: "Page",
      of: "of",
      total: "Total",
    };
  }
  return {
    prev: "Anterior",
    next: "Siguiente",
    perPage: "Libros por página",
    showAll: "Mostrar todos",
    showPaged: "Usar paginación",
    page: "Página",
    of: "de",
    total: "Total",
  };
}

function createPagerControls(listEl, lang, onChange, position = "before") {
  const labels = buildPagerLabels(lang);
  const wrap = document.createElement("section");
  wrap.className = "library-list-card library-pager";
  if (position === "after") wrap.classList.add("library-pager--bottom");

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "library-pager__btn";
  prevBtn.textContent = labels.prev;

  const pageInfo = document.createElement("span");
  pageInfo.className = "library-pager__info";

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "library-pager__btn";
  nextBtn.textContent = labels.next;

  const perPageLabel = document.createElement("label");
  perPageLabel.className = "library-pager__label";
  perPageLabel.textContent = `${labels.perPage}: `;
  const perPageInput = document.createElement("input");
  perPageInput.type = "number";
  perPageInput.min = "1";
  perPageInput.step = "1";
  perPageInput.value = String(DEFAULT_PAGE_SIZE);
  perPageInput.className = "library-pager__input";
  perPageLabel.appendChild(perPageInput);

  const showAllBtn = document.createElement("button");
  showAllBtn.type = "button";
  showAllBtn.className = "library-pager__btn";

  wrap.appendChild(prevBtn);
  wrap.appendChild(pageInfo);
  wrap.appendChild(nextBtn);
  wrap.appendChild(perPageLabel);
  wrap.appendChild(showAllBtn);
  if (position === "after") {
    listEl.parentElement?.insertBefore(wrap, listEl.nextSibling);
  } else {
    listEl.parentElement?.insertBefore(wrap, listEl);
  }

  function emitFromUI() {
    const parsed = Number(perPageInput.value);
    const pageSize = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_PAGE_SIZE;
    perPageInput.value = String(pageSize);
    onChange({
      action: "ui",
      pageSize,
    });
  }

  prevBtn.addEventListener("click", () => {
    onChange({ action: "prev" });
  });
  nextBtn.addEventListener("click", () => {
    onChange({ action: "next" });
  });
  perPageInput.addEventListener("change", () => {
    emitFromUI();
  });
  showAllBtn.addEventListener("click", () => {
    onChange({ action: "toggle_all" });
  });

  function renderState(state, totalItems) {
    const currentPage = state.currentPage;
    const pageSize = state.pageSize;
    const showAll = state.showAll;
    perPageInput.value = String(pageSize);
    const maxPage = Math.max(1, Math.ceil(totalItems / Math.max(1, pageSize)));
    if (showAll) {
      pageInfo.textContent = `${labels.total}: ${totalItems}`;
    } else {
      pageInfo.textContent = `${labels.page} ${currentPage} ${labels.of} ${maxPage} · ${labels.total}: ${totalItems}`;
    }
    prevBtn.disabled = showAll || currentPage <= 1;
    nextBtn.disabled = showAll || currentPage >= maxPage;
    showAllBtn.textContent = showAll ? labels.showPaged : labels.showAll;
  }

  return {
    renderState,
  };
}

function applyPagination(items, pagerState) {
  if (pagerState.showAll) return items;
  const size = Math.max(1, pagerState.pageSize);
  const start = (pagerState.currentPage - 1) * size;
  return items.slice(start, start + size);
}

function renderBookList(container, items, lang, seriesMap = new Map()) {
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

    const meta1 = document.createElement("p");
    meta1.className = "library-book-item__meta";
    const author = item.author ? item.author : "—";
    meta1.innerHTML = `<strong>${escapeLibrary(t("library_by_author", lang))}</strong> ${escapeLibrary(author)}`;

    const meta2 = document.createElement("p");
    meta2.className = "library-book-item__meta";
    let meta2Parts = [];
    
    const bookId = String(item.bookId || "");
    const seriesName = (bookId && seriesMap.has(bookId)) ? seriesMap.get(bookId) : "";
    if (seriesName && seriesName !== "(Ninguna)" && seriesName !== "(None)") {
      meta2Parts.push(`${escapeLibrary(t("library_series", lang))} ${escapeLibrary(seriesName)}`);
    }

    if (meta2Parts.length > 0) {
      meta2.innerHTML = meta2Parts.join(" · ");
    }

    const metaDate = document.createElement("p");
    metaDate.className = "library-book-item__meta";
    const datePart = item.dateRead || item.dateAdded || "";
    if (datePart && datePart !== "—") {
      const hasDetails = Number(item.bookDetails) === 1;
      const detailLabel = hasDetails
        ? t("library_details_present", lang)
        : t("library_details_missing", lang);
      const detailClass = hasDetails
        ? "library-details-status library-details-status--present"
        : "library-details-status library-details-status--missing";
      metaDate.innerHTML = `<strong>${escapeLibrary(t("library_date_read", lang))}</strong> ${escapeLibrary(datePart)} (<span class="${detailClass}">${escapeLibrary(detailLabel)}</span>)`;
    }

    const meta3 = document.createElement("p");
    meta3.className = "library-book-item__meta";
    let meta3Parts = [];
    
    let ratingLabel = t("library_rating_label", lang);
    meta3Parts.push(`<strong>${escapeLibrary(ratingLabel)}</strong> <span class="library-tooltip" data-title="${escapeLibrary(t("library_rating_gr_hover", lang))}">${formatRating(item.rating, lang)}</span>`);

    if (item.drzrating !== undefined && item.drzrating !== -1) {
      let drzLabel = t("library_rating_drz", lang);
      meta3Parts.push(`<strong>${escapeLibrary(drzLabel)}</strong> <span class="library-tooltip" data-title="${escapeLibrary(t("library_rating_drz_hover", lang))}">🤓 ${escapeLibrary(String(item.drzrating))}</span>`);
    }

    meta3.innerHTML = meta3Parts.join(" · ");

    const actions = document.createElement("p");
    actions.className = "library-book-item__actions";
    
    const reviewUrl = String(item.reviewUrl || "");
    const localReviewUrl = String(item.reviewLocalUrl || "");
    const hasReviewUrl = reviewUrl.includes("/review/show/");
    const hasLocalReview = localReviewUrl.endsWith(".html");
    const reviewId = parseReviewIdFromUrl(item.reviewUrl);
    
    let actionsHtml = "";

    if (hasLocalReview) {
      actionsHtml += `<a class="link" href="${escapeLibrary(localReviewUrl)}">${escapeLibrary(t("library_view_review", lang))}</a>`;
    } else if (hasReviewUrl) {
      actionsHtml += `<a class="link" href="${escapeLibrary(reviewUrl)}" target="_blank" rel="noopener noreferrer">${escapeLibrary(t("library_view_review", lang))}</a>`;
    }
    
    if (actionsHtml) {
      const reactionsText = lang === "en" ? "Reactions" : "Reacciones a la reseña";
      const likesCount = Number.isFinite(Number(item.reviewLikes)) ? item.reviewLikes : 0;
      actionsHtml += ` · ${reactionsText} <span class="library-tooltip" data-title="${escapeLibrary(t("library_likes_gr_hover", lang))}">👍 ${likesCount}</span>${localLikesSuffixHtml(reviewId, lang)}`;
      actions.innerHTML = actionsHtml;
      actions.setAttribute("aria-label", t("library_review_links", lang));
    }

    entry.appendChild(title);
    entry.appendChild(meta1);
    if (meta2Parts.length > 0) entry.appendChild(meta2);
    if (datePart && datePart !== "—") entry.appendChild(metaDate);
    entry.appendChild(meta3);
    if (actionsHtml) entry.appendChild(actions);
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
  const antiLink = document.getElementById("btn-all-anti-library");
  if (antiLink) {
    antiLink.textContent = t("library_show_antilibrary", lang);
    antiLink.setAttribute("href", withLangQuery("./antibiblioteca.html"));
  }

  const footer = document.querySelector("footer.print-mode-target p");
  if (footer) {
    const href = withLangQuery("./index.html");
    footer.innerHTML = `${t("footer_line", lang)} <a class="link" href="${href}">${escapeLibrary(t("footer_cv_link", lang))}</a>`;
  }
}

async function main() {
  const lang = getPageLang();
  trackPageView("library_all_page");
  applyLibraryAllChrome(lang);

  const res = await fetch(LIBRARY_JSON, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar ${LIBRARY_JSON} (${res.status})`);
  const data = await res.json();
  const listEl = document.getElementById("all-books-list");
  if (!listEl) return;

  const seriesData = await fetch("./info/book_series.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { series: [] }))
    .catch(() => ({ series: [] }));

  const seriesMap = new Map();
  for (const series of seriesData.series || []) {
    for (const b of series.books || []) {
      if (b.libraryBookId) {
        seriesMap.set(String(b.libraryBookId), series.name);
      }
    }
  }

  const books = [...(data.books ?? [])]
    .filter((b) => b && b.title)
    .map((b) => ({ ...b, _date: parseDate(b.dateRead) }))
    .filter((b) => b._date)
    .sort((a, b) => (b._date?.getTime() ?? 0) - (a._date?.getTime() ?? 0));
  let pagerState = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE, showAll: false };
  const onPagerAction = (event) => {
    const maxPage = Math.max(1, Math.ceil(books.length / Math.max(1, pagerState.pageSize)));
    if (event.action === "prev") {
      pagerState.currentPage = Math.max(1, pagerState.currentPage - 1);
    } else if (event.action === "next") {
      pagerState.currentPage = Math.min(maxPage, pagerState.currentPage + 1);
    } else if (event.action === "toggle_all") {
      pagerState.showAll = !pagerState.showAll;
      pagerState.currentPage = 1;
    } else if (event.action === "ui") {
      pagerState.pageSize = event.pageSize;
      pagerState.currentPage = 1;
    }
    rerender();
  };
  let pagerTop = null;
  let pagerBottom = null;
  const rerender = () => {
    const maxPage = Math.max(1, Math.ceil(books.length / Math.max(1, pagerState.pageSize)));
    if (pagerState.currentPage > maxPage) pagerState.currentPage = maxPage;
    pagerTop?.renderState(pagerState, books.length);
    pagerBottom?.renderState(pagerState, books.length);
    const visibleBooks = applyPagination(books, pagerState);
    renderBookList(listEl, visibleBooks, lang, seriesMap);
    hydrateLocalLikes(listEl, visibleBooks, lang).catch(() => {});
  };
  pagerTop = createPagerControls(listEl, lang, onPagerAction, "before");
  pagerBottom = createPagerControls(listEl, lang, onPagerAction, "after");
  rerender();
}

main().catch((err) => {
  console.error(err);
  const listEl = document.getElementById("all-books-list");
  const lang = getPageLang();
  if (listEl) {
    listEl.innerHTML = `<p class="photo-card__error">${t("library_list_error", lang)}</p>`;
  }
});
