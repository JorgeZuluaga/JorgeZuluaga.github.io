import {
  applyThemeAriaFromLang,
  getPageLang,
  t,
  withLangQuery,
} from "./i18n.js";
import { applyHeaderLangChrome, applyLibrarySectionNav } from "./library-nav.js";
import { trackPageView } from "./visitor-tracker.js";

const LIBRARY_JSON = "./info/library.json";
const LIBRARY_DETAILS_JSON = "./info/library-details.json";
const LOCAL_LIKES_CACHE_PREFIX = "review_local_likes_count_";
const LOCAL_STORAGE_KEY_PREFIX = "anti_book_id_";
const DEFAULT_PAGE_SIZE = 50;
const DEWEY_GENERAL_CODES = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900];

function isLibraryDuplicateHidden(item) {
  const v = item?.libraryDuplicateHidden;
  return v === true || v === 1 || v === "1";
}

function deweyAreaName(code, lang) {
  const labelsEs = {
    0: "Generalidades",
    100: "Filosofia y psicologia",
    200: "Religion",
    300: "Ciencias sociales",
    400: "Lenguas",
    500: "Ciencias naturales y matematicas",
    600: "Tecnologia",
    700: "Artes y recreacion",
    800: "Literatura",
    900: "Historia y geografia",
  };
  const labelsEn = {
    0: "General works",
    100: "Philosophy and psychology",
    200: "Religion",
    300: "Social sciences",
    400: "Language",
    500: "Science",
    600: "Technology",
    700: "Arts and recreation",
    800: "Literature",
    900: "History and geography",
  };
  const labels = lang === "en" ? labelsEn : labelsEs;
  return labels[code] ?? String(code).padStart(3, "0");
}

function parseDeweyGeneralCode(rawCode) {
  const raw = String(rawCode ?? "").trim();
  if (!raw) return null;
  const digits = raw.match(/\d{1,3}/);
  if (!digits) return null;
  const n = Number.parseInt(digits[0], 10);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 999) return null;
  return Math.floor(n / 100) * 100;
}

function extractBookPrimaryDeweyGeneralCode(book) {
  const classes = book?.dcc_classes;
  if (classes && typeof classes === "object") {
    for (const key of Object.keys(classes)) {
      const code = parseDeweyGeneralCode(key);
      if (code !== null) return code;
    }
  }
  const codes = book?.dcc_codes;
  if (codes && typeof codes === "object") {
    for (const key of Object.keys(codes)) {
      const code = parseDeweyGeneralCode(key);
      if (code !== null) return code;
    }
  }
  const ddcCode = parseDeweyGeneralCode(book?.ddc);
  if (ddcCode !== null) return ddcCode;
  return null;
}

function getPrimaryDccCodeEntry(book) {
  const codes = book?.dcc_codes;
  if (!codes || typeof codes !== "object") {
    return { code: "", topic: "" };
  }
  const primaryGen = extractBookPrimaryDeweyGeneralCode(book);
  const entries = Object.entries(codes)
    .map(([k, v]) => ({
      code: String(k).trim(),
      topic: String(v ?? "").trim(),
      gen: parseDeweyGeneralCode(k),
    }))
    .filter((e) => e.topic && e.code);

  if (!entries.length) {
    return { code: "", topic: "" };
  }

  if (primaryGen !== null) {
    const match = entries.filter((e) => e.gen === primaryGen);
    if (match.length) {
      match.sort((a, b) => Number(a.code) - Number(b.code));
      return match[0];
    }
  }
  entries.sort((a, b) => Number(a.code) - Number(b.code));
  return entries[0];
}

function escapeLibrary(s) {
  return (s ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatBookAreaMetaHtml(book, lang) {
  const label = escapeLibrary(t("library_area_label", lang));
  const primaryGen = extractBookPrimaryDeweyGeneralCode(book);
  if (primaryGen === null) {
    const fb = escapeLibrary(t("library_area_unclassified", lang));
    return `<strong>${label}</strong> ${fb}`;
  }
  const mainClass = escapeLibrary(deweyAreaName(primaryGen, lang));
  const entry = getPrimaryDccCodeEntry(book);
  if (entry.topic) {
    return `<strong>${label}</strong> ${mainClass} / ${escapeLibrary(entry.topic)}`;
  }
  const key = String(primaryGen);
  const cls = book?.dcc_classes?.[key];
  if (cls) {
    const stripped = String(cls).replace(/\s*\(\d+\)\s*$/, "").trim();
    return `<strong>${label}</strong> ${escapeLibrary(stripped)}`;
  }
  return `<strong>${label}</strong> ${mainClass}`;
}

function computeDeweyGeneralCounts(books) {
  const counts = new Map(DEWEY_GENERAL_CODES.map((code) => [code, 0]));
  let unclassifiedCount = 0;

  for (const book of books) {
    const primaryClass = extractBookPrimaryDeweyGeneralCode(book);
    if (primaryClass === null) {
      unclassifiedCount += 1;
      continue;
    }
    if (!counts.has(primaryClass)) continue;
    counts.set(primaryClass, (counts.get(primaryClass) ?? 0) + 1);
  }

  const areaRows = DEWEY_GENERAL_CODES.map((code) => ({
    kind: "area",
    code,
    count: counts.get(code) ?? 0,
  }));

  return { areaRows, unclassifiedCount };
}

/** Dewey 500 (natural sciences / mathematics): first in charts and lists; then descending count. */
const DEWEY_SCIENCE_AREA_CODE = 500;

function orderDeweyChartRowsFromCounts(areaRows, unclassifiedCount) {
  const science = areaRows.find((r) => r.code === DEWEY_SCIENCE_AREA_CODE);
  const rest = areaRows
    .filter((r) => r.code !== DEWEY_SCIENCE_AREA_CODE)
    .sort((a, b) => (b.count - a.count) || (a.code - b.code));
  const head = science ? [science, ...rest] : rest;
  return [...head, { kind: "unclassified", code: null, count: unclassifiedCount }];
}

function orderDeweyFilterOptionRows(areaRows) {
  const withCount = areaRows.filter((r) => r.count > 0);
  const science = withCount.find((r) => r.code === DEWEY_SCIENCE_AREA_CODE);
  const rest = withCount
    .filter((r) => r.code !== DEWEY_SCIENCE_AREA_CODE)
    .sort((a, b) => (b.count - a.count) || (a.code - b.code));
  return science ? [science, ...rest] : rest;
}

function orderDeweyBucketsForListSort(areaRows, unclassifiedCount) {
  const areaBuckets = areaRows
    .filter((r) => r.count > 0)
    .map((r) => ({ kind: "area", code: r.code, count: r.count }));
  const science = areaBuckets.find((b) => b.code === DEWEY_SCIENCE_AREA_CODE);
  const rest = areaBuckets
    .filter((b) => b.code !== DEWEY_SCIENCE_AREA_CODE)
    .sort((a, b) => (b.count - a.count) || ((a.code ?? -1) - (b.code ?? -1)));
  const orderedAreas = science ? [science, ...rest] : rest;
  const tail = unclassifiedCount > 0
    ? [{ kind: "unclassified", code: null, count: unclassifiedCount }]
    : [];
  return [...orderedAreas, ...tail];
}

function sortCombinedRows(readList, unreadList) {
  const rows = [
    ...readList.map((book) => ({ kind: "read", book, dateMs: book._date?.getTime() ?? 0 })),
    ...unreadList.map((book) => ({
      kind: "unread",
      book,
      dateMs: book._dateAdded?.getTime() ?? 0,
    })),
  ];
  const booksOnly = rows.map((r) => r.book);
  const { areaRows, unclassifiedCount } = computeDeweyGeneralCounts(booksOnly);
  const buckets = orderDeweyBucketsForListSort(areaRows, unclassifiedCount);

  const rankByBucket = new Map();
  buckets.forEach((row, idx) => {
    const key = row.kind === "unclassified" ? "__none__" : String(row.code);
    rankByBucket.set(key, idx);
  });

  function bucketRank(book) {
    const p = extractBookPrimaryDeweyGeneralCode(book);
    const key = p === null ? "__none__" : String(p);
    return rankByBucket.get(key) ?? 99999;
  }

  return [...rows].sort((a, b) => {
    const ra = bucketRank(a.book);
    const rb = bucketRank(b.book);
    if (ra !== rb) return ra - rb;
    return b.dateMs - a.dateMs;
  });
}

function renderDeweyChart(chartEl, books, lang) {
  if (!chartEl) return;

  const { areaRows, unclassifiedCount } = computeDeweyGeneralCounts(books);
  const rows = orderDeweyChartRowsFromCounts(areaRows, unclassifiedCount);

  const maxCount = Math.max(...rows.map((r) => r.count), 1);
  const frag = document.createDocumentFragment();

  for (const row of rows) {
    const item = document.createElement("article");
    item.className = "library-chart__row";

    const area = document.createElement("div");
    area.className = "library-chart__year anti-dewey-chart__area";
    if (row.kind === "unclassified") {
      area.textContent = lang === "en" ? "Unclassified" : "No clasificados";
    } else {
      area.textContent = deweyAreaName(row.code, lang);
    }

    const barWrap = document.createElement("div");
    barWrap.className = "library-chart__bar-wrap anti-dewey-chart__bar-wrap";

    const bar = document.createElement("div");
    bar.className = "library-chart__bar";
    if (row.count <= 0) {
      bar.style.width = "0%";
      bar.style.minWidth = "0";
    } else {
      bar.style.width = `${Math.max((row.count / maxCount) * 100, 2)}%`;
    }

    const label = document.createElement("span");
    label.className = "library-chart__value";
    const bookWord = lang === "en" ? "books" : "libros";
    label.textContent = `${row.count} ${bookWord}`;

    barWrap.appendChild(bar);
    barWrap.appendChild(label);
    item.appendChild(area);
    item.appendChild(barWrap);
    frag.appendChild(item);
  }

  chartEl.replaceChildren(frag);
}

function getActiveClassFilter() {
  const param = new URLSearchParams(location.search).get("class");
  if (!param) return null;
  if (param === "unclassified") return "unclassified";
  const n = Number.parseInt(param, 10);
  return Number.isFinite(n) ? n : null;
}

function applyClassFilterRows(rows, filter) {
  if (filter === null) return rows;
  return rows.filter((r) => {
    const b = r.book;
    if (filter === "unclassified") return extractBookPrimaryDeweyGeneralCode(b) === null;
    return extractBookPrimaryDeweyGeneralCode(b) === filter;
  });
}

function renderDeweyFilter(selectEl, books, lang, onFilterChange) {
  if (!selectEl) return;
  const { areaRows, unclassifiedCount } = computeDeweyGeneralCounts(books);
  const activeFilter = getActiveClassFilter();
  const sortedAreas = orderDeweyFilterOptionRows(areaRows);

  const allLabel = lang === "en" ? "All areas" : "Todas las áreas";
  const unclassifiedLabel = lang === "en" ? "Unclassified" : "No clasificados";

  const frag = document.createDocumentFragment();

  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = allLabel;
  if (activeFilter === null) allOpt.selected = true;
  frag.appendChild(allOpt);

  for (const row of sortedAreas) {
    const opt = document.createElement("option");
    opt.value = String(row.code);
    opt.textContent = `${deweyAreaName(row.code, lang)} (${row.count})`;
    if (activeFilter === row.code) opt.selected = true;
    frag.appendChild(opt);
  }

  if (unclassifiedCount > 0) {
    const opt = document.createElement("option");
    opt.value = "unclassified";
    opt.textContent = `${unclassifiedLabel} (${unclassifiedCount})`;
    if (activeFilter === "unclassified") opt.selected = true;
    frag.appendChild(opt);
  }

  selectEl.replaceChildren(frag);
  selectEl.addEventListener("change", () => {
    const val = selectEl.value;
    const params = new URLSearchParams(location.search);
    if (val) {
      params.set("class", val);
    } else {
      params.delete("class");
    }
    const newSearch = params.toString() ? `?${params.toString()}` : "";
    history.replaceState(null, "", `${location.pathname}${newSearch}${location.hash}`);
    onFilterChange();
  });
}

function buildDetailsBookIdSet(detailsBooks) {
  const set = new Set();
  for (const row of detailsBooks || []) {
    const bid = String(row?.bookId || "").trim();
    if (bid) set.add(bid);
  }
  return set;
}

function buildDescriptionLinkHtml(item, lang, detailsBookIdSet) {
  const grBookId = String(item.bookId || "").trim();
  if (!grBookId) return "";
  const descHref = escapeLibrary(
    withLangQuery(`./book.html?bookid=${encodeURIComponent(grBookId)}`),
  );
  if (detailsBookIdSet?.has(grBookId)) {
    return `<a class="link" href="${descHref}">${escapeLibrary(t("library_view_description_complete", lang))}</a>`;
  }
  const before = escapeLibrary(t("library_view_description_incomplete_before", lang));
  const em = escapeLibrary(t("library_view_description_incomplete_em", lang));
  const after = escapeLibrary(t("library_view_description_incomplete_after", lang));
  return `<a class="link" href="${descHref}">${before}<u>${em}</u>${after}</a>`;
}

/** Same loose parsing as antibiblioteca (date added / date read). */
function parseDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`);
  const ymd = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (ymd) return new Date(`${ymd[1]}-${ymd[2]}-${ymd[3]}T00:00:00`);
  const ym = raw.match(/^(\d{4})\/(\d{2})$/);
  if (ym) return new Date(`${ym[1]}-${ym[2]}-01T00:00:00`);
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function normalizeBooks(rawBooks) {
  return [...(rawBooks ?? [])]
    .filter((b) => b && b.title)
    .map((b) => ({
      ...b,
      _dateRead: parseDate(b.dateRead),
      _dateAdded: parseDate(b.dateAdded),
      rating: Number.isFinite(Number(b.rating)) ? Number(b.rating) : 0,
    }));
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function titleCore(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const beforeColon = raw.split(":")[0] || raw;
  return normalizeText(beforeColon).replace(/[^a-z0-9]+/g, " ").trim();
}

function authorCore(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function bookIdentityKey(book) {
  return `${titleCore(book?.title)}|${authorCore(book?.author)}`;
}

function isReadBook(book) {
  if (book?._dateRead) return true;
  if (String(book?.reviewUrl || "").trim()) return true;
  if (book?.hasReview === true) return true;
  if (String(book?.reviewLocalUrl || "").trim()) return true;
  return false;
}

function buildLibraryBookIdMap(books) {
  const m = new Map();
  for (const b of books) {
    const id = String(b?.bookId || "").trim();
    if (id) m.set(id, b);
  }
  return m;
}

function statusIsUnreadRow(row) {
  const s = String(row?.Status ?? row?.status ?? "").trim().toLowerCase();
  return s === "unread";
}

function isDetailsRowCountedAsReadOnGoodreads(row, libraryByBookId, readIdentity) {
  const bid = String(row?.bookId ?? "").trim();
  if (bid) {
    const lb = libraryByBookId.get(bid);
    if (lb && isReadBook(lb)) return true;
  }
  const key = bookIdentityKey({
    title: row?.Title ?? row?.title,
    author: row?.Author ?? row?.author,
  });
  return Boolean(key && readIdentity.has(key));
}

function detailsRowToAntiBook(row) {
  const title = String(row?.Title ?? row?.title ?? "").trim();
  const author = String(row?.Author ?? row?.author ?? "").trim();
  const dateAdded = String(row?.["Date Added"] ?? row?.dateAdded ?? "").trim();
  const isbn = String(row?.ISBN ?? row?.isbn ?? "").trim();
  const bookId = String(row?.bookId ?? "").trim();
  const uploadedImageUrl = String(row?.["Uploaded Image URL"] ?? "").trim();
  const ddc = String(row?.DDC ?? row?.ddc ?? "").trim();
  const dcc_classes = row?.dcc_classes && typeof row.dcc_classes === "object"
    ? row.dcc_classes
    : {};
  const dcc_codes = row?.dcc_codes && typeof row.dcc_codes === "object"
    ? row.dcc_codes
    : {};
  return {
    title,
    author,
    dateAdded,
    isbn,
    ISBN: isbn,
    bookId,
    uploadedImageUrl,
    ddc,
    dcc_classes,
    dcc_codes,
    rating: 0,
    bookDetails: 1,
    _dateAdded: parseDate(dateAdded),
  };
}

function simpleHash(value) {
  let h = 2166136261 >>> 0;
  const s = String(value || "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function antiBookId(item) {
  const bid = String(item?.bookId || "").trim();
  if (bid) return `gr:${bid}`;
  const isbn = String(item?.isbn || item?.ISBN || "").replace(/[^0-9Xx]/g, "").toUpperCase();
  if (isbn) return `isbn:${isbn}`;
  const basis = [
    normalizeText(item?.title),
    normalizeText(item?.author),
    String(item?.dateAdded || "").trim(),
  ].join("|");
  return `anti:${simpleHash(basis)}`;
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

  for (const reviewId of reviewIds) {
    const fromSnapshot = readSnapshotLocalLikes(bookByReviewId.get(reviewId));
    const cached = readCachedLocalLikes(reviewId);
    const known = pickBestKnownLocalLikes(fromSnapshot, cached);
    if (known !== null) counts.set(reviewId, known);
  }
  renderLocalLikesInContainer(container, counts, lang);

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

async function hydrateGoodreadsStatsLocalTotal(totalEl, reviewedItems) {
  if (!totalEl || !Array.isArray(reviewedItems)) return;
  const base = workerBaseFromLogEndpoint();
  const reviewIds = [...new Set(reviewedItems.map((x) => parseReviewIdFromUrl(x?.reviewUrl)).filter(Boolean))];
  if (reviewIds.length === 0) {
    totalEl.textContent = "0";
    return;
  }
  if (!base) {
    let snap = 0;
    for (const b of reviewedItems) {
      const v = readSnapshotLocalLikes(b);
      if (v !== null) snap += v;
    }
    totalEl.textContent = String(snap);
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

function hasGoodreadsReviewUrl(item) {
  return String(item?.reviewUrl ?? "").includes("/review/show/");
}

function populateTodosGoodreadsStats(booksRead, catalogTotal) {
  const reviewed = booksRead.filter((b) => hasGoodreadsReviewUrl(b));
  const totalReviewed = reviewed.length;
  const pctBase = Number.isFinite(Number(catalogTotal)) && Number(catalogTotal) > 0
    ? Number(catalogTotal)
    : 0;
  const reviewedPct = pctBase ? (totalReviewed / pctBase) * 100 : 0;
  const totalLikes = reviewed.reduce(
    (acc, b) => acc + (Number.isFinite(Number(b.reviewLikes)) ? Number(b.reviewLikes) : 0),
    0,
  );

  const elRev = document.getElementById("lib-todos-gr-val-reviewed");
  const elLikes = document.getElementById("lib-todos-gr-val-likes-gr");
  const elLocal = document.getElementById("lib-todos-gr-val-likes-local");
  if (elRev) elRev.textContent = `${totalReviewed} (${reviewedPct.toFixed(1)}%)`;
  if (elLikes) elLikes.textContent = String(totalLikes);
  if (elLocal) elLocal.textContent = "0";
  hydrateGoodreadsStatsLocalTotal(elLocal, reviewed).catch(() => {});
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

function appendUnreadCard(frag, item, lang) {
  const entry = document.createElement("article");
  entry.className = "library-book-item library-book-item--with-cover";

  const contentDiv = document.createElement("div");
  contentDiv.className = "library-book-item__content";

  const title = document.createElement("h3");
  title.className = "library-book-item__title";
  title.textContent = item.title ?? t("library_book_title_fallback", lang);

  const meta1 = document.createElement("p");
  meta1.className = "library-book-item__meta";
  meta1.innerHTML = `<strong>${escapeLibrary(t("library_by_author", lang))}</strong> ${escapeLibrary(item.author || "—")}`;

  const meta2 = document.createElement("p");
  meta2.className = "library-book-item__meta";
  const added = item._dateAdded
    ? `${item._dateAdded.getFullYear()}/${String(item._dateAdded.getMonth() + 1).padStart(2, "0")}`
    : String(item.dateAdded || "").trim();
  meta2.innerHTML = `<strong>${escapeLibrary(t("library_date_added", lang))}</strong> ${escapeLibrary(added || "—")}`;

  const metaArea = document.createElement("p");
  metaArea.className = "library-book-item__meta";
  metaArea.innerHTML = formatBookAreaMetaHtml(item, lang);

  const actions = document.createElement("p");
  actions.className = "library-book-item__actions";
  const id = antiBookId(item);
  const descHref = withLangQuery(`./book.html?bookid=${encodeURIComponent(id)}`);
  actions.innerHTML =
    `<a class="link" href="${escapeLibrary(descHref)}">${escapeLibrary(t("library_view_description_complete", lang))}</a>` +
    ` · <i class="library-book-item__antilibrary-note">${escapeLibrary(t("antilibrary_review_unavailable", lang))}</i>`;
  try {
    localStorage.setItem(`${LOCAL_STORAGE_KEY_PREFIX}${id}`, JSON.stringify({
      title: item?.title || "",
      author: item?.author || "",
      dateAdded: item?.dateAdded || "",
    }));
  } catch {
    /* ignore */
  }

  contentDiv.appendChild(title);
  contentDiv.appendChild(meta1);
  contentDiv.appendChild(meta2);
  contentDiv.appendChild(metaArea);
  contentDiv.appendChild(actions);

  const coverWrapper = document.createElement("div");
  coverWrapper.className = "library-book-item__cover";
  const img = document.createElement("img");
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = `Portada de ${item.title}`;

  const candidates = [];
  if (item.reviewLocalCoverUrl) candidates.push(item.reviewLocalCoverUrl);
  if (item.uploadedImageUrl) candidates.push(item.uploadedImageUrl);

  const isbnStr = String(item.isbn || item.ISBN || "").replace(/[^0-9Xx]/g, "").toUpperCase();
  if (isbnStr) {
    candidates.push(`./antilibrary/covers/${isbnStr}.png`);
    candidates.push(`./antilibrary/covers/${isbnStr}.jpg`);
    candidates.push(`./antilibrary/covers/${isbnStr}.webp`);
    candidates.push(`./antilibrary/covers/${isbnStr}.jpeg`);
  } else {
    const hashBasis = [
      normalizeText(item.title),
      normalizeText(item.author),
      String(item.dateAdded || "").trim(),
    ].join("|");
    const rawHash = simpleHash(hashBasis);
    candidates.push(`./antilibrary/covers/noisbn-${rawHash}.png`);
    candidates.push(`./antilibrary/covers/noisbn-${rawHash}.jpg`);
    candidates.push(`./antilibrary/covers/noisbn-${rawHash}.webp`);
  }

  img.dataset.candidates = JSON.stringify(candidates);
  img.dataset.candidateIdx = "0";

  img.onerror = function () {
    const list = JSON.parse(this.dataset.candidates || "[]");
    const idx = parseInt(this.dataset.candidateIdx, 10) + 1;
    if (idx < list.length) {
      this.dataset.candidateIdx = idx;
      this.src = list[idx];
    } else {
      this.onerror = null;
      this.src = "./assets/images/dummy-cover.jpeg";
    }
  };

  if (candidates.length > 0) {
    img.src = candidates[0];
  } else {
    img.src = "./assets/images/dummy-cover.jpeg";
  }
  coverWrapper.appendChild(img);

  entry.appendChild(coverWrapper);
  entry.appendChild(contentDiv);
  frag.appendChild(entry);
}

function appendReadCard(frag, item, lang, seriesMap, detailsBookIdSet) {
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
  const meta2Parts = [];

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
    metaDate.innerHTML = `<strong>${escapeLibrary(t("library_date_read", lang))}</strong> ${escapeLibrary(datePart)}`;
  }

  const metaArea = document.createElement("p");
  metaArea.className = "library-book-item__meta";
  metaArea.innerHTML = formatBookAreaMetaHtml(item, lang);

  const meta3 = document.createElement("p");
  meta3.className = "library-book-item__meta";
  const meta3Parts = [];

  const ratingLabel = t("library_rating_label", lang);
  meta3Parts.push(`<strong>${escapeLibrary(ratingLabel)}</strong> <span class="library-tooltip" data-title="${escapeLibrary(t("library_rating_gr_hover", lang))}">${formatRating(item.rating, lang)}</span>`);

  if (item.drzrating !== undefined && item.drzrating !== -1) {
    const drzLabel = t("library_rating_drz", lang);
    meta3Parts.push(`<strong>${escapeLibrary(drzLabel)}</strong> <span class="library-tooltip" data-title="${escapeLibrary(t("library_rating_drz_hover", lang))}">🤓 ${escapeLibrary(String(item.drzrating))}</span>`);
  }

  meta3.innerHTML = meta3Parts.join(" · ");

  const reviewUrl = String(item.reviewUrl || "");
  const localReviewUrl = String(item.reviewLocalUrl || "");
  const hasReviewUrl = reviewUrl.includes("/review/show/");
  const hasLocalReview = localReviewUrl.endsWith(".html");
  const reviewId = parseReviewIdFromUrl(item.reviewUrl);

  const grBookId = String(item.bookId || "").trim();
  const hasReview = hasLocalReview || hasReviewUrl;

  const actionsDesc = document.createElement("p");
  actionsDesc.className = "library-book-item__actions";
  let descHtml = "";
  if (grBookId) {
    descHtml = buildDescriptionLinkHtml(item, lang, detailsBookIdSet);
  }
  if (descHtml) {
    actionsDesc.innerHTML = descHtml;
    actionsDesc.setAttribute("aria-label", t("library_view_description", lang));
  }

  let reviewHtml = "";
  if (hasLocalReview) {
    reviewHtml += `<a class="link" href="${escapeLibrary(localReviewUrl)}">${escapeLibrary(reviewActionLabel(item, lang))}</a>`;
  } else if (hasReviewUrl) {
    reviewHtml += `<a class="link" href="${escapeLibrary(reviewUrl)}" target="_blank" rel="noopener noreferrer">${escapeLibrary(reviewActionLabel(item, lang))}</a>`;
  }
  if (hasReview) {
    const reactionsText = lang === "en" ? "Reactions to the review" : "Reacciones a la reseña";
    const likesCount = Number.isFinite(Number(item.reviewLikes)) ? item.reviewLikes : 0;
    const reactionsPart = `${reactionsText} <span class="library-tooltip" data-title="${escapeLibrary(t("library_likes_gr_hover", lang))}">👍 ${likesCount}</span>${localLikesSuffixHtml(reviewId, lang)}`;
    if (reviewHtml) reviewHtml += ` · ${reactionsPart}`;
    else reviewHtml = reactionsPart;
  }

  const actionsReview = document.createElement("p");
  actionsReview.className = "library-book-item__actions";
  if (reviewHtml) {
    actionsReview.innerHTML = reviewHtml;
    actionsReview.setAttribute("aria-label", t("library_review_links", lang));
  }

  contentDiv.appendChild(title);
  contentDiv.appendChild(meta1);
  if (meta2Parts.length > 0) contentDiv.appendChild(meta2);
  if (datePart && datePart !== "—") contentDiv.appendChild(metaDate);
  contentDiv.appendChild(metaArea);
  if (descHtml) contentDiv.appendChild(actionsDesc);
  contentDiv.appendChild(meta3);
  if (reviewHtml) contentDiv.appendChild(actionsReview);

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

  img.onerror = function () {
    const list = JSON.parse(this.dataset.candidates || "[]");
    const idx = parseInt(this.dataset.candidateIdx, 10) + 1;
    if (idx < list.length) {
      this.dataset.candidateIdx = idx;
      this.src = list[idx];
    } else {
      this.onerror = null;
      this.src = "./assets/images/dummy-cover.jpeg";
    }
  };

  if (candidates.length > 0) {
    img.src = candidates[0];
  } else {
    img.src = "./assets/images/dummy-cover.jpeg";
  }
  coverWrapper.appendChild(img);

  entry.appendChild(coverWrapper);
  entry.appendChild(contentDiv);
  frag.appendChild(entry);
}

function renderMixedList(container, rows, lang, seriesMap, detailsBookIdSet) {
  if (!container) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    container.innerHTML = `<p class="photo-card__error">${escapeLibrary(t("library_no_data", lang))}</p>`;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const row of rows) {
    if (row.kind === "read") {
      appendReadCard(frag, row.book, lang, seriesMap, detailsBookIdSet);
    } else {
      appendUnreadCard(frag, row.book, lang);
    }
  }
  container.replaceChildren(frag);
}

function applyTodosChrome(lang) {
  document.documentElement.lang = lang === "en" ? "en" : "es";
  document.title = t("library_todos_page_title", lang);

  const back = document.querySelector(".photos-back");
  if (back) {
    back.textContent = t("library_back", lang);
    back.setAttribute("href", withLangQuery("./biblioteca.html"));
  }

  applyHeaderLangChrome(lang, {
    esId: "lib-todos-lang-es",
    enId: "lib-todos-lang-en",
    hrefEs: "./biblioteca-todos.html",
    hrefEn: "./biblioteca-todos.html?lang=en",
  });

  const skip = document.querySelector(".skip-link");
  if (skip) skip.textContent = t("skip", lang);

  document.querySelectorAll(".theme-button").forEach((btn) => {
    btn.setAttribute("aria-label", t("theme_toggle", lang));
  });
  applyThemeAriaFromLang(lang);

  const h1 = document.getElementById("lib-todos-h1");
  if (h1) h1.textContent = t("library_todos_h1", lang);

  const intro = document.getElementById("lib-todos-intro");
  if (intro) intro.textContent = t("library_todos_intro", lang);

  const rootStats = document.getElementById("lib-todos-stats-root");
  if (rootStats) {
    rootStats.setAttribute("aria-label", t("library_todos_stats_root_aria", lang));
  }

  const totalLab = document.getElementById("lib-todos-catalog-total-label");
  if (totalLab) totalLab.textContent = t("antilibrary_stats_total", lang);
  const unreadLab = document.getElementById("lib-todos-catalog-unread-label");
  if (unreadLab) unreadLab.textContent = t("antilibrary_stats_unread", lang);
  const readLab = document.getElementById("lib-todos-catalog-read-label");
  if (readLab) readLab.textContent = t("antilibrary_stats_read", lang);

  const grSec = document.getElementById("lib-todos-goodreads-stats-section");
  if (grSec) {
    grSec.setAttribute(
      "aria-label",
      lang === "en" ? "Goodreads reading statistics" : "Estadísticas de lectura en Goodreads",
    );
  }
  const grLabelRev = document.getElementById("lib-todos-gr-label-reviewed");
  if (grLabelRev) grLabelRev.textContent = t("library_reviewed", lang);
  const grLabelLikes = document.getElementById("lib-todos-gr-label-likes-gr");
  if (grLabelLikes) grLabelLikes.textContent = t("library_likes", lang);
  const grLabelLocal = document.getElementById("lib-todos-gr-label-likes-local");
  if (grLabelLocal) grLabelLocal.textContent = t("library_likes_local_total", lang);

  const deweySec = document.getElementById("lib-todos-dewey-chart-section");
  if (deweySec) {
    deweySec.setAttribute(
      "aria-label",
      lang === "en" ? "Books by Dewey classes" : "Libros por clases Dewey",
    );
  }
  const deweyH2 = document.getElementById("lib-todos-h2-dewey");
  if (deweyH2) {
    deweyH2.textContent = lang === "en" ? "Books by areas" : "Libros por áreas";
  }

  const filterLab = document.getElementById("lib-todos-dewey-filter-label");
  if (filterLab) filterLab.textContent = t("library_dewey_filter_label", lang);

  const footer = document.querySelector("footer.print-mode-target p");
  if (footer) {
    const href = withLangQuery("./index.html");
    footer.innerHTML = `${t("footer_line", lang)} <a class="link" href="${href}">${escapeLibrary(t("footer_cv_link", lang))}</a>`;
  }

  applyLibrarySectionNav(lang, "todos");
}

async function main() {
  const lang = getPageLang();
  trackPageView("library_todos_page");
  applyTodosChrome(lang);

  const res = await fetch(LIBRARY_JSON, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar ${LIBRARY_JSON} (${res.status})`);
  const data = await res.json();
  const listEl = document.getElementById("lib-todos-books-list");
  if (!listEl) return;

  const seriesData = await fetch("./info/book_series.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { series: [] }))
    .catch(() => ({ series: [] }));

  const detailsData = await fetch(LIBRARY_DETAILS_JSON, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { books: [] }))
    .catch(() => ({ books: [] }));
  const detailsBookIdSet = buildDetailsBookIdSet(detailsData.books ?? []);

  const seriesMap = new Map();
  for (const series of seriesData.series || []) {
    for (const b of series.books || []) {
      if (b.libraryBookId) {
        seriesMap.set(String(b.libraryBookId), series.name);
      }
    }
  }

  const books = normalizeBooks(data.books);
  const readIdentity = new Set(
    books.filter((b) => isReadBook(b)).map((b) => bookIdentityKey(b)).filter(Boolean),
  );
  const libraryByBookId = buildLibraryBookIdMap(books);

  const detailsRows = Array.isArray(detailsData?.books) ? detailsData.books : [];

  let antiBooks;
  let catalogTotal;
  let catalogUnread;
  let catalogReadCount;

  if (detailsRows.length > 0) {
    antiBooks = detailsRows
      .filter((row) => row && typeof row === "object")
      .filter((row) => !isLibraryDuplicateHidden(row))
      .filter((row) => statusIsUnreadRow(row))
      .filter((row) => !isDetailsRowCountedAsReadOnGoodreads(row, libraryByBookId, readIdentity))
      .map((row) => detailsRowToAntiBook(row))
      .filter((b) => b.title);

    catalogUnread = antiBooks.length;
    catalogReadCount = books.filter((b) => !isLibraryDuplicateHidden(b)).length;
    catalogTotal = catalogUnread + catalogReadCount;
  } else {
    antiBooks = books
      .filter((b) => !isLibraryDuplicateHidden(b))
      .filter((b) => !isReadBook(b))
      .filter((b) => !readIdentity.has(bookIdentityKey(b)));
    const readBooks = books
      .filter((b) => isReadBook(b))
      .filter((b) => !isLibraryDuplicateHidden(b));
    catalogTotal = readBooks.length + antiBooks.length;
    catalogUnread = antiBooks.length;
    catalogReadCount = readBooks.length;
  }

  const booksRead = [...(data.books ?? [])]
    .filter((b) => b && b.title)
    .filter((b) => !isLibraryDuplicateHidden(b))
    .map((b) => ({ ...b, _date: parseDate(b.dateRead) }))
    .filter((b) => b._date);

  populateTodosGoodreadsStats(booksRead, catalogTotal);

  const unreadPct = catalogTotal > 0 ? ((catalogUnread / catalogTotal) * 100).toFixed(1) : "0.0";
  const readPct = catalogTotal > 0 ? ((catalogReadCount / catalogTotal) * 100).toFixed(1) : "0.0";
  const totalEl = document.getElementById("lib-todos-catalog-total");
  if (totalEl) totalEl.textContent = String(catalogTotal);
  const unreadEl = document.getElementById("lib-todos-catalog-unread");
  if (unreadEl) unreadEl.textContent = `${catalogUnread} (${unreadPct}%)`;
  const readEl = document.getElementById("lib-todos-catalog-read");
  if (readEl) readEl.textContent = `${catalogReadCount} (${readPct}%)`;

  const sortedRows = sortCombinedRows(booksRead, antiBooks);

  const chartBooks = [...booksRead, ...antiBooks];
  const deweyChartEl = document.getElementById("lib-todos-dewey-chart");
  renderDeweyChart(deweyChartEl, chartBooks, lang);

  let pagerState = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE, showAll: false };
  const getFilteredRows = () => applyClassFilterRows(sortedRows, getActiveClassFilter());
  const onPagerAction = (event) => {
    const filtered = getFilteredRows();
    const maxPage = Math.max(1, Math.ceil(filtered.length / Math.max(1, pagerState.pageSize)));
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
    const filtered = getFilteredRows();
    const maxPage = Math.max(1, Math.ceil(filtered.length / Math.max(1, pagerState.pageSize)));
    if (pagerState.currentPage > maxPage) pagerState.currentPage = maxPage;
    pagerTop?.renderState(pagerState, filtered.length);
    pagerBottom?.renderState(pagerState, filtered.length);
    const visibleRows = applyPagination(filtered, pagerState);
    renderMixedList(listEl, visibleRows, lang, seriesMap, detailsBookIdSet);
    const readOnly = visibleRows.filter((r) => r.kind === "read").map((r) => r.book);
    hydrateLocalLikes(listEl, readOnly, lang).catch(() => {});
  };
  const filterEl = document.getElementById("lib-todos-dewey-filter");
  renderDeweyFilter(filterEl, chartBooks, lang, () => {
    pagerState.currentPage = 1;
    rerender();
  });
  pagerTop = createPagerControls(listEl, lang, onPagerAction, "before");
  pagerBottom = createPagerControls(listEl, lang, onPagerAction, "after");
  rerender();
}

main().catch((err) => {
  console.error(err);
  const listEl = document.getElementById("lib-todos-books-list");
  const lang = getPageLang();
  if (listEl) {
    listEl.innerHTML = `<p class="photo-card__error">${t("library_list_error", lang)}</p>`;
  }
});
