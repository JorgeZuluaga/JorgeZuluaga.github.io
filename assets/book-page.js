import { getPageLang, t, withLangQuery } from "./i18n.js";
import { applyLibrarySectionNav } from "./library-nav.js";
import { trackPageView } from "./visitor-tracker.js";

const LIBRARY_JSON = "./info/library.json";
const LIBRARY_DETAILS_JSON = "./info/library-details.json";
const LOCAL_STORAGE_KEY_PREFIX = "anti_book_id_";
const COVER_DIR = "./antilibrary/covers";
const COVER_EXTS = ["jpg", "jpeg", "png", "webp"];

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeIsbn(value) {
  return String(value ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();
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
  const isbn = normalizeIsbn(item?.isbn || item?.ISBN);
  if (isbn) return `isbn:${isbn}`;
  const basis = [
    normalizeText(item?.title),
    normalizeText(item?.author),
    String(item?.dateAdded || "").trim(),
  ].join("|");
  return `anti:${simpleHash(basis)}`;
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

function formatYearMonth(value) {
  const dt = parseDate(value);
  if (!dt) return "";
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

function formatCopPrice(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return raw;
  const amount = Number(digits);
  if (!Number.isFinite(amount) || amount < 0) return raw;
  if (amount === 0) return "$0";
  return `$${amount.toLocaleString("es-CO").replace(/,/g, ".")}`;
}

function isZeroPrice(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (!digits) return false;
  const amount = Number(digits);
  return Number.isFinite(amount) && amount === 0;
}

function detailsKey(row) {
  return `${normalizeText(row?.Title)}|${normalizeText(row?.Author)}`;
}

function libraryKey(row) {
  return `${normalizeText(row?.title)}|${normalizeText(row?.author)}`;
}

async function fetchJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar ${path} (${res.status})`);
  return res.json();
}

/**
 * ?bookid=<solo dígitos Goodreads> → buscar primero fila con ese bookId en library-details.json;
 *   si existe, ficha completa desde detalle + reseñas desde library.json; si no, solo library.json + reasoning.
 * ?isbn=… o ?bookid=isbn:… → detalle por ISBN + reseña si hay coincidencia en library.json.
 * Otros ?bookid= (gr:, anti:, etc.) → compatibilidad antibiblioteca (ambos JSON, fusión legacy).
 */
function getBookPageParams() {
  const params = new URLSearchParams(window.location.search);
  const isbnQuery = String(params.get("isbn") || "").trim();
  if (isbnQuery) {
    const isbn = normalizeIsbn(isbnQuery);
    if (isbn) return { mode: "isbn", isbn };
  }
  const bid = String(params.get("bookid") || "").trim();
  if (!bid) return null;
  if (bid.startsWith("isbn:")) {
    const isbn = normalizeIsbn(bid.slice(5));
    if (isbn) return { mode: "isbn", isbn };
  }
  if (/^\d+$/.test(bid)) {
    return { mode: "bookid_numeric", bookid: bid };
  }
  return { mode: "legacy", bookid: bid };
}

function recoverFromStorage(bookid) {
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${bookid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function findLibraryBook(books, bookid, storageHint) {
  if (!Array.isArray(books) || !bookid) return null;
  if (bookid.startsWith("gr:")) {
    const bid = bookid.slice(3);
    return books.find((b) => String(b?.bookId || "").trim() === bid) || null;
  }
  /** URL típica ?bookid=36006321 sin prefijo gr: */
  if (/^\d+$/.test(bookid)) {
    return books.find((b) => String(b?.bookId || "").trim() === bookid) || null;
  }
  if (bookid.startsWith("isbn:")) {
    const isbn = bookid.slice(5);
    return books.find((b) => normalizeIsbn(b?.isbn || b?.ISBN) === isbn) || null;
  }
  if (bookid.startsWith("anti:")) {
    const direct = books.find((b) => antiBookId(b) === bookid);
    if (direct) return direct;
    if (storageHint?.title && storageHint?.author) {
      const k = `${normalizeText(storageHint.title)}|${normalizeText(storageHint.author)}`;
      return books.find((b) => libraryKey(b) === k) || null;
    }
  }
  return books.find((b) => antiBookId(b) === bookid) || null;
}

function findDetailsRow(detailsBooks, libraryBook, bookid, storageHint) {
  if (!Array.isArray(detailsBooks)) return null;
  if (libraryBook?.bookId) {
    const byBookId = detailsBooks.find((d) => String(d?.bookId || "").trim() === String(libraryBook.bookId).trim());
    if (byBookId) return byBookId;
  }
  const libK = libraryBook ? libraryKey(libraryBook) : "";
  if (libK) {
    const byKey = detailsBooks.find((d) => detailsKey(d) === libK);
    if (byKey) return byKey;
  }
  if (storageHint?.title && storageHint?.author) {
    const hintK = `${normalizeText(storageHint.title)}|${normalizeText(storageHint.author)}`;
    const byHint = detailsBooks.find((d) => detailsKey(d) === hintK);
    if (byHint) return byHint;
  }
  if (bookid.startsWith("isbn:")) {
    const isbn = bookid.slice(5);
    return detailsBooks.find((d) => normalizeIsbn(d?.ISBN) === isbn) || null;
  }
  if (/^\d+$/.test(bookid)) {
    const byBid = detailsBooks.find((d) => String(d?.bookId || "").trim() === bookid);
    if (byBid) return byBid;
  }
  return null;
}

function nonEmptyRecord(obj) {
  return obj && typeof obj === "object" && Object.keys(obj).length > 0;
}

/** Prefer library.json Dewey blocks when present; otherwise library-details.json. */
function mergeDccRecords(libraryBook, detailsRow) {
  const classes = nonEmptyRecord(libraryBook?.dcc_classes)
    ? libraryBook.dcc_classes
    : nonEmptyRecord(detailsRow?.dcc_classes)
      ? detailsRow.dcc_classes
      : null;
  const codes = nonEmptyRecord(libraryBook?.dcc_codes)
    ? libraryBook.dcc_codes
    : nonEmptyRecord(detailsRow?.dcc_codes)
      ? detailsRow.dcc_codes
      : null;
  return { classes, codes };
}

function sortDeweyKeys(keys) {
  return [...keys].sort((a, b) => {
    const na = Number.parseFloat(String(a));
    const nb = Number.parseFloat(String(b));
    const fa = Number.isFinite(na) ? na : Number.MAX_SAFE_INTEGER;
    const fb = Number.isFinite(nb) ? nb : Number.MAX_SAFE_INTEGER;
    if (fa !== fb) return fa - fb;
    return String(a).localeCompare(String(b));
  });
}

/** Labels in dcc_classes already include the code in parentheses. */
function formatDccClassesLine(classes) {
  if (!classes || typeof classes !== "object") return "";
  const parts = [];
  for (const key of sortDeweyKeys(Object.keys(classes))) {
    const label = String(classes[key] ?? "").trim();
    if (label) parts.push(label);
  }
  return parts.join(", ");
}

/** Each code as "Description (nnn)" or "Description (nnn.nn)". */
function formatDccCodesLine(codes) {
  if (!codes || typeof codes !== "object") return "";
  const parts = [];
  for (const key of sortDeweyKeys(Object.keys(codes))) {
    const desc = String(codes[key] ?? "").trim();
    const k = String(key).trim();
    if (desc) parts.push(`${desc} (${k})`);
    else parts.push(`(${k})`);
  }
  return parts.join(", ");
}

/** Antibiblioteca / URLs no numéricas: combinar library.json + library-details si hay fila enlazada. */
function mergeBookLegacyFull(libraryBook, detailsRow, storageHint, bookid) {
  const title = libraryBook?.title || detailsRow?.Title || storageHint?.title || "Libro";
  const author = libraryBook?.author || detailsRow?.Author || storageHint?.author || "—";
  const dateAdded =
    libraryBook?.dateAdded ||
    detailsRow?.["Date Added"] ||
    storageHint?.dateAdded ||
    "";
  const dateRead = String(libraryBook?.dateRead || "").trim();
  const isbnRaw =
    libraryBook?.isbn ||
    libraryBook?.ISBN ||
    detailsRow?.ISBN ||
    (bookid.startsWith("isbn:") ? bookid.slice(5) : "");
  const isbn = normalizeIsbn(isbnRaw);
  const purchasePlace = String(detailsRow?.["Purchase Place"] || "").trim();
  const purchasePrice = String(detailsRow?.["Purchase Price"] || "").trim();
  const reviewLocalCoverUrl = String(libraryBook?.reviewLocalCoverUrl || "").trim();
  const uploadedImageUrl = String(detailsRow?.["Uploaded Image URL"] || "").trim();
  const id = String(libraryBook?.bookId || detailsRow?.bookId || "").trim();
  const ddc = String(libraryBook?.ddc || detailsRow?.DDC || "").trim();
  const ddc_topic = libraryBook?.ddc_topic || detailsRow?.ddc_topic || null;
  const { classes: dccClasses, codes: dccCodes } = mergeDccRecords(libraryBook, detailsRow);
  const summaryFromField = String(detailsRow?.Summary ?? detailsRow?.summary ?? "").trim();
  const reasoningFromDetails = String(detailsRow?.dcc_notes?.reasoning ?? "").trim();
  const reasoningFromLibrary = String(libraryBook?.dcc_notes?.reasoning ?? "").trim();
  const summary = summaryFromField || reasoningFromDetails || reasoningFromLibrary;
  const summaryIsBrief = !summaryFromField && Boolean(summary);
  return {
    title,
    author,
    dateAdded,
    dateRead,
    isbn,
    purchasePlace,
    purchasePrice,
    ddc,
    ddc_topic,
    id,
    reviewLocalCoverUrl,
    uploadedImageUrl,
    dccClasses,
    dccCodes,
    summary,
    summaryIsBrief,
  };
}

/** ?bookid=<goodreads numérico>: solo datos de library.json; descripción = dcc_notes.reasoning. */
function mergeBookLibraryOnly(libraryBook) {
  const title = libraryBook?.title || "Libro";
  const author = libraryBook?.author || "—";
  const dateAdded = libraryBook?.dateAdded || "";
  const dateRead = String(libraryBook?.dateRead || "").trim();
  const isbn = normalizeIsbn(libraryBook?.isbn || libraryBook?.ISBN);
  const reviewLocalCoverUrl = String(libraryBook?.reviewLocalCoverUrl || "").trim();
  const id = String(libraryBook?.bookId || "").trim();
  const ddc = String(libraryBook?.ddc || "").trim();
  const ddc_topic = libraryBook?.ddc_topic || null;
  const { classes: dccClasses, codes: dccCodes } = mergeDccRecords(libraryBook, null);
  const reasoning = String(libraryBook?.dcc_notes?.reasoning ?? "").trim();
  return {
    title,
    author,
    dateAdded,
    dateRead,
    isbn,
    purchasePlace: "",
    purchasePrice: "",
    ddc,
    ddc_topic,
    id,
    reviewLocalCoverUrl,
    uploadedImageUrl: "",
    dccClasses,
    dccCodes,
    summary: reasoning,
    summaryIsBrief: Boolean(reasoning),
  };
}

/** ?isbn=: fila de library-details + opcional library.json para reseña / Dewey enriquecido. */
function mergeBookDetailsMode(detailsRow, libraryBook) {
  const title = libraryBook?.title || detailsRow?.Title || "Libro";
  const author = libraryBook?.author || detailsRow?.Author || "—";
  const dateAdded = libraryBook?.dateAdded || detailsRow?.["Date Added"] || "";
  const dateRead = String(libraryBook?.dateRead || "").trim();
  const isbnRaw =
    libraryBook?.isbn || libraryBook?.ISBN || detailsRow?.ISBN || "";
  const isbn = normalizeIsbn(isbnRaw);
  const purchasePlace = String(detailsRow?.["Purchase Place"] || "").trim();
  const purchasePrice = String(detailsRow?.["Purchase Price"] || "").trim();
  const reviewLocalCoverUrl = String(libraryBook?.reviewLocalCoverUrl || "").trim();
  const uploadedImageUrl = String(detailsRow?.["Uploaded Image URL"] || "").trim();
  const id = String(libraryBook?.bookId || detailsRow?.bookId || "").trim();
  const ddc = String(libraryBook?.ddc || detailsRow?.DDC || "").trim();
  const ddc_topic = libraryBook?.ddc_topic || detailsRow?.ddc_topic || null;
  const { classes: dccClasses, codes: dccCodes } = mergeDccRecords(libraryBook, detailsRow);
  const summaryFromField = String(detailsRow?.Summary ?? detailsRow?.summary ?? "").trim();
  const reasoningDetails = String(detailsRow?.dcc_notes?.reasoning ?? "").trim();
  const reasoningLibrary = String(libraryBook?.dcc_notes?.reasoning ?? "").trim();
  const summary = summaryFromField || reasoningDetails || reasoningLibrary;
  const summaryIsBrief = !summaryFromField && Boolean(summary);
  return {
    title,
    author,
    dateAdded,
    dateRead,
    isbn,
    purchasePlace,
    purchasePrice,
    ddc,
    ddc_topic,
    id,
    reviewLocalCoverUrl,
    uploadedImageUrl,
    dccClasses,
    dccCodes,
    summary,
    summaryIsBrief,
  };
}

function setText(id, value, label) {
  const el = document.getElementById(id);
  if (!el) return;
  const v = String(value || "").trim();
  if (!v) {
    el.textContent = "";
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = label ? `${label}: ${v}` : v;
}

function renderBookSummary(lang, summary, summaryIsBrief) {
  const section = document.getElementById("book-summary-section");
  const heading = document.getElementById("book-summary-heading");
  const bodyEl = document.getElementById("book-summary-body");
  if (!section || !heading || !bodyEl) return;
  const text = String(summary ?? "").trim();
  if (!text) {
    section.hidden = true;
    heading.textContent = "";
    bodyEl.replaceChildren();
    return;
  }
  heading.textContent = summaryIsBrief
    ? t("book_brief_description_heading", lang)
    : t("book_description_heading", lang);
  bodyEl.replaceChildren();
  const chunks = text
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const paras = chunks.length > 0 ? chunks : [text];
  for (const chunk of paras) {
    const p = document.createElement("p");
    p.className = "book-summary-body-p";
    p.textContent = chunk.replace(/\n+/g, " ").trim();
    bodyEl.appendChild(p);
  }
  section.hidden = false;
}

function canUseCover(src, minSide = 80) {
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    const timer = window.setTimeout(() => finish(false), 5000);
    img.onload = () => {
      window.clearTimeout(timer);
      // Skip tiny placeholder images (e.g., 35x35 generic icons).
      if (img.naturalWidth < minSide || img.naturalHeight < minSide) {
        finish(false);
        return;
      }
      finish(true);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      finish(false);
    };
    img.src = src;
  });
}

async function resolveCover(meta, bookid) {
  const isbn = normalizeIsbn(meta?.isbn);
  const candidates = [];
  if (meta?.reviewLocalCoverUrl) {
    candidates.push(meta.reviewLocalCoverUrl);
  }
  if (meta?.uploadedImageUrl) {
    candidates.push(meta.uploadedImageUrl);
  }
  if (isbn) {
    COVER_EXTS.forEach((ext) => candidates.push(`${COVER_DIR}/${isbn}.${ext}`));
  }
  if (bookid.startsWith("anti:")) {
    const raw = bookid.slice(5);
    COVER_EXTS.forEach((ext) => candidates.push(`${COVER_DIR}/noisbn-${raw}.${ext}`));
    COVER_EXTS.forEach((ext) => candidates.push(`${COVER_DIR}/${raw}.${ext}`));
  }
  const tried = new Set();
  for (const src of candidates) {
    if (!src || tried.has(src)) continue;
    tried.add(src);
    try {
      // Validate that it actually loads and is not a tiny placeholder.
      const ok = await canUseCover(src);
      if (ok) return src;
    } catch {
      // Try next candidate.
    }
  }
  return "";
}

function applyChrome(lang, fromReadLibrary) {
  const back = document.querySelector(".photos-back");
  if (back) {
    if (fromReadLibrary) {
      back.setAttribute("href", withLangQuery("./biblioteca.html"));
      back.textContent = lang === "en" ? "← Back to Library" : "← Volver a Biblioteca";
    } else {
      back.setAttribute("href", withLangQuery("./biblioteca-noleidos.html"));
      back.textContent =
        lang === "en" ? "← Back to Antilibrary" : "← Volver a Antibiblioteca";
    }
  }
  const skip = document.querySelector(".skip-link");
  if (skip) skip.textContent = lang === "en" ? "Skip to content" : "Saltar al contenido";
  document.querySelectorAll(".theme-button").forEach((btn) => {
    btn.setAttribute("aria-label", lang === "en" ? "Display mode: Light/Dark" : "Modo de visualización: Claro/Oscuro");
  });
  applyLibrarySectionNav(lang, null);
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

function renderReviewLinks(lang, libraryBook) {
  const wrap = document.getElementById("book-review-links");
  if (!wrap) return;
  const localHref = effectiveLocalReviewHref(libraryBook);
  const remoteUrl = String(libraryBook?.reviewUrl || "").trim();
  const hasLocal = Boolean(localHref);
  const hasRemote = remoteUrl.includes("/review/show/");
  if (!libraryBook || (!hasLocal && !hasRemote)) {
    wrap.hidden = true;
    wrap.replaceChildren();
    return;
  }
  wrap.hidden = false;
  wrap.replaceChildren();
  if (hasLocal) {
    const a = document.createElement("a");
    a.className = "link";
    a.href = withLangQuery(localHref);
    a.textContent =
      lang === "en" ? "Read review on this site" : "Ver reseña en este sitio";
    wrap.appendChild(a);
  }
  if (hasLocal && hasRemote) {
    wrap.appendChild(document.createTextNode(" · "));
  }
  if (hasRemote) {
    const a = document.createElement("a");
    a.className = "link";
    a.href = remoteUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent =
      lang === "en"
        ? "View review on Goodreads (requires login)"
        : "Ver reseña en GoodReads (necesita cuenta)";
    wrap.appendChild(a);
  }
}

function renderNotFound() {
  const err = document.getElementById("book-error");
  if (err) err.hidden = false;
}

async function renderBookPageContent(lang, meta, libraryBook, coverBookKey, fromReadLibrary) {
  const titleEl = document.getElementById("book-title");
  if (titleEl) titleEl.textContent = String(meta.title || "");
  const authorEl = document.getElementById("book-author");
  if (authorEl) authorEl.textContent = String(meta.author || "");
  const subtitleEl = document.getElementById("book-subtitle");
  if (subtitleEl) {
    subtitleEl.textContent = fromReadLibrary
      ? lang === "en"
        ? "Book from Jorge Zuluaga’s read library (Goodreads)"
        : "Libro de la biblioteca leída de Jorge I. Zuluaga (Goodreads)"
      : lang === "en"
        ? "Book in Jorge Zuluaga’s antilibrary"
        : "Libro en la antibiblioteca de Jorge I. Zuluaga";
  }
  document.title = `${meta.title} — ${fromReadLibrary ? (lang === "en" ? "Library" : "Biblioteca") : lang === "en" ? "Antilibrary" : "Antibiblioteca"}`;

  const ddcLabel = lang === "en" ? "DCC Classification" : "Clasificación DCC";
  if (meta.ddc) {
    let topicText = "";
    if (meta.ddc_topic) {
      topicText = meta.ddc_topic[lang] || meta.ddc_topic["es"] || "";
    }
    const ddcDisplay = topicText ? `${topicText} (${meta.ddc})` : meta.ddc;
    setText("book-ddc", ddcDisplay, ddcLabel);
  } else {
    const el = document.getElementById("book-ddc");
    if (el) el.hidden = true;
  }

  const generalLabel =
    lang === "en" ? "General classification" : "Clasificación general";
  const specificLabel =
    lang === "en" ? "Specific classification" : "Clasificación específica";
  setText("book-dcc-general", formatDccClassesLine(meta.dccClasses), generalLabel);
  setText("book-dcc-specific", formatDccCodesLine(meta.dccCodes), specificLabel);

  const addedYm = formatYearMonth(meta.dateAdded);
  const readYm = formatYearMonth(meta.dateRead);
  if (addedYm || String(meta.dateAdded || "").trim()) {
    const dateAddedLabel = lang === "en" ? "Date added" : "Fecha de agregado";
    setText("book-date-added", addedYm || meta.dateAdded, dateAddedLabel);
  } else if (readYm || String(meta.dateRead || "").trim()) {
    const dateReadLabel = lang === "en" ? "Date read" : "Fecha de lectura";
    setText("book-date-added", readYm || meta.dateRead, dateReadLabel);
  } else {
    const dateAddedLabel = lang === "en" ? "Date added" : "Fecha de agregado";
    setText("book-date-added", "", dateAddedLabel);
  }

  setText("book-isbn", meta.isbn, "ISBN");

  const purchasePlaceLabel = lang === "en" ? "Purchase place" : "Lugar de compra";
  setText("book-purchase-place", meta.purchasePlace, purchasePlaceLabel);

  const purchasePriceLabel = lang === "en" ? "Purchase price" : "Precio de compra";
  const giftLabel = lang === "en" ? "Gift, voucher or inheritance" : "Regalo, bono o herencia";

  if (isZeroPrice(meta.purchasePrice)) {
    setText("book-purchase-price", giftLabel, "");
  } else {
    setText("book-purchase-price", formatCopPrice(meta.purchasePrice), purchasePriceLabel);
  }

  renderReviewLinks(lang, libraryBook);

  renderBookSummary(lang, meta.summary, meta.summaryIsBrief);

  const coverSrc = await resolveCover(meta, coverBookKey);
  if (coverSrc) {
    const fig = document.getElementById("book-cover");
    const img = document.getElementById("book-cover-img");
    if (img) {
      img.src = coverSrc;
      img.alt = `Portada de ${meta.title}`;
    }
    if (fig) fig.hidden = false;
  }
}

async function main() {
  const lang = getPageLang();
  trackPageView("anti_library_book_page");
  const params = getBookPageParams();
  if (!params) {
    applyChrome(lang, false);
    renderNotFound();
    return;
  }

  const libraryData = await fetchJson(LIBRARY_JSON);
  const books = Array.isArray(libraryData?.books) ? libraryData.books : [];

  if (params.mode === "bookid_numeric") {
    const storageHint = recoverFromStorage(params.bookid);
    const libraryBook = findLibraryBook(books, params.bookid, storageHint);
    if (!libraryBook) {
      applyChrome(lang, false);
      renderNotFound();
      return;
    }
    const detailsData = await fetchJson(LIBRARY_DETAILS_JSON);
    const detailsBooks = Array.isArray(detailsData?.books) ? detailsData.books : [];
    const detailsRow =
      detailsBooks.find((d) => String(d?.bookId || "").trim() === params.bookid) || null;
    const meta = detailsRow
      ? mergeBookDetailsMode(detailsRow, libraryBook)
      : mergeBookLibraryOnly(libraryBook);
    const fromReadLibrary = Boolean(String(libraryBook.dateRead || "").trim());
    applyChrome(lang, fromReadLibrary);
    await renderBookPageContent(lang, meta, libraryBook, params.bookid, fromReadLibrary);
    return;
  }

  if (params.mode === "isbn") {
    const detailsData = await fetchJson(LIBRARY_DETAILS_JSON);
    const detailsBooks = Array.isArray(detailsData?.books) ? detailsData.books : [];
    const detailsRow = detailsBooks.find((d) => normalizeIsbn(d?.ISBN) === params.isbn);
    if (!detailsRow) {
      applyChrome(lang, false);
      renderNotFound();
      return;
    }
    const libraryBook =
      books.find((b) => normalizeIsbn(b?.isbn || b?.ISBN) === params.isbn) || null;
    const meta = mergeBookDetailsMode(detailsRow, libraryBook);
    const fromReadLibrary = Boolean(
      libraryBook && String(libraryBook.dateRead || "").trim(),
    );
    applyChrome(lang, fromReadLibrary);
    const coverKey = libraryBook?.bookId ? String(libraryBook.bookId) : `isbn:${params.isbn}`;
    await renderBookPageContent(lang, meta, libraryBook, coverKey, fromReadLibrary);
    return;
  }

  const detailsData = await fetchJson(LIBRARY_DETAILS_JSON);
  const detailsBooks = Array.isArray(detailsData?.books) ? detailsData.books : [];
  const storageHint = recoverFromStorage(params.bookid);
  const libraryBook = findLibraryBook(books, params.bookid, storageHint);
  const detailsRow = findDetailsRow(detailsBooks, libraryBook, params.bookid, storageHint);
  const meta = mergeBookLegacyFull(libraryBook, detailsRow, storageHint, params.bookid);

  if (!meta.title || !meta.author || meta.title === "Libro") {
    applyChrome(lang, false);
    renderNotFound();
    return;
  }

  const fromReadLibrary = Boolean(
    libraryBook && String(libraryBook.dateRead || "").trim(),
  );
  applyChrome(lang, fromReadLibrary);
  await renderBookPageContent(lang, meta, libraryBook, params.bookid, fromReadLibrary);
}

main().catch((err) => {
  console.error(err);
  renderNotFound();
});
