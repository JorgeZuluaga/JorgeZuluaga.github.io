import { getPageLang, withLangQuery } from "./i18n.js";
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

function getBookIdParam() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get("bookid") || "").trim();
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
  return null;
}

function mergeBook(libraryBook, detailsRow, storageHint, bookid) {
  const title = libraryBook?.title || detailsRow?.Title || storageHint?.title || "Libro";
  const author = libraryBook?.author || detailsRow?.Author || storageHint?.author || "—";
  const dateAdded = libraryBook?.dateAdded || detailsRow?.["Date Added"] || storageHint?.dateAdded || "";
  const isbn = normalizeIsbn(libraryBook?.isbn || libraryBook?.ISBN || detailsRow?.ISBN || (bookid.startsWith("isbn:") ? bookid.slice(5) : ""));
  const purchasePlace = String(detailsRow?.["Purchase Place"] || "").trim();
  const purchasePrice = String(detailsRow?.["Purchase Price"] || "").trim();
  const reviewLocalCoverUrl = String(libraryBook?.reviewLocalCoverUrl || "").trim();
  const uploadedImageUrl = String(detailsRow?.["Uploaded Image URL"] || "").trim();
  const id = String(libraryBook?.bookId || detailsRow?.bookId || "").trim();
  return {
    title,
    author,
    dateAdded,
    isbn,
    purchasePlace,
    purchasePrice,
    id,
    reviewLocalCoverUrl,
    uploadedImageUrl,
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

function applyChrome(lang) {
  const back = document.querySelector(".photos-back");
  if (back) back.setAttribute("href", withLangQuery("./antibiblioteca.html"));
  const skip = document.querySelector(".skip-link");
  if (skip) skip.textContent = lang === "en" ? "Skip to content" : "Saltar al contenido";
  document.querySelectorAll(".theme-button").forEach((btn) => {
    btn.setAttribute("aria-label", lang === "en" ? "Display mode: Light/Dark" : "Modo de visualización: Claro/Oscuro");
  });
}

function renderNotFound() {
  const err = document.getElementById("book-error");
  if (err) err.hidden = false;
}

async function main() {
  const lang = getPageLang();
  applyChrome(lang);
  trackPageView("anti_library_book_page");
  const bookid = getBookIdParam();
  if (!bookid) {
    renderNotFound();
    return;
  }

  const [libraryData, detailsData] = await Promise.all([
    fetchJson(LIBRARY_JSON),
    fetchJson(LIBRARY_DETAILS_JSON),
  ]);
  const books = Array.isArray(libraryData?.books) ? libraryData.books : [];
  const detailsBooks = Array.isArray(detailsData?.books) ? detailsData.books : [];
  const storageHint = recoverFromStorage(bookid);

  const libraryBook = findLibraryBook(books, bookid, storageHint);
  const detailsRow = findDetailsRow(detailsBooks, libraryBook, bookid, storageHint);
  const meta = mergeBook(libraryBook, detailsRow, storageHint, bookid);

  if (!meta.title || !meta.author || meta.title === "Libro") {
    renderNotFound();
    return;
  }

  const titleEl = document.getElementById("book-title");
  if (titleEl) titleEl.textContent = String(meta.title || "");
  const authorEl = document.getElementById("book-author");
  if (authorEl) authorEl.textContent = String(meta.author || "");
  document.title = `${meta.title} — Antibiblioteca`;

  const ym = formatYearMonth(meta.dateAdded);
  setText("book-date-added", ym || meta.dateAdded, "Fecha de agregado");
  setText("book-isbn", meta.isbn, "ISBN");
  setText("book-purchase-place", meta.purchasePlace, "Lugar de compra");
  if (isZeroPrice(meta.purchasePrice)) {
    setText("book-purchase-price", "Regalo, bono o herencia", "");
  } else {
    setText("book-purchase-price", formatCopPrice(meta.purchasePrice), "Precio de compra");
  }

  const coverSrc = await resolveCover(meta, bookid);
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

main().catch((err) => {
  console.error(err);
  renderNotFound();
});
