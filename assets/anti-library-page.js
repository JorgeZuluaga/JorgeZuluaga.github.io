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
const LOCAL_STORAGE_KEY_PREFIX = "anti_book_id_";
const DEFAULT_PAGE_SIZE = 50;
const DEWEY_GENERAL_CODES = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900];

/** Hidden duplicates (manual cataloguing): keep in JSON / dedupe imports but omit from lists. */
function isLibraryDuplicateHidden(rowOrBook) {
  const v = rowOrBook?.libraryDuplicateHidden;
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

function formatBookAreaMetaHtml(book, lang) {
  const label = escapeHtml(t("library_area_label", lang));
  const primaryGen = extractBookPrimaryDeweyGeneralCode(book);
  if (primaryGen === null) {
    const fb = escapeHtml(t("library_area_unclassified", lang));
    return `<strong>${label}</strong> ${fb}`;
  }
  const mainClass = escapeHtml(deweyAreaName(primaryGen, lang));
  const entry = getPrimaryDccCodeEntry(book);
  if (entry.topic) {
    return `<strong>${label}</strong> ${mainClass} / ${escapeHtml(entry.topic)}`;
  }
  const key = String(primaryGen);
  const cls = book?.dcc_classes?.[key];
  if (cls) {
    const stripped = String(cls).replace(/\s*\(\d+\)\s*$/, "").trim();
    return `<strong>${label}</strong> ${escapeHtml(stripped)}`;
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
  const totalAreasCount = areaRows.reduce((acc, row) => acc + row.count, 0);

  return {
    areaRows,
    totalAreasCount,
    unclassifiedCount,
  };
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

/** Science (500) first, then other areas by popularity; then most recent date within each area. */
function sortBooksByDeweyAreaPopularityThenDate(books, getDateMs) {
  const { areaRows, unclassifiedCount } = computeDeweyGeneralCounts(books);
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

  return [...books].sort((a, b) => {
    const ra = bucketRank(a);
    const rb = bucketRank(b);
    if (ra !== rb) return ra - rb;
    return getDateMs(b) - getDateMs(a);
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

function applyClassFilter(books, filter) {
  if (filter === null) return books;
  if (filter === "unclassified") {
    return books.filter((b) => extractBookPrimaryDeweyGeneralCode(b) === null);
  }
  return books.filter((b) => extractBookPrimaryDeweyGeneralCode(b) === filter);
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
  // Goodreads titles often include subtitle after ":".
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

/** BookBuddy row already counted as read on this site / Goodreads (library.json). */
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

function escapeHtml(s) {
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

function applyChrome(lang) {
  document.documentElement.lang = lang === "en" ? "en" : "es";
  document.title = t("antilibrary_title", lang);

  const back = document.querySelector(".photos-back");
  if (back) {
    back.textContent = t("antilibrary_back", lang);
    back.setAttribute("href", withLangQuery("./biblioteca.html"));
  }

  applyHeaderLangChrome(lang, {
    esId: "anti-lib-lang-es",
    enId: "anti-lib-lang-en",
    hrefEs: "./libros-noleidos.html",
    hrefEn: "./libros-noleidos.html?lang=en",
  });

  const skip = document.querySelector(".skip-link");
  if (skip) skip.textContent = t("skip", lang);
  document.querySelectorAll(".theme-button").forEach((btn) => {
    btn.setAttribute("aria-label", t("theme_toggle", lang));
  });
  applyThemeAriaFromLang(lang);

  const title = document.getElementById("anti-library-title");
  if (title) title.textContent = t("antilibrary_title", lang);
  const intro = document.getElementById("anti-library-intro");
  if (intro) intro.innerHTML = t("antilibrary_intro", lang);
  const quote = document.getElementById("anti-library-quote");
  if (quote) quote.textContent = t("antilibrary_quote", lang);
  const imageCaption = document.getElementById("anti-library-image-caption-label");
  if (imageCaption) imageCaption.textContent = t("antilibrary_image_caption", lang);
  const sourceOriginal = document.getElementById("anti-library-source-original-label");
  if (sourceOriginal) sourceOriginal.textContent = t("antilibrary_source_original", lang);
  const sourceTranslation = document.getElementById("anti-library-source-translation-label");
  if (sourceTranslation) sourceTranslation.textContent = t("antilibrary_source_translation", lang);
  const totalLabel = document.getElementById("anti-report-total-label");
  if (totalLabel) totalLabel.textContent = t("antilibrary_stats_total", lang);
  const unreadLabel = document.getElementById("anti-report-unread-label");
  if (unreadLabel) unreadLabel.textContent = t("antilibrary_stats_unread", lang);
  const readLabel = document.getElementById("anti-report-read-label");
  if (readLabel) readLabel.textContent = t("antilibrary_stats_read", lang);
  const deweyTitle = document.getElementById("anti-h2-dewey");
  if (deweyTitle) {
    deweyTitle.textContent = lang === "en"
      ? "Books by areas"
      : "Libros por areas";
  }
  const deweySection = document.getElementById("anti-dewey-chart-section");
  if (deweySection) {
    deweySection.setAttribute(
      "aria-label",
      lang === "en" ? "Books by Dewey classes" : "Libros por clases Dewey",
    );
  }

  applyLibrarySectionNav(lang, "anti");
}

function renderBooks(container, books, lang) {
  if (!container) return;
  if (!Array.isArray(books) || books.length === 0) {
    container.innerHTML = `<p class="photo-card__error">${escapeHtml(t("library_no_data", lang))}</p>`;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const item of books) {
    const entry = document.createElement("article");
    entry.className = "library-book-item library-book-item--with-cover";

    const contentDiv = document.createElement("div");
    contentDiv.className = "library-book-item__content";

    const title = document.createElement("h3");
    title.className = "library-book-item__title";
    title.textContent = item.title ?? t("library_book_title_fallback", lang);

    const meta1 = document.createElement("p");
    meta1.className = "library-book-item__meta";
    meta1.innerHTML = `<strong>${escapeHtml(t("library_by_author", lang))}</strong> ${escapeHtml(item.author || "—")}`;

    const meta2 = document.createElement("p");
    meta2.className = "library-book-item__meta";
    const added = item._dateAdded
      ? `${item._dateAdded.getFullYear()}/${String(item._dateAdded.getMonth() + 1).padStart(2, "0")}`
      : String(item.dateAdded || "").trim();
    meta2.innerHTML = `<strong>${escapeHtml(t("library_date_added", lang))}</strong> ${escapeHtml(added || "—")}`;

    const metaArea = document.createElement("p");
    metaArea.className = "library-book-item__meta";
    metaArea.innerHTML = formatBookAreaMetaHtml(item, lang);

    const actions = document.createElement("p");
    actions.className = "library-book-item__actions";
    const id = antiBookId(item);
    const descHref = withLangQuery(`./book.html?bookid=${encodeURIComponent(id)}`);
    actions.innerHTML =
      `<a class="link" href="${escapeHtml(descHref)}">${escapeHtml(t("library_view_description_complete", lang))}</a>` +
      ` · <i class="library-book-item__antilibrary-note">${escapeHtml(t("antilibrary_review_unavailable", lang))}</i>`;
    try {
      localStorage.setItem(`${LOCAL_STORAGE_KEY_PREFIX}${id}`, JSON.stringify({
        title: item?.title || "",
        author: item?.author || "",
        dateAdded: item?.dateAdded || "",
      }));
    } catch {
      // Ignore storage issues.
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
        String(item.dateAdded || "").trim()
      ].join("|");
      const rawHash = simpleHash(hashBasis);
      candidates.push(`./antilibrary/covers/noisbn-${rawHash}.png`);
      candidates.push(`./antilibrary/covers/noisbn-${rawHash}.jpg`);
      candidates.push(`./antilibrary/covers/noisbn-${rawHash}.webp`);
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
  container.replaceChildren(frag);
}

async function main() {
  const lang = getPageLang();
  trackPageView("anti_library_page");
  applyChrome(lang);

  const res = await fetch(LIBRARY_JSON, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar ${LIBRARY_JSON} (${res.status})`);
  const data = await res.json();
  const listEl = document.getElementById("anti-library-list");
  if (!listEl) return;

  const books = normalizeBooks(data.books);

  const readIdentity = new Set(
    books.filter((b) => isReadBook(b)).map((b) => bookIdentityKey(b)).filter(Boolean),
  );
  const libraryByBookId = buildLibraryBookIdMap(books);

  let detailsRows = [];
  try {
    const resDetails = await fetch(LIBRARY_DETAILS_JSON, { cache: "no-store" });
    if (resDetails.ok) {
      const detailsData = await resDetails.json();
      detailsRows = Array.isArray(detailsData?.books) ? detailsData.books : [];
    }
  } catch {
    // Optional file: fall back to library.json only.
  }

  let antiBooks;
  let total;
  let unread;
  let read;

  if (detailsRows.length > 0) {
    antiBooks = sortBooksByDeweyAreaPopularityThenDate(
      detailsRows
        .filter((row) => row && typeof row === "object")
        .filter((row) => !isLibraryDuplicateHidden(row))
        .filter((row) => statusIsUnreadRow(row))
        .filter((row) => !isDetailsRowCountedAsReadOnGoodreads(row, libraryByBookId, readIdentity))
        .map((row) => detailsRowToAntiBook(row))
        .filter((b) => b.title),
      (b) => b._dateAdded?.getTime() ?? 0,
    );

    // Keep summary cards consistent with the list/pagination universe.
    // - unread: exactly the same antiBooks collection used for rendering and paging.
    // - read: all Goodreads books from library.json.
    // - total: read + unread.
    unread = antiBooks.length;
    read = books.filter((b) => !isLibraryDuplicateHidden(b)).length;
    total = unread + read;
  } else {
    antiBooks = sortBooksByDeweyAreaPopularityThenDate(
      books
        .filter((b) => !isLibraryDuplicateHidden(b))
        .filter((b) => !isReadBook(b))
        .filter((b) => !readIdentity.has(bookIdentityKey(b))),
      (b) => b._dateAdded?.getTime() ?? 0,
    );
    const readBooks = books
      .filter((b) => isReadBook(b))
      .filter((b) => !isLibraryDuplicateHidden(b));
    total = readBooks.length + antiBooks.length;
    unread = antiBooks.length;
    read = readBooks.length;
  }
  const unreadPct = total > 0 ? ((unread / total) * 100).toFixed(1) : "0.0";
  const readPct = total > 0 ? ((read / total) * 100).toFixed(1) : "0.0";
  const totalEl = document.getElementById("anti-report-total");
  if (totalEl) totalEl.textContent = String(total);
  const unreadEl = document.getElementById("anti-report-unread");
  if (unreadEl) unreadEl.textContent = `${unread} (${unreadPct}%)`;
  const readEl = document.getElementById("anti-report-read");
  if (readEl) readEl.textContent = `${read} (${readPct}%)`;

  const deweyChartEl = document.getElementById("anti-dewey-chart");
  renderDeweyChart(deweyChartEl, antiBooks, lang);

  let pagerState = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE, showAll: false };
  const getFilteredBooks = () => applyClassFilter(antiBooks, getActiveClassFilter());
  const onPagerAction = (event) => {
    const filtered = getFilteredBooks();
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
    const filtered = getFilteredBooks();
    const maxPage = Math.max(1, Math.ceil(filtered.length / Math.max(1, pagerState.pageSize)));
    if (pagerState.currentPage > maxPage) pagerState.currentPage = maxPage;
    pagerTop?.renderState(pagerState, filtered.length);
    pagerBottom?.renderState(pagerState, filtered.length);
    const visibleBooks = applyPagination(filtered, pagerState);
    renderBooks(listEl, visibleBooks, lang);
  };
  const filterEl = document.getElementById("anti-dewey-filter");
  renderDeweyFilter(filterEl, antiBooks, lang, () => {
    pagerState.currentPage = 1;
    rerender();
  });
  pagerTop = createPagerControls(listEl, lang, onPagerAction, "before");
  pagerBottom = createPagerControls(listEl, lang, onPagerAction, "after");
  rerender();
}

main().catch((err) => {
  console.error(err);
  const listEl = document.getElementById("anti-library-list");
  const lang = getPageLang();
  if (listEl) {
    listEl.innerHTML = `<p class="photo-card__error">${t("library_list_error", lang)}</p>`;
  }
});
