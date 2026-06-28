import {
  getPageLang,
  t,
  withLangQuery,
  applyThemeAriaFromLang,
} from "./i18n.js";
import { applyHeaderLangChrome, applyLibrarySectionNav } from "./library-nav.js";
import { trackPageView } from "./visitor-tracker.js";

const DUMMY_COVER = "./assets/images/dummy-cover.jpeg";
const LOCAL_LIKES_CACHE_PREFIX = "review_local_likes_count_";
const COVER_STRIP_WIDTH_PX = 65;

const coverStripData = new WeakMap();
let coverStripResizeObserver = null;

function maxCoversPerRow(containerWidth, coverStripStep) {
  const width = Math.max(0, containerWidth - 2);
  if (width <= COVER_STRIP_WIDTH_PX) return 1;
  const step = Number(coverStripStep);
  if (!Number.isFinite(step) || step <= 0) return 1;
  const count = Math.floor((width / COVER_STRIP_WIDTH_PX - 1) / step + 1);
  return Math.max(1, count);
}

function layoutCoverStripRows(wrapper, itemLinks, coverStripStep, containerWidth) {
  const maxPerRow = maxCoversPerRow(containerWidth, coverStripStep);
  const data = coverStripData.get(wrapper);
  if (data?.lastMaxPerRow === maxPerRow && wrapper.childElementCount > 0) return;
  if (data) data.lastMaxPerRow = maxPerRow;

  wrapper.replaceChildren();

  for (let start = 0; start < itemLinks.length; start += maxPerRow) {
    const strip = document.createElement("div");
    strip.className = "library-series-cover-strip";

    itemLinks.slice(start, start + maxPerRow).forEach((link, idx) => {
      link.style.zIndex = String(idx + 1);
      strip.appendChild(link);
    });

    wrapper.appendChild(strip);
  }
}

function relayoutCoverStrip(wrapper) {
  const data = coverStripData.get(wrapper);
  if (!data) return;
  layoutCoverStripRows(
    wrapper,
    data.itemLinks,
    data.coverStripStep,
    wrapper.clientWidth,
  );
}

function ensureCoverStripResizeObserver() {
  if (coverStripResizeObserver) return coverStripResizeObserver;

  coverStripResizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      relayoutCoverStrip(entry.target);
    }
  });
  return coverStripResizeObserver;
}

function registerCoverStrip(wrapper, itemLinks, coverStripStep, layoutWidth) {
  coverStripData.set(wrapper, { itemLinks, coverStripStep });
  layoutCoverStripRows(wrapper, itemLinks, coverStripStep, layoutWidth);
  ensureCoverStripResizeObserver().observe(wrapper);
}

function relayoutCoverStripsIn(container) {
  if (!container) return;
  container.querySelectorAll(".library-series-cover-strips").forEach(relayoutCoverStrip);
}

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

function parseReviewIdFromUrl(reviewUrl) {
  const match = String(reviewUrl || "").match(/\/review\/show\/(\d+)/);
  return match ? match[1] : "";
}

function effectiveLocalReviewHref(book) {
  const explicit = String(book?.reviewLocalUrl || "").trim();
  if (explicit.endsWith(".html")) return explicit;
  const id = parseReviewIdFromUrl(book?.reviewUrl);
  if (!id) return "";
  return `./reviews/${id}.html`;
}

function pushReviewMirrorCoverCandidates(candidates, reviewUrl) {
  const id = parseReviewIdFromUrl(reviewUrl);
  if (!id) return;
  candidates.push(`./reviews/covers/${id}.jpg`);
  candidates.push(`./reviews/covers/${id}.jpeg`);
  candidates.push(`./reviews/covers/${id}.png`);
  candidates.push(`./reviews/covers/${id}.webp`);
}

function buildCoverCandidates(book) {
  const candidates = [];
  const localCover = String(book?.reviewLocalCoverUrl || "").trim();
  if (localCover) candidates.push(localCover);
  pushReviewMirrorCoverCandidates(candidates, book?.reviewUrl);
  return candidates;
}

function attachCoverImage(img, candidates) {
  let index = 0;
  const tryNext = () => {
    if (index < candidates.length) {
      img.src = candidates[index];
      index += 1;
    } else {
      img.onerror = null;
      img.src = DUMMY_COVER;
    }
  };
  img.onerror = tryNext;
  tryNext();
}

function createCoverStripLink(item) {
  const link = document.createElement("a");
  link.className = "library-series-cover-strip__item";
  link.href = withLangQuery(item.localReviewHref);
  link.title = item.bookTitle;
  link.setAttribute("aria-label", item.bookTitle);

  const img = document.createElement("img");
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  attachCoverImage(img, buildCoverCandidates(item.matchedBook));

  link.appendChild(img);
  return link;
}

function renderSeriesCoverStrip(series, booksById, { coverStripStep = 0.7, layoutWidth = 0 } = {}) {
  const coverItems = [];
  for (const bookRef of series.books || []) {
    const bookId = String(bookRef.libraryBookId || "");
    const matchedBook = booksById.get(bookId);
    const localReviewHref = matchedBook ? effectiveLocalReviewHref(matchedBook) : "";
    if (!localReviewHref) continue;
    coverItems.push({
      bookRef,
      matchedBook,
      localReviewHref,
      bookTitle: String(bookRef.title || matchedBook?.title || "Libro"),
    });
  }
  if (coverItems.length === 0) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "library-series-cover-strips";
  wrapper.style.setProperty("--cover-strip-step", String(coverStripStep));
  wrapper.setAttribute("aria-label", series.name || "Saga");

  const itemLinks = coverItems.map(createCoverStripLink);
  const effectiveWidth =
    layoutWidth > 0
      ? layoutWidth
      : Math.max(280, document.documentElement.clientWidth - 48);
  registerCoverStrip(wrapper, itemLinks, coverStripStep, effectiveWidth);

  return wrapper;
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

function readSnapshotLocalLikes(book) {
  const value = Number(book?.reviewLocalLikes);
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

function renderLocalLikesInContainer(container, map) {
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

async function hydrateLocalLikes(container, items) {
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

  for (const reviewId of reviewIds) {
    const fromSnapshot = readSnapshotLocalLikes(bookByReviewId.get(reviewId));
    const cached = readCachedLocalLikes(reviewId);
    const known = pickBestKnownLocalLikes(fromSnapshot, cached);
    if (known !== null) counts.set(reviewId, known);
  }
  renderLocalLikesInContainer(container, counts);

  const needsFetch = reviewIds.filter((reviewId) => {
    const fromSnapshot = readSnapshotLocalLikes(bookByReviewId.get(reviewId));
    const cached = readCachedLocalLikes(reviewId);
    return pickBestKnownLocalLikes(fromSnapshot, cached) === null;
  });
  if (needsFetch.length === 0) return;

  await mapWithConcurrency(needsFetch, async (reviewId) => {
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

  renderLocalLikesInContainer(container, counts);
}

function bookHasReviewLink(book) {
  return Boolean(effectiveLocalReviewHref(book))
    || String(book?.reviewUrl || "").includes("/review/show/");
}

function formatRating(rating, lang) {
  const value = Number(rating);
  if (!value) return escapeHtml(t("library_no_rating", lang));
  const stars = Math.round(value);
  return "⭐".repeat(stars) + '<span style="filter: grayscale(100%); opacity: 0.4;">⭐</span>'.repeat(5 - stars);
}

function buildBookStarsHtml(book, lang) {
  if (!book) return "";
  return `<span class="library-tooltip" data-title="${escapeHtml(t("library_rating_gr_hover", lang))}">${formatRating(book.rating, lang)}</span>`;
}

function buildBookReactionsHtml(book, lang) {
  if (!book || !bookHasReviewLink(book)) return "";
  const parts = [];
  const likesCount = Number.isFinite(Number(book.reviewLikes)) ? Number(book.reviewLikes) : 0;
  parts.push(
    `<span class="library-tooltip" data-title="${escapeHtml(t("library_likes_gr_hover", lang))}">👍 ${escapeHtml(String(likesCount))}</span>`,
  );
  const reviewId = parseReviewIdFromUrl(book.reviewUrl);
  if (reviewId) {
    const localCount = readSnapshotLocalLikes(book);
    const localDisplay = localCount === null ? "—" : String(localCount);
    parts.push(
      `<span class="library-tooltip" data-title="${escapeHtml(t("library_likes_local_hover", lang))}" data-local-likes-for="${escapeHtml(reviewId)}">👏 ${escapeHtml(localDisplay)}</span>`,
    );
  }
  return parts.join(" · ");
}

function resolveSeriesType(series) {
  const type = String(series?.type || "").trim().toLowerCase();
  if (type === "saga") return "saga";
  if (type === "author") return "author";
  return "collection";
}

function prepareSeriesItems(seriesData, booksById) {
  return (seriesData.series || [])
    .map((series) => ({
      ...series,
      type: resolveSeriesType(series),
      books: (series.books || []).filter((bookRef) => {
        const id = String(bookRef?.libraryBookId || "");
        return id && booksById.has(id);
      }),
    }))
    .filter((series) => Array.isArray(series.books) && series.books.length > 0);
}

function renderSeriesList(
  container,
  seriesItems,
  booksById,
  lang,
  { showCoverStrip = false, coverStripStep = 0.7 } = {},
) {
  if (!container) return;
  if (!Array.isArray(seriesItems) || seriesItems.length === 0) {
    container.replaceChildren();
    return;
  }

  const frag = document.createDocumentFragment();
  const booksForLikes = [];

  for (const series of seriesItems) {
    const entry = document.createElement("article");
    entry.className = "library-book-item";
    const anchor = String(series.anchor || "").trim();
    if (anchor) entry.id = `library-series-${anchor}`;

    const title = document.createElement("h3");
    title.className = "library-book-item__title";
    title.textContent = series.name || "Saga";

    entry.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "library-book-item__meta";
    meta.textContent = series.author || "—";
    entry.appendChild(meta);

    if (showCoverStrip) {
      const coverStrip = renderSeriesCoverStrip(series, booksById, {
        coverStripStep,
        layoutWidth: container.clientWidth,
      });
      if (coverStrip) entry.appendChild(coverStrip);
    }

    const list = document.createElement("ul");
    list.className = "library-book-item__series";

    for (const bookRef of series.books || []) {
      const li = document.createElement("li");
      const bookId = String(bookRef.libraryBookId || "");
      const matchedBook = booksById.get(bookId);
      const bookTitle = String(bookRef.title || matchedBook?.title || "Libro");
      const localReviewHref = matchedBook
        ? effectiveLocalReviewHref(matchedBook)
        : "";

      const titleSpan = document.createElement("span");
      titleSpan.className = "library-series-book-title";
      titleSpan.textContent = bookTitle;
      li.appendChild(titleSpan);

      const metaLine = document.createElement("p");
      metaLine.className = "library-series-book-meta";

      const starsHtml = buildBookStarsHtml(matchedBook, lang);
      if (starsHtml) {
        const stars = document.createElement("span");
        stars.innerHTML = starsHtml;
        metaLine.appendChild(stars);
      }

      const reactionsHtml = buildBookReactionsHtml(matchedBook, lang);
      if (localReviewHref) {
        if (metaLine.childElementCount > 0) {
          metaLine.appendChild(document.createTextNode(" — "));
        }
        const localLink = document.createElement("a");
        localLink.className = "link";
        localLink.href = withLangQuery(localReviewHref);
        localLink.textContent = t("library_view_review_local", lang);
        metaLine.appendChild(localLink);
        if (reactionsHtml) {
          const reactions = document.createElement("span");
          reactions.className = "library-series-book-stats";
          reactions.innerHTML = ` — ${reactionsHtml}`;
          metaLine.appendChild(reactions);
          if (matchedBook && parseReviewIdFromUrl(matchedBook.reviewUrl)) {
            booksForLikes.push(matchedBook);
          }
        }
      }

      if (metaLine.childElementCount > 0 || metaLine.textContent.trim()) {
        li.appendChild(metaLine);
      }

      list.appendChild(li);
    }

    entry.appendChild(list);
    frag.appendChild(entry);
  }

  container.replaceChildren(frag);
  requestAnimationFrame(() => relayoutCoverStripsIn(container));
  hydrateLocalLikes(container, booksForLikes).catch(() => {});
}

const FEATURED_JUMP_LINKS = [
  ["library-series-jump-feat-novelas-biograficas", "novelas-biograficas", "library_series_featured_novelas_biograficas"],
  ["library-series-jump-feat-garcia-marquez", "garcia-marquez", "library_series_featured_garcia_marquez"],
  ["library-series-jump-feat-mary-beard", "mary-beard", "library_series_featured_mary_beard"],
  ["library-series-jump-feat-jose-saramago", "jose-saramago", "library_series_featured_jose_saramago"],
  ["library-series-jump-feat-maria-martin", "maria-martin", "library_series_featured_maria_martin"],
  ["library-series-jump-feat-tito-vivas", "tito-vivas", "library_series_featured_tito_vivas"],
  ["library-series-jump-feat-feminismos", "feminismos", "library_series_featured_feminismos"],
];

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

  const jumpNav = document.getElementById("library-series-jump-nav");
  if (jumpNav) jumpNav.setAttribute("aria-label", t("library_series_jump_nav_aria", lang));

  const jumpLinks = [
    ["library-series-jump-sagas", "library_sagas_section_title"],
    ["library-series-jump-authors", "library_authors_section_title"],
    ["library-series-jump-collections", "library_collections_section_title"],
  ];
  for (const [linkId, titleKey] of jumpLinks) {
    const linkEl = document.getElementById(linkId);
    if (linkEl) linkEl.textContent = t(titleKey, lang);
  }

  const featuredLabel = document.getElementById("library-series-jump-featured-label");
  if (featuredLabel) featuredLabel.textContent = t("library_series_jump_featured_label", lang);

  for (const [linkId, anchor, titleKey] of FEATURED_JUMP_LINKS) {
    const linkEl = document.getElementById(linkId);
    if (!linkEl) continue;
    linkEl.textContent = t(titleKey, lang);
    linkEl.setAttribute("href", `#library-series-${anchor}`);
  }

  const sectionCopy = [
    ["library-h2-sagas", "library-sagas-section-intro", "library_sagas_section_title", "library_sagas_section_intro"],
    ["library-h2-authors", "library-authors-section-intro", "library_authors_section_title", "library_authors_section_intro"],
    [
      "library-h2-collections",
      "library-collections-section-intro",
      "library_collections_section_title",
      "library_collections_section_intro",
    ],
  ];
  for (const [headingId, introId, titleKey, introKey] of sectionCopy) {
    const headingEl = document.getElementById(headingId);
    if (headingEl) headingEl.textContent = t(titleKey, lang);
    const sectionIntroEl = document.getElementById(introId);
    if (sectionIntroEl) sectionIntroEl.textContent = t(introKey, lang);
  }

  const sectionsRoot = document.getElementById("library-series-sections");
  if (sectionsRoot) {
    sectionsRoot.setAttribute(
      "aria-label",
      lang === "en" ? "Sagas, authors, and collections" : "Sagas, autores y colecciones",
    );
  }

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

  const containers = {
    saga: document.getElementById("sagas-list"),
    collection: document.getElementById("collections-list"),
    author: document.getElementById("authors-list"),
  };
  for (const container of Object.values(containers)) {
    if (container) {
      container.innerHTML = `<p style="opacity: 0.7;">${lang === "en" ? "Loading…" : "Cargando…"}</p>`;
    }
  }

  try {
    const [libData, seriesData] = await getLibraryData();
    const books = Array.isArray(libData?.books) ? libData.books : [];
    const booksById = new Map(books.map((b) => [String(b.bookId || ""), b]));

    const seriesWithMatches = prepareSeriesItems(seriesData, booksById);
    const grouped = {
      saga: seriesWithMatches.filter((series) => series.type === "saga"),
      collection: seriesWithMatches.filter((series) => series.type === "collection"),
      author: seriesWithMatches.filter((series) => series.type === "author"),
    };

    renderSeriesList(containers.saga, grouped.saga, booksById, lang, {
      showCoverStrip: true,
      coverStripStep: 0.7,
    });
    renderSeriesList(containers.collection, grouped.collection, booksById, lang, {
      showCoverStrip: true,
      coverStripStep: 0.6,
    });
    renderSeriesList(containers.author, grouped.author, booksById, lang, {
      showCoverStrip: true,
      coverStripStep: 0.6,
    });
  } catch (err) {
    console.error("Error cargando sagas:", err);
    const errorHtml = `<p class="error">${t("library_list_error", lang)}</p>`;
    for (const container of Object.values(containers)) {
      if (container) container.innerHTML = errorHtml;
    }
  }
}

document.addEventListener("DOMContentLoaded", initSagasPage);
