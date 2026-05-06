import {
  applyThemeAriaFromLang,
  getPageLang,
  t,
  withLangQuery,
} from "./i18n.js";
import { trackPageView } from "./visitor-tracker.js";

const LIBRARY_JSON = "./info/library.json";
const BOOK_SERIES_JSON = "./info/book_series.json";
const LOCAL_LIKES_CACHE_PREFIX = "review_local_likes_count_";

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
      _reviewDate: parseDate(b.reviewDate),
      rating: Number.isFinite(Number(b.rating)) ? Number(b.rating) : 0,
      reviewLikes: Number.isFinite(Number(b.reviewLikes)) ? Number(b.reviewLikes) : 0,
    }));
}

function computeYearlyReads(books) {
  const byYear = new Map();
  for (const b of books) {
    const y = b._date?.getFullYear();
    if (!y || y < 2019) continue;
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

function parseReviewIdFromUrl(reviewUrl) {
  const match = String(reviewUrl || "").match(/\/review\/show\/(\d+)/);
  return match ? match[1] : "";
}

function reviewActionLabel(item, lang) {
  const n = Number(item?.reviewCount);
  if (Number.isFinite(n) && n < 100) {
    return t("library_view_minireview", lang);
  }
  return t("library_view_review", lang);
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
  const bookByReviewId = new Map();
  for (const item of items) {
    const reviewId = parseReviewIdFromUrl(item?.reviewUrl);
    if (reviewId) bookByReviewId.set(reviewId, item);
  }

  // Quick paint from snapshot/cache (may be stale until worker responds).
  for (const reviewId of reviewIds) {
    const fromSnapshot = readSnapshotLocalLikes(bookByReviewId.get(reviewId));
    const cached = readCachedLocalLikes(reviewId);
    const known = pickBestKnownLocalLikes(fromSnapshot, cached);
    if (known !== null) counts.set(reviewId, known);
  }
  renderLocalLikesInContainer(container, counts, lang);

  // Always refresh from worker so 👏 matches individual review pages (review-page.js).
  await mapWithConcurrency(reviewIds, async (reviewId) => {
    const fetched = await fetchLocalLikeCount(base, reviewId);
    if (fetched !== null) {
      counts.set(reviewId, fetched);
      writeCachedLocalLikes(reviewId, fetched);
      return;
    }
    const fromSnapshot = readSnapshotLocalLikes(bookByReviewId.get(reviewId));
    const cached = readCachedLocalLikes(reviewId);
    const known = pickBestKnownLocalLikes(fromSnapshot, cached);
    if (known !== null) counts.set(reviewId, known);
  }, 8);

  renderLocalLikesInContainer(container, counts, lang);
}

async function hydrateTotalLocalLikes(totalEl, reviewedItems) {
  if (!totalEl || !Array.isArray(reviewedItems)) return;
  const base = workerBaseFromLogEndpoint();
  if (!base) return;
  const reviewIds = [...new Set(reviewedItems.map((x) => parseReviewIdFromUrl(x?.reviewUrl)).filter(Boolean))];
  if (reviewIds.length === 0) {
    totalEl.textContent = "0";
    return;
  }
  let total = 0;
  await mapWithConcurrency(reviewIds, async (reviewId) => {
    const item = reviewedItems.find((x) => parseReviewIdFromUrl(x?.reviewUrl) === reviewId);
    let count = await fetchLocalLikeCount(base, reviewId);
    if (count !== null) {
      writeCachedLocalLikes(reviewId, count);
    } else {
      const fromSnapshot = readSnapshotLocalLikes(item);
      const fromCache = readCachedLocalLikes(reviewId);
      count = pickBestKnownLocalLikes(fromSnapshot, fromCache);
    }
    if (count !== null) total += count;
  }, 8);
  totalEl.textContent = String(total);
}

function renderBookList(container, items, lang, seriesMap = new Map(), options = {}) {
  const dateLabelKey = String(options.dateLabelKey || "library_date_read");
  const dateValueSelector = typeof options.dateValueSelector === "function"
    ? options.dateValueSelector
    : ((item) => item.dateRead || item.dateAdded || "");
  if (!container) return;
  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = `<p class="photo-card__error">${escapeLibrary(t("library_no_data", lang))}</p>`;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const item of items) {
    const entry = document.createElement("article");
    entry.className = "library-book-item library-book-item--with-cover";

    const contentDiv = document.createElement("div");
    contentDiv.className = "library-book-item__content";

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

    const datePart = String(dateValueSelector(item) || "").trim();
    if (datePart && datePart !== "—") {
      meta2Parts.push(`<strong>${escapeLibrary(t(dateLabelKey, lang))}</strong> ${escapeLibrary(datePart)}`);
    }

    if (meta2Parts.length > 0) {
      meta2.innerHTML = meta2Parts.join(" · ");
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
      actionsHtml += `<a class="link" href="${escapeLibrary(localReviewUrl)}">${escapeLibrary(reviewActionLabel(item, lang))}</a>`;
    } else if (hasReviewUrl) {
      actionsHtml += `<a class="link" href="${escapeLibrary(reviewUrl)}" target="_blank" rel="noopener noreferrer">${escapeLibrary(reviewActionLabel(item, lang))}</a>`;
    }
    
    if (actionsHtml) {
      const reactionsText = lang === "en" ? "Reactions" : "Reacciones a la reseña";
      const likesCount = Number.isFinite(Number(item.reviewLikes)) ? item.reviewLikes : 0;
      actionsHtml += ` · ${reactionsText} <span class="library-tooltip" data-title="${escapeLibrary(t("library_likes_gr_hover", lang))}">👍 ${likesCount}</span>${localLikesSuffixHtml(reviewId, lang)}`;
      actions.innerHTML = actionsHtml;
      actions.setAttribute("aria-label", t("library_review_links", lang));
    }

    contentDiv.appendChild(title);
    contentDiv.appendChild(meta1);
    if (meta2Parts.length > 0) contentDiv.appendChild(meta2);
    contentDiv.appendChild(meta3);
    if (actionsHtml) contentDiv.appendChild(actions);

    const coverWrapper = document.createElement("div");
    coverWrapper.className = "library-book-item__cover";
    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = `Portada de ${item.title}`;
    
    const candidates = [];
    if (item.reviewLocalCoverUrl) candidates.push(item.reviewLocalCoverUrl);
    
    const isbnStr = String(item.isbn || item.ISBN || "").replace(/[^0-9Xx]/g, "").toUpperCase();
    if (isbnStr) {
      candidates.push(`./antilibrary/covers/${isbnStr}.png`);
      candidates.push(`./antilibrary/covers/${isbnStr}.jpg`);
      candidates.push(`./antilibrary/covers/${isbnStr}.webp`);
      candidates.push(`./antilibrary/covers/${isbnStr}.jpeg`);
    }

    img.dataset.candidates = JSON.stringify(candidates);
    img.dataset.candidateIdx = "0";
    
    img.onerror = function() {
      const list = JSON.parse(this.dataset.candidates || "[]");
      const idx = parseInt(this.dataset.candidateIdx, 10) + 1;
      if (idx < list.length) {
        this.dataset.candidateIdx = idx;
        this.src = list[idx];
      } else {
        this.onerror = null;
        this.src = "./assets/images/dummy-cover.svg";
      }
    };

    if (candidates.length > 0) {
      img.src = candidates[0];
    } else {
      img.src = "./assets/images/dummy-cover.svg";
    }
    coverWrapper.appendChild(img);

    entry.appendChild(coverWrapper);
    entry.appendChild(contentDiv);
    frag.appendChild(entry);
  }
  container.replaceChildren(frag);
}

function addListToggleControls(
  container,
  items,
  lang,
  seriesMap,
  {
    initialCount = 5,
    // Omit expandedCount in callers → cap = full `items` list (null must not become 0).
    expandedCount: expandedCountOpt,
    showMoreKey = "library_show_latest_20",
    showLessKey = "library_show_latest_5",
    includeAllBooksLink = true,
    renderOptions = {},
  } = {},
) {
  if (!container || !Array.isArray(items) || items.length === 0) return;
  const expandedCap =
    expandedCountOpt != null && Number.isFinite(Number(expandedCountOpt))
      ? Math.max(initialCount, Number(expandedCountOpt))
      : items.length;
  const initialItems = items.slice(0, initialCount);
  const expandedItems = items.slice(0, expandedCap);
  let showingAll = false;

  renderBookList(container, initialItems, lang, seriesMap, renderOptions);
  hydrateLocalLikes(container, initialItems, lang).catch(() => {});

  const toggleContainer = document.createElement("div");
  toggleContainer.className = "library-all-link-wrap";
  toggleContainer.style.marginTop = "1rem";
  toggleContainer.style.display = "flex";
  toggleContainer.style.gap = "1rem";
  toggleContainer.style.justifyContent = "center";
  toggleContainer.style.flexWrap = "wrap";

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "link library-all-link";
  toggleBtn.textContent = t(showMoreKey, lang);

  toggleBtn.addEventListener("click", () => {
    showingAll = !showingAll;
    const visibleItems = showingAll ? expandedItems : initialItems;
    renderBookList(container, visibleItems, lang, seriesMap, renderOptions);
    hydrateLocalLikes(container, visibleItems, lang).catch(() => {});
    toggleBtn.textContent = showingAll ? t(showLessKey, lang) : t(showMoreKey, lang);
  });

  toggleContainer.appendChild(toggleBtn);
  if (includeAllBooksLink) {
    const allBooksLink = document.createElement("a");
    allBooksLink.className = "link library-all-link";
    allBooksLink.href = withLangQuery("./biblioteca-todos.html");
    allBooksLink.textContent = t("library_view_all_books", lang);
    toggleContainer.appendChild(allBooksLink);
  }
  container.parentElement?.appendChild(toggleContainer);
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
  if (hLatest) hLatest.textContent = t("library_latest", lang);
  const hTop = document.getElementById("library-h2-top");
  if (hTop) hTop.textContent = t("library_top10", lang);
  const hLatestReviews = document.getElementById("library-h2-latest-reviews");
  if (hLatestReviews) hLatestReviews.textContent = t("library_latest_reviews_written", lang);
  const hTop50 = document.getElementById("library-h2-top50");
  if (hTop50) hTop50.textContent = t("library_top50_title", lang);

  const allLink = document.getElementById("btn-all-books");
  if (allLink) {
    allLink.textContent = t("library_show_all", lang);
    allLink.setAttribute("href", withLangQuery("./biblioteca-todos.html"));
  }

  const antiLink = document.getElementById("btn-anti-library");
  if (antiLink) {
    antiLink.textContent = t("library_show_antilibrary", lang);
    antiLink.setAttribute("href", withLangQuery("./antibiblioteca.html"));
  }

  const sagasLink = document.getElementById("btn-all-sagas");
  if (sagasLink) {
    sagasLink.textContent = t("library_show_sagas", lang);
    sagasLink.setAttribute("href", withLangQuery("./biblioteca-series.html"));
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
  const goodreadsNoteEl = document.getElementById("library-goodreads-note");
  const profileEl = document.getElementById("goodreads-profile-link");
  const sourceEl = document.getElementById("library-source-note");
  const totalReadEl = document.getElementById("library-report-total-read");
  const totalReviewedEl = document.getElementById("library-report-reviewed");
  const totalLikesEl = document.getElementById("library-report-likes");
  const totalLocalLikesEl = document.getElementById("library-report-likes-local");
  const chartEl = document.getElementById("library-yearly-chart");
  const latestReadEl = document.getElementById("library-latest-read");
  const topReviewedEl = document.getElementById("library-top-reviewed");
  const latestReviewedEl = document.getElementById("library-latest-reviewed");
  const top50El = document.getElementById("library-top50");
  if (
    !titleEl ||
    !introEl ||
    !goodreadsNoteEl ||
    !profileEl ||
    !sourceEl ||
    !totalReadEl ||
    !totalReviewedEl ||
    !totalLikesEl ||
    !totalLocalLikesEl ||
    !chartEl ||
    !latestReadEl ||
    !topReviewedEl ||
    !latestReviewedEl ||
    !top50El
  ) {
    return;
  }

  const books = normalizeBooks(data.books);
  const readBooks = books.filter((b) => b._date);
  const rows = computeYearlyReads(readBooks);
  const latestRead = [...readBooks]
    .filter((b) => b._date)
    .sort((a, b) => b._date - a._date)
    .slice(0, 20);
  const reviewed = readBooks.filter((b) => hasReview(b));
  const topReviewedByLikes = [...reviewed]
    .sort((a, b) => {
      if (b.reviewLikes !== a.reviewLikes) return b.reviewLikes - a.reviewLikes;
      if (b.rating !== a.rating) return b.rating - a.rating;
      return (b._date?.getTime() ?? 0) - (a._date?.getTime() ?? 0);
    })
    .slice(0, 20);
  const latestReviewsWritten = [...reviewed]
    .filter((b) => b._reviewDate)
    .sort((a, b) => (b._reviewDate?.getTime() ?? 0) - (a._reviewDate?.getTime() ?? 0));

  const topFavorite = [...readBooks]
    .filter((b) => typeof b.drzrating === "number" && b.drzrating > 0)
    .sort((a, b) => {
      if (b.drzrating !== a.drzrating) return b.drzrating - a.drzrating;
      return (b._date?.getTime() ?? 0) - (a._date?.getTime() ?? 0);
    })
    .slice(0, 20);

  const totalRead = readBooks.length;
  const totalReviewed = reviewed.length;
  const reviewedPct = totalRead ? (totalReviewed / totalRead) * 100 : 0;
  const totalLikes = reviewed.reduce((acc, b) => acc + (b.reviewLikes || 0), 0);

  titleEl.textContent = t("library_title", lang);
  introEl.textContent = t("library_intro", lang);
  goodreadsNoteEl.textContent = t("library_goodreads_note", lang);
  profileEl.href = "https://www.goodreads.com/user/show/91991657";
  profileEl.textContent = t("library_profile", lang);
  sourceEl.textContent = "";
  totalReadEl.textContent = `${totalRead}`;
  totalReviewedEl.textContent = `${totalReviewed} (${reviewedPct.toFixed(1)}%)`;
  totalLikesEl.textContent = `${totalLikes}`;
  totalLocalLikesEl.textContent = "0";

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
  const label4 = document.querySelector(
    ".library-report__card:nth-of-type(4) .library-report__label",
  );
  if (label4) label4.textContent = t("library_likes_local_total", lang);

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

  const seriesMap = new Map();
  for (const series of seriesData.series || []) {
    for (const b of series.books || []) {
      if (b.libraryBookId) {
        seriesMap.set(String(b.libraryBookId), series.name);
      }
    }
  }

  chartEl.replaceChildren(frag);
  addListToggleControls(latestReadEl, latestRead, lang, seriesMap, {
    initialCount: 5,
    showMoreKey: "library_show_latest_20",
    showLessKey: "library_show_latest_5",
    includeAllBooksLink: true,
  });
  addListToggleControls(topReviewedEl, topReviewedByLikes, lang, seriesMap, {
    initialCount: 5,
    showMoreKey: "library_show_top_20",
    showLessKey: "library_show_latest_5",
    includeAllBooksLink: true,
  });
  addListToggleControls(latestReviewedEl, latestReviewsWritten, lang, seriesMap, {
    initialCount: 5,
    expandedCount: 20,
    showMoreKey: "library_show_latest_20",
    showLessKey: "library_show_latest_5",
    includeAllBooksLink: true,
    renderOptions: {
      dateLabelKey: "library_review_date",
      dateValueSelector: (item) => item.reviewDate || "",
    },
  });
  addListToggleControls(top50El, topFavorite, lang, seriesMap, {
    initialCount: 5,
    showMoreKey: "library_show_top_20",
    showLessKey: "library_show_latest_5",
    includeAllBooksLink: true,
  });
  hydrateTotalLocalLikes(totalLocalLikesEl, reviewed).catch(() => {});
}

main().catch((err) => {
  console.error(err);
  const chartEl = document.getElementById("library-yearly-chart");
  const lang = getPageLang();
  if (chartEl) {
    chartEl.innerHTML = `<p class="photo-card__error">${t("library_stats_error", lang)}</p>`;
  }
});
