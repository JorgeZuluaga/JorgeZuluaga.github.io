import {
  applyThemeAriaFromLang,
  getPageLang,
  t,
  withLangQuery,
} from "./i18n.js";
import { trackPageView } from "./visitor-tracker.js";

const LIBRARY_JSON = "./info/library.json";
const LOCAL_STORAGE_KEY_PREFIX = "anti_book_id_";

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

function applyChrome(lang) {
  document.documentElement.lang = lang === "en" ? "en" : "es";
  document.title = t("antilibrary_title", lang);

  const back = document.querySelector(".photos-back");
  if (back) {
    back.textContent = t("antilibrary_back", lang);
    back.setAttribute("href", withLangQuery("./biblioteca.html"));
  }

  const es = document.getElementById("anti-lib-lang-es");
  const en = document.getElementById("anti-lib-lang-en");
  if (es) {
    es.href = "./antibiblioteca.html";
    es.textContent = t("lang_es", lang);
  }
  if (en) {
    en.href = "./antibiblioteca.html?lang=en";
    en.textContent = t("lang_en", lang);
  }

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
    entry.className = "library-book-item";

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
    const hasDetails = Number(item.bookDetails) === 1;
    const detailLabel = hasDetails
      ? t("library_details_present", lang)
      : t("library_details_missing", lang);
    const detailClass = hasDetails
      ? "library-details-status library-details-status--present"
      : "library-details-status library-details-status--missing";
    meta2.innerHTML = `<strong>${escapeHtml(t("library_date_added", lang))}</strong> ${escapeHtml(added || "—")} (<span class="${detailClass}">${escapeHtml(detailLabel)}</span>)`;

    const actions = document.createElement("p");
    actions.className = "library-book-item__actions";
    const id = antiBookId(item);
    actions.innerHTML = `<a class="link" href="${withLangQuery(`./book.html?bookid=${encodeURIComponent(id)}`)}">Ver registro</a>`;
    try {
      localStorage.setItem(`${LOCAL_STORAGE_KEY_PREFIX}${id}`, JSON.stringify({
        title: item?.title || "",
        author: item?.author || "",
        dateAdded: item?.dateAdded || "",
      }));
    } catch {
      // Ignore storage issues.
    }

    entry.appendChild(title);
    entry.appendChild(meta1);
    entry.appendChild(meta2);
    entry.appendChild(actions);
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
  const antiBooks = books
    .filter((b) => !isReadBook(b))
    .filter((b) => !readIdentity.has(bookIdentityKey(b)))
    .sort((a, b) => (b._dateAdded?.getTime() ?? 0) - (a._dateAdded?.getTime() ?? 0));

  const readBooks = books.filter((b) => isReadBook(b));
  const total = readBooks.length + antiBooks.length;
  const unread = antiBooks.length;
  const read = readBooks.length;
  const unreadPct = total > 0 ? ((unread / total) * 100).toFixed(1) : "0.0";
  const readPct = total > 0 ? ((read / total) * 100).toFixed(1) : "0.0";
  const totalEl = document.getElementById("anti-report-total");
  if (totalEl) totalEl.textContent = String(total);
  const unreadEl = document.getElementById("anti-report-unread");
  if (unreadEl) unreadEl.textContent = `${unread} (${unreadPct}%)`;
  const readEl = document.getElementById("anti-report-read");
  if (readEl) readEl.textContent = `${read} (${readPct}%)`;

  renderBooks(listEl, antiBooks, lang);
}

main().catch((err) => {
  console.error(err);
  const listEl = document.getElementById("anti-library-list");
  const lang = getPageLang();
  if (listEl) {
    listEl.innerHTML = `<p class="photo-card__error">${t("library_list_error", lang)}</p>`;
  }
});
