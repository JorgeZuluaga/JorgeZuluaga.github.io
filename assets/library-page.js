import {
  applyThemeAriaFromLang,
  getPageLang,
  t,
  withLangQuery,
} from "./i18n.js";
import { applyHeaderLangChrome, applyLibrarySectionNav } from "./library-nav.js";
import {
  bindCoverImage,
  buildDetailsIsbnByBookId,
  collectBookCoverCandidates,
} from "./library-covers.js";
import { trackEvent, trackPageView } from "./visitor-tracker.js";

const LIBRARY_JSON = "./info/library.json";
const LIBRARY_DETAILS_JSON = "./info/library-details.json";
const BOOK_SERIES_JSON = "./info/book_series.json";
const LOCAL_LIKES_CACHE_PREFIX = "review_local_likes_count_";
const REVIEW_LIKE_CLICKED_PREFIX = "review_like_clicked_";
const LIBRARY_LIST_EXPANDED_COUNT = 50;
const FEATURED_REVIEW_CANDIDATE_LIMIT = 10;
const FEATURED_REVIEW_MIN_GOODREADS_LIKES = 1;
const FEATURED_REVIEW_MIN_WORDS = 250;
const FEATURED_REVIEW_EXCERPT_MAX = 600;

const LIBRARY_HOME_JUMP_LINKS = [
  ["library-home-jump-featured", "library-featured-review-card", "library_home_jump_featured"],
  ["library-home-jump-latest-reviews", "library-section-latest-reviews", "library_home_jump_latest_reviews"],
  ["library-home-jump-latest-read", "library-section-latest-read", "library_home_jump_latest_read"],
  ["library-home-jump-top-reviewed", "library-section-top-reviewed", "library_home_jump_top_reviewed"],
  ["library-home-jump-top50", "library-section-top50", "library_home_jump_top50"],
  ["library-home-jump-year", "library-section-year-chart", "library_home_jump_by_year"],
];

function buildDetailsBookIdSet(detailsBooks) {
  const set = new Set();
  for (const row of detailsBooks || []) {
    const bid = String(row?.bookId || "").trim();
    if (bid) set.add(bid);
  }
  return set;
}

/** Hidden duplicates (manual cataloguing): keep in JSON but omit from lists and aggregate stats. */
function isLibraryDuplicateHidden(item) {
  const v = item?.libraryDuplicateHidden;
  return v === true || v === 1 || v === "1";
}

function parseDate(dateText) {
  const raw = String(dateText ?? "").trim();
  if (!raw) return null;
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** BookBuddy / CSV-style dates (aligned with antibiblioteca catalog totals). */
function parseBookBuddyDate(value) {
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

/** Reseña con texto (JSON hasReview o conteo local; evita placeholder del mirror ~11 palabras). */
function hasReview(item) {
  if (!String(item?.reviewUrl ?? "").includes("/review/show/")) return false;
  if (item?.hasReview === false) return false;
  if (item?.hasReview === true) return true;
  const wc = Number(item?.reviewCount);
  if (Number.isFinite(wc)) return wc >= 25;
  return true;
}

function normalizeBooks(rawBooks) {
  return [...(rawBooks ?? [])]
    .filter((b) => b && b.title)
    .map((b) => ({
      ...b,
      _date: parseBookBuddyDate(b.dateRead) ?? parseDate(b.dateRead),
      _dateRead: parseBookBuddyDate(b.dateRead),
      _dateAdded: parseBookBuddyDate(b.dateAdded),
      _reviewDate: parseBookBuddyDate(b.reviewDate) ?? parseDate(b.reviewDate),
      rating: Number.isFinite(Number(b.rating)) ? Number(b.rating) : 0,
      reviewLikes: Number.isFinite(Number(b.reviewLikes)) ? Number(b.reviewLikes) : 0,
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
  const dr = String(book?.dateRead || "").trim();
  if (dr) return true;
  const r = Number(book?.rating);
  if (Number.isFinite(r) && r > 0) return true;
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
    _dateAdded: parseBookBuddyDate(dateAdded),
  };
}

function computeCatalogSummary(booksNormalized, detailsRows) {
  const readIdentity = new Set(
    booksNormalized.filter((b) => isReadBook(b)).map((b) => bookIdentityKey(b)).filter(Boolean),
  );
  const libraryByBookId = buildLibraryBookIdMap(booksNormalized);

  if (detailsRows.length > 0) {
    const antiBooks = detailsRows
      .filter((row) => row && typeof row === "object")
      .filter((row) => !isLibraryDuplicateHidden(row))
      .filter((row) => statusIsUnreadRow(row))
      .filter((row) => !isDetailsRowCountedAsReadOnGoodreads(row, libraryByBookId, readIdentity))
      .map((row) => detailsRowToAntiBook(row))
      .filter((b) => b.title);
    const catalogUnread = antiBooks.length;
    const catalogReadCount = booksNormalized.filter((b) => !isLibraryDuplicateHidden(b)).length;
    const catalogTotal = catalogUnread + catalogReadCount;
    return { catalogTotal, catalogUnread, catalogReadCount };
  }

  const antiBooksLen = booksNormalized
    .filter((b) => !isLibraryDuplicateHidden(b))
    .filter((b) => !isReadBook(b))
    .filter((b) => !readIdentity.has(bookIdentityKey(b))).length;
  const readBooksLen = booksNormalized
    .filter((b) => isReadBook(b))
    .filter((b) => !isLibraryDuplicateHidden(b)).length;
  return {
    catalogTotal: readBooksLen + antiBooksLen,
    catalogUnread: antiBooksLen,
    catalogReadCount: readBooksLen,
  };
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

function reviewIdNumber(reviewUrl) {
  const n = Number(parseReviewIdFromUrl(reviewUrl));
  return Number.isFinite(n) ? n : 0;
}

/** reviewDate descendente; empate por id de reseña en Goodreads (mayor = más reciente). */
function compareReviewsByRecency(a, b) {
  const dateA = a._reviewDate?.getTime() ?? 0;
  const dateB = b._reviewDate?.getTime() ?? 0;
  if (dateB !== dateA) return dateB - dateA;
  return reviewIdNumber(b.reviewUrl) - reviewIdNumber(a.reviewUrl);
}

/** reviewLocalUrl en JSON, o ruta canónica del mirror (`./reviews/{id}.html`). */
function effectiveLocalReviewHref(item) {
  const explicit = String(item?.reviewLocalUrl || "").trim();
  if (explicit.endsWith(".html")) return explicit;
  const id = parseReviewIdFromUrl(item?.reviewUrl);
  if (!id) return "";
  return `./reviews/${id}.html`;
}

function reviewActionLabel(item, lang) {
  const n = Number(item?.reviewCount);
  if (Number.isFinite(n) && n < 100) {
    return t("library_view_minireview", lang);
  }
  return t("library_view_review", lang);
}

function goodreadsLikes(item) {
  return Number.isFinite(Number(item?.reviewLikes)) ? Number(item.reviewLikes) : 0;
}

function localReactionLikes(item) {
  return Number.isFinite(Number(item?.reviewLocalLikes)) ? Number(item.reviewLocalLikes) : 0;
}

function reactionSum(item) {
  return goodreadsLikes(item) + localReactionLikes(item);
}

function featuredDrzScore(item) {
  const drzRaw = item?.drzrating;
  if (drzRaw === undefined || drzRaw === -1 || !Number.isFinite(Number(drzRaw))) return 0;
  const drz = Number(drzRaw);
  return drz > 0 ? drz : 0;
}

function featuredClassifierScore(item, maxReactionSum) {
  if (!maxReactionSum || maxReactionSum <= 0) return 0;
  return (reactionSum(item) / maxReactionSum) * 100;
}

function featuredCombinedScore(item, maxReactionSum) {
  const classifier = featuredClassifierScore(item, maxReactionSum);
  const drz = featuredDrzScore(item);
  return (classifier + drz) / 2;
}

function featuredReviewWordCount(item) {
  const wordCount = Number(item?.reviewCount);
  return Number.isFinite(wordCount) ? wordCount : 0;
}

function isFeaturedReviewEligible(item) {
  return (
    goodreadsLikes(item) >= FEATURED_REVIEW_MIN_GOODREADS_LIKES &&
    featuredReviewWordCount(item) > FEATURED_REVIEW_MIN_WORDS
  );
}

function pickFeaturedReview(reviewedBooks) {
  const recent = [...reviewedBooks]
    .filter((item) => item._reviewDate && parseReviewIdFromUrl(item.reviewUrl))
    .sort(compareReviewsByRecency)
    .slice(0, FEATURED_REVIEW_CANDIDATE_LIMIT);
  const eligible = recent.filter(isFeaturedReviewEligible);
  if (!eligible.length) return null;

  const maxReactionSum = Math.max(...eligible.map((item) => reactionSum(item)));
  if (maxReactionSum <= 0) return null;

  eligible.sort((a, b) => {
    const scoreA = featuredCombinedScore(a, maxReactionSum);
    const scoreB = featuredCombinedScore(b, maxReactionSum);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return compareReviewsByRecency(a, b);
  });
  return eligible[0];
}

function htmlFragmentToPlainText(fragment) {
  const tmp = document.createElement("div");
  tmp.innerHTML = String(fragment || "").replace(/<br\s*\/?>/gi, "\n");
  return tmp.textContent
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractReviewBodyFromHtml(raw) {
  const match = String(raw || "").match(/<article\s+class="card"[^>]*>([\s\S]*?)<\/article>/i);
  if (!match) return "";
  return htmlFragmentToPlainText(match[1]);
}

function firstParagraphExcerpt(text, maxChars = FEATURED_REVIEW_EXCERPT_MAX) {
  const normalized = String(text || "")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const paragraph = normalized[0] || String(text || "").trim();
  if (!paragraph) return { excerpt: "", hasMore: false };
  const hasMoreParagraphs = normalized.length > 1;
  if (paragraph.length <= maxChars) {
    return { excerpt: paragraph, hasMore: hasMoreParagraphs };
  }
  const trimmed = paragraph.slice(0, maxChars - 1).replace(/\s+\S*$/, "");
  return { excerpt: trimmed, hasMore: true };
}

async function fetchFeaturedExcerpt(book) {
  const reviewId = parseReviewIdFromUrl(book?.reviewUrl);
  if (!reviewId) return { excerpt: "", hasMore: false };
  const localUrl = String(book?.reviewLocalUrl || "").trim();
  const path = localUrl || `./reviews/${reviewId}.html`;
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return { excerpt: "", hasMore: false };
    const raw = await res.text();
    return firstParagraphExcerpt(extractReviewBodyFromHtml(raw));
  } catch {
    return { excerpt: "", hasMore: false };
  }
}

function reviewLikeClickedKey(reviewId) {
  return `${REVIEW_LIKE_CLICKED_PREFIX}${reviewId}`;
}

async function copyTextToClipboard(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.setAttribute("readonly", "true");
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return Boolean(ok);
  } catch {
    return false;
  }
}

function showFeaturedShareToast(message) {
  const msg = String(message || "").trim();
  if (!msg) return;
  const existing = document.getElementById("library-featured-share-toast");
  const el = existing || document.createElement("div");
  el.id = "library-featured-share-toast";
  el.textContent = msg;
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.style.position = "fixed";
  el.style.left = "50%";
  el.style.top = "1rem";
  el.style.transform = "translateX(-50%)";
  el.style.zIndex = "9999";
  el.style.padding = "0.6rem 0.85rem";
  el.style.borderRadius = "999px";
  el.style.background = "rgba(0, 0, 0, 0.85)";
  el.style.color = "#fff";
  el.style.fontSize = "0.95rem";
  el.style.boxShadow = "0 10px 25px rgba(0,0,0,0.25)";
  el.style.maxWidth = "92vw";
  el.style.textAlign = "center";
  el.style.opacity = "0";
  el.style.transition = "opacity 160ms ease";
  if (!existing) document.body.appendChild(el);
  clearTimeout(el.__toastTimer);
  requestAnimationFrame(() => {
    el.style.opacity = "1";
  });
  el.__toastTimer = setTimeout(() => {
    el.style.opacity = "0";
  }, 1400);
}

function styleFeaturedReviewActionButton(el, { primary = false } = {}) {
  el.style.display = "inline-flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.gap = "0.35rem";
  el.style.margin = "0";
  el.style.padding = primary ? "0.45rem 0.75rem" : "0.45rem 0.75rem";
  el.style.fontSize = "0.9rem";
  el.style.fontFamily = "inherit";
  el.style.fontWeight = "500";
  el.style.border = "1px solid color-mix(in srgb, var(--black) 22%, transparent)";
  el.style.borderRadius = "8px";
  el.style.background = "color-mix(in srgb, var(--black) 4%, var(--white))";
  el.style.color = "var(--black)";
  el.style.cursor = "pointer";
}

function updateFeaturedLikeButton(btn, count, liked, lang) {
  if (!btn) return;
  const safeCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
  btn.textContent = liked
    ? `${t("review_action_liked", lang)} (${safeCount})`
    : `${t("review_action_like", lang)} (${safeCount})`;
  btn.setAttribute("aria-label", `${t("review_action_like_aria", lang)} ${safeCount}`);
  btn.disabled = liked;
}

async function mountFeaturedReviewActions(article, { reviewId, reviewHref, book, lang }) {
  if (!article || !reviewId) return;

  const actions = document.createElement("div");
  actions.className = "library-featured-review__actions";
  actions.setAttribute("aria-label", lang === "en" ? "Review actions" : "Acciones de la reseña");

  const likeBtn = document.createElement("button");
  likeBtn.type = "button";
  likeBtn.id = "library-featured-review-like-btn";
  likeBtn.className = "library-featured-review__action-btn";
  styleFeaturedReviewActionButton(likeBtn, { primary: true });
  const liked = localStorage.getItem(reviewLikeClickedKey(reviewId)) === "1";
  const snapshotLikes = readSnapshotLocalLikes(book);
  updateFeaturedLikeButton(likeBtn, snapshotLikes ?? 0, liked, lang);
  actions.appendChild(likeBtn);

  const shareUrl = new URL(reviewHref, window.location.href).toString();
  const shareBtn = document.createElement("button");
  shareBtn.type = "button";
  shareBtn.className = "library-featured-review__action-btn";
  styleFeaturedReviewActionButton(shareBtn);
  shareBtn.setAttribute("aria-label", t("review_action_share", lang));
  shareBtn.innerHTML = `<span data-share-label>${t("review_action_share", lang)}</span>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M8 12v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="M12 16V3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="M8.5 6.5 12 3l3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`;
  shareBtn.addEventListener("click", async () => {
    const ok = await copyTextToClipboard(shareUrl);
    const label = shareBtn.querySelector("[data-share-label]");
    if (label) {
      const prev = label.textContent;
      label.textContent = ok ? t("review_action_copied", lang) : t("review_action_share", lang);
      setTimeout(() => {
        label.textContent = prev;
      }, 1200);
    }
    if (ok) showFeaturedShareToast(t("review_action_share_toast", lang));
  });
  actions.appendChild(shareBtn);

  const subscribeBtn = document.createElement("button");
  subscribeBtn.type = "button";
  subscribeBtn.className = "library-featured-review__action-btn";
  styleFeaturedReviewActionButton(subscribeBtn);
  subscribeBtn.setAttribute("aria-label", t("review_action_subscribe_aria", lang));
  subscribeBtn.innerHTML = `<span>${t("review_action_subscribe", lang)}</span>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <rect x="2" y="4" width="20" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect>
      <path d="m2 7 10 7 10-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>`;
  subscribeBtn.addEventListener("click", () => {
    document.getElementById("review-subscribe-open")?.click();
  });
  actions.appendChild(subscribeBtn);

  article.appendChild(actions);

  const base = workerBaseFromLogEndpoint();
  if (!base) return;

  let initialCount = await fetchLocalLikeCount(base, reviewId);
  if (initialCount === null) initialCount = snapshotLikes ?? 0;
  updateFeaturedLikeButton(likeBtn, initialCount, liked, lang);

  likeBtn.addEventListener("click", async () => {
    likeBtn.disabled = true;
    try {
      const response = await fetch(`${base}/review-like`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId,
          page: location.pathname,
          url: location.href,
        }),
        mode: "cors",
        credentials: "omit",
      });
      if (!response.ok) throw new Error("like failed");
      const data = await response.json();
      const count = Number.isFinite(Number(data?.count)) ? Number(data.count) : initialCount;
      localStorage.setItem(reviewLikeClickedKey(reviewId), "1");
      writeCachedLocalLikes(reviewId, count);
      updateFeaturedLikeButton(likeBtn, count, true, lang);
      const localSpan = article.querySelector("[data-local-likes-for]");
      if (localSpan) localSpan.textContent = `👏 ${count}`;
      if (data?.alreadyLiked) {
        trackEvent("review_like_already_liked", { reviewId, count, alreadyLiked: true });
      } else {
        trackEvent("review_like_click", { reviewId, count, alreadyLiked: false });
      }
    } catch {
      likeBtn.disabled = liked;
    }
  });
}

function ratingStarsElement(rating) {
  const value = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  if (!value) return null;
  const span = document.createElement("span");
  span.className = "library-featured-review__stars library-tooltip";
  span.setAttribute("data-title", "");
  span.textContent = "★".repeat(value) + "☆".repeat(5 - value);
  return span;
}

async function renderFeaturedReview(container, book, lang, cardEl) {
  if (!container) return;
  if (!book) {
    container.replaceChildren();
    if (cardEl) cardEl.hidden = true;
    return;
  }

  const reviewId = parseReviewIdFromUrl(book.reviewUrl);
  const reviewHref = withLangQuery(effectiveLocalReviewHref(book) || `./reviews/${reviewId}.html`);
  const coverSrc = String(book.reviewLocalCoverUrl || `./reviews/covers/${reviewId}.jpg`).trim();
  const author = String(book.author || "").trim();
  const byPrefix = t("library_by_author", lang).replace(/:$/, "").trim();
  const { excerpt, hasMore } = await fetchFeaturedExcerpt(book);

  container.replaceChildren();
  if (cardEl) cardEl.hidden = false;

  const article = document.createElement("article");
  article.className = "library-featured-review";

  if (coverSrc) {
    const coverLink = document.createElement("a");
    coverLink.className = "library-featured-review__cover-link";
    coverLink.href = reviewHref;
    const img = document.createElement("img");
    img.src = coverSrc;
    img.alt = String(book.title || "");
    img.loading = "lazy";
    img.decoding = "async";
    img.width = 160;
    coverLink.appendChild(img);
    article.appendChild(coverLink);
  }

  const title = document.createElement("h3");
  title.className = "library-featured-review__title";
  const titleLink = document.createElement("a");
  titleLink.className = "link";
  titleLink.href = reviewHref;
  titleLink.textContent = String(book.title || "");
  title.appendChild(titleLink);
  article.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "library-featured-review__meta";
  const metaBits = [];
  if (author) {
    const authorBit = document.createElement("span");
    authorBit.textContent = `${byPrefix} ${author}`;
    metaBits.push(authorBit);
  }
  const stars = ratingStarsElement(book.rating);
  if (stars) {
    stars.setAttribute("data-title", t("library_rating_gr_hover", lang));
    metaBits.push(stars);
  }
  for (const bit of metaBits) {
    if (meta.childElementCount > 0) {
      meta.appendChild(document.createTextNode(" · "));
    }
    meta.appendChild(bit);
  }
  if (meta.childElementCount > 0) article.appendChild(meta);

  const byline = document.createElement("p");
  byline.className = "library-featured-review__byline";
  const bylineEm = document.createElement("em");
  bylineEm.textContent = t("library_featured_review_byline", lang);
  byline.appendChild(bylineEm);
  article.appendChild(byline);

  if (excerpt) {
    const excerptEl = document.createElement("p");
    excerptEl.className = "library-featured-review__excerpt";
    excerptEl.textContent = excerpt;
    if (hasMore) {
      const more = document.createElement("span");
      more.className = "library-featured-review__excerpt-more";
      more.setAttribute("aria-hidden", "true");
      more.textContent = "…";
      excerptEl.appendChild(more);
    }
    article.appendChild(excerptEl);
  }

  const stats = document.createElement("p");
  stats.className = "library-featured-review__stats";
  const statBits = [];
  if (book.drzrating !== undefined && book.drzrating !== -1) {
    const drzWrap = document.createElement("span");
    const drzLabel = document.createElement("strong");
    drzLabel.textContent = `${t("library_rating_drz", lang)} `;
    drzWrap.appendChild(drzLabel);
    const drzValue = document.createElement("span");
    drzValue.className = "library-tooltip";
    drzValue.setAttribute("data-title", t("library_rating_drz_hover", lang));
    drzValue.textContent = `🤓 ${String(book.drzrating)}`;
    drzWrap.appendChild(drzValue);
    statBits.push(drzWrap);
  }

  const reactionBits = [];
  const grLikes = Number(book.reviewLikes);
  if (String(book.reviewUrl || "").includes("/review/show/") && Number.isFinite(grLikes)) {
    const likesSpan = document.createElement("span");
    likesSpan.className = "library-tooltip";
    likesSpan.setAttribute("data-title", t("library_likes_gr_hover", lang));
    likesSpan.textContent = `👍 ${grLikes}`;
    reactionBits.push(likesSpan);
  }
  if (reviewId) {
    const localSpan = document.createElement("span");
    localSpan.className = "library-tooltip";
    localSpan.setAttribute("data-title", t("library_likes_local_hover", lang));
    localSpan.setAttribute("data-local-likes-for", reviewId);
    const snapshotLikes = readSnapshotLocalLikes(book);
    localSpan.textContent = snapshotLikes === null ? "👏 —" : `👏 ${snapshotLikes}`;
    reactionBits.push(localSpan);
  }
  if (reactionBits.length > 0) {
    const reactionsWrap = document.createElement("span");
    const reactionsLabel = document.createElement("strong");
    reactionsLabel.textContent = `${t("library_featured_review_reactions", lang)} `;
    reactionsWrap.appendChild(reactionsLabel);
    reactionBits.forEach((bit, index) => {
      if (index > 0) reactionsWrap.appendChild(document.createTextNode(" · "));
      reactionsWrap.appendChild(bit);
    });
    statBits.push(reactionsWrap);
  }
  for (const bit of statBits) {
    if (stats.childElementCount > 0) {
      stats.appendChild(document.createTextNode(" · "));
    }
    stats.appendChild(bit);
  }
  if (stats.childElementCount > 0) article.appendChild(stats);

  await mountFeaturedReviewActions(article, { reviewId, reviewHref, book, lang });

  const readWrap = document.createElement("p");
  readWrap.className = "library-featured-review__read";
  const readLink = document.createElement("a");
  readLink.className = "link library-featured-review__read-link";
  readLink.href = reviewHref;
  readLink.textContent = `${t("library_featured_review_read", lang)} →`;
  readWrap.appendChild(readLink);
  article.appendChild(readWrap);

  container.appendChild(article);
  await hydrateLocalLikes(container, [book], lang);
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

  renderLocalLikesInContainer(container, counts, lang);
}

async function hydrateTotalLocalLikes(totalEl, reviewedItems) {
  if (!totalEl || !Array.isArray(reviewedItems)) return;
  let total = 0;
  for (const item of reviewedItems) {
    const fromSnapshot = readSnapshotLocalLikes(item);
    const fromCache = readCachedLocalLikes(parseReviewIdFromUrl(item?.reviewUrl));
    const count = pickBestKnownLocalLikes(fromSnapshot, fromCache);
    if (count !== null) total += count;
  }
  totalEl.textContent = String(total);
}

function renderBookList(container, items, lang, seriesMap = new Map(), options = {}) {
  const dateLabelKey = String(options.dateLabelKey || "library_date_read");
  const dateValueSelector = typeof options.dateValueSelector === "function"
    ? options.dateValueSelector
    : ((item) => item.dateRead || item.dateAdded || "");
  const detailsBookIdSet = options.detailsBookIdSet instanceof Set ? options.detailsBookIdSet : null;
  const detailsIsbnByBookId =
    options.detailsIsbnByBookId instanceof Map ? options.detailsIsbnByBookId : null;
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
    const localReviewHref = effectiveLocalReviewHref(item);
    const hasReviewUrl = reviewUrl.includes("/review/show/");
    const hasLocalReview = Boolean(localReviewHref);
    const reviewId = parseReviewIdFromUrl(item.reviewUrl);
    const publishedReview = hasReview(item);
    const hasAnyReviewUrl = hasLocalReview || hasReviewUrl;

    let actionsHtml = "";
    const grBookId = String(item.bookId || "").trim();

    if (grBookId && detailsBookIdSet?.has(grBookId)) {
      const descHref = withLangQuery(
        `./book.html?bookid=${encodeURIComponent(grBookId)}`,
      );
      actionsHtml += `<a class="link" href="${escapeLibrary(descHref)}">${escapeLibrary(t("library_view_description_complete", lang))}</a>`;
    }

    if (publishedReview && hasLocalReview) {
      if (actionsHtml) actionsHtml += " · ";
      actionsHtml += `<a class="link" href="${escapeLibrary(localReviewHref)}">${escapeLibrary(reviewActionLabel(item, lang))}</a>`;
    } else if (publishedReview && hasReviewUrl) {
      if (actionsHtml) actionsHtml += " · ";
      actionsHtml += `<a class="link" href="${escapeLibrary(reviewUrl)}" target="_blank" rel="noopener noreferrer">${escapeLibrary(reviewActionLabel(item, lang))}</a>`;
    }

    if (actionsHtml) {
      if (publishedReview && hasAnyReviewUrl) {
        const reactionsText = t("library_reactions", lang);
        const likesCount = Number.isFinite(Number(item.reviewLikes)) ? item.reviewLikes : 0;
        actionsHtml += ` · ${reactionsText} <span class="library-tooltip" data-title="${escapeLibrary(t("library_likes_gr_hover", lang))}">👍 ${likesCount}</span>${localLikesSuffixHtml(reviewId, lang)}`;
      }
      actions.innerHTML = actionsHtml;
      actions.setAttribute("aria-label", t("library_book_links", lang));
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
    
    const candidates = collectBookCoverCandidates(item, { detailsIsbnByBookId });
    bindCoverImage(img, candidates);
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
    allBooksLink.href = withLangQuery("./biblioteca-leidos.html");
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

  applyHeaderLangChrome(lang, {
    esId: "lib-lang-es",
    enId: "lib-lang-en",
    hrefEs: "./biblioteca.html",
    hrefEn: "./biblioteca.html?lang=en",
  });

  const skip = document.querySelector(".skip-link");
  if (skip) skip.textContent = t("skip", lang);

  document.querySelectorAll(".theme-button").forEach((btn) => {
    btn.setAttribute("aria-label", t("theme_toggle", lang));
  });
  applyThemeAriaFromLang(lang);

  const statsRoot = document.getElementById("library-stats-root");
  if (statsRoot) {
    statsRoot.setAttribute("aria-label", t("library_home_stats_root_aria", lang));
  }
  const grStatsSec = document.getElementById("library-goodreads-stats-section");
  if (grStatsSec) {
    grStatsSec.setAttribute(
      "aria-label",
      lang === "en" ? "Goodreads reading statistics" : "Estadísticas de lectura en Goodreads",
    );
  }
  const catTotalLab = document.getElementById("library-catalog-total-label");
  if (catTotalLab) catTotalLab.textContent = t("antilibrary_stats_total", lang);
  const catUnreadLab = document.getElementById("library-catalog-unread-label");
  if (catUnreadLab) catUnreadLab.textContent = t("antilibrary_stats_unread", lang);
  const catReadLab = document.getElementById("library-catalog-read-label");
  if (catReadLab) catReadLab.textContent = t("antilibrary_stats_read", lang);
  const grRevLab = document.getElementById("library-gr-label-reviewed");
  if (grRevLab) grRevLab.textContent = t("library_reviewed", lang);
  const grLikesLab = document.getElementById("library-gr-label-likes-gr");
  if (grLikesLab) grLikesLab.textContent = t("library_likes", lang);
  const grLocalLab = document.getElementById("library-gr-label-likes-local");
  if (grLocalLab) grLocalLab.textContent = t("library_likes_local_total", lang);

  const hYear = document.getElementById("library-h2-year");
  if (hYear) hYear.textContent = t("library_by_year", lang);
  const hLatest = document.getElementById("library-h2-latest");
  if (hLatest) hLatest.textContent = t("library_latest", lang);
  const hTop = document.getElementById("library-h2-top");
  if (hTop) hTop.textContent = t("library_top10", lang);
  const hLatestReviews = document.getElementById("library-h2-latest-reviews");
  if (hLatestReviews) hLatestReviews.textContent = t("library_latest_reviews_written", lang);
  const hFeaturedReview = document.getElementById("library-h2-featured-review");
  if (hFeaturedReview) hFeaturedReview.textContent = t("library_featured_review_title", lang);
  const hTop50 = document.getElementById("library-h2-top50");
  if (hTop50) hTop50.textContent = t("library_top50_title", lang);

  const jumpNav = document.getElementById("library-home-jump-nav");
  if (jumpNav) jumpNav.setAttribute("aria-label", t("library_home_jump_nav_aria", lang));
  for (const [linkId, anchorId, titleKey] of LIBRARY_HOME_JUMP_LINKS) {
    const linkEl = document.getElementById(linkId);
    if (!linkEl) continue;
    linkEl.textContent = t(titleKey, lang);
    linkEl.setAttribute("href", `#${anchorId}`);
  }

  const allLink = document.getElementById("btn-all-books");
  if (allLink) {
    allLink.textContent = t("library_show_all", lang);
    allLink.setAttribute("href", withLangQuery("./biblioteca-leidos.html"));
  }

  const antiLink = document.getElementById("btn-anti-library");
  if (antiLink) {
    antiLink.textContent = t("library_show_antilibrary", lang);
    antiLink.setAttribute("href", withLangQuery("./biblioteca-noleidos.html"));
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

  applyLibrarySectionNav(lang, null);
}

async function main() {
  const lang = getPageLang();
  trackPageView("library_page");
  applyLibraryChrome(lang);

  const res = await fetch(LIBRARY_JSON, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar ${LIBRARY_JSON} (${res.status})`);
  const data = await res.json();
  const [seriesData, detailsData] = await Promise.all([
    fetch(BOOK_SERIES_JSON, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { series: [] }))
      .catch(() => ({ series: [] })),
    fetch(LIBRARY_DETAILS_JSON, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { books: [] }))
      .catch(() => ({ books: [] })),
  ]);
  const detailsBooks = detailsData.books ?? [];
  const detailsBookIdSet = buildDetailsBookIdSet(detailsBooks);
  const detailsIsbnByBookId = buildDetailsIsbnByBookId(detailsBooks);
  const listRenderOpts = { detailsBookIdSet, detailsIsbnByBookId };

  const titleEl = document.getElementById("library-page-title");
  const introEl = document.getElementById("library-page-intro");
  const goodreadsNoteEl = document.getElementById("library-goodreads-note");
  const profileEl = document.getElementById("goodreads-profile-link");
  const sourceEl = document.getElementById("library-source-note");
  const catalogTotalEl = document.getElementById("library-catalog-total");
  const catalogUnreadEl = document.getElementById("library-catalog-unread");
  const catalogReadEl = document.getElementById("library-catalog-read");
  const grReviewedEl = document.getElementById("library-gr-val-reviewed");
  const totalLikesEl = document.getElementById("library-gr-val-likes-gr");
  const totalLocalLikesEl = document.getElementById("library-gr-val-likes-local");
  const chartEl = document.getElementById("library-yearly-chart");
  const latestReadEl = document.getElementById("library-latest-read");
  const topReviewedEl = document.getElementById("library-top-reviewed");
  const latestReviewedEl = document.getElementById("library-latest-reviewed");
  const featuredReviewCardEl = document.getElementById("library-featured-review-card");
  const featuredReviewEl = document.getElementById("library-featured-review");
  const top50El = document.getElementById("library-top50");
  if (
    !titleEl ||
    !introEl ||
    !goodreadsNoteEl ||
    !profileEl ||
    !sourceEl ||
    !catalogTotalEl ||
    !catalogUnreadEl ||
    !catalogReadEl ||
    !grReviewedEl ||
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

  const booksAll = normalizeBooks(data.books);
  const detailsRows = Array.isArray(detailsData?.books) ? detailsData.books : [];
  const { catalogTotal, catalogUnread, catalogReadCount } = computeCatalogSummary(booksAll, detailsRows);

  const books = booksAll.filter((b) => !isLibraryDuplicateHidden(b));
  const readBooks = books.filter((b) => b._date);

  const booksReadForGrStats = [...(data.books ?? [])]
    .filter((b) => b && b.title)
    .filter((b) => !isLibraryDuplicateHidden(b))
    .map((b) => ({ ...b, _date: parseDate(b.dateRead) }))
    .filter((b) => b._date);
  const reviewedGr = booksReadForGrStats.filter((b) => hasReview(b));
  const reviewedReviewIds = new Set(
    reviewedGr.map((b) => parseReviewIdFromUrl(b.reviewUrl)).filter(Boolean),
  );

  const rows = computeYearlyReads(readBooks);
  const latestReadNoReview = [...readBooks]
    .filter((b) => b._date && !hasReview(b))
    .filter((b) => {
      const reviewId = parseReviewIdFromUrl(b.reviewUrl);
      return !reviewId || !reviewedReviewIds.has(reviewId);
    })
    .sort((a, b) => b._date - a._date)
    .slice(0, LIBRARY_LIST_EXPANDED_COUNT);
  const reviewed = readBooks.filter((b) => hasReview(b));
  const topReviewedByLikes = [...reviewed]
    .sort((a, b) => {
      if (b.reviewLikes !== a.reviewLikes) return b.reviewLikes - a.reviewLikes;
      if (b.rating !== a.rating) return b.rating - a.rating;
      return (b._date?.getTime() ?? 0) - (a._date?.getTime() ?? 0);
    })
    .slice(0, LIBRARY_LIST_EXPANDED_COUNT);
  const featuredBook = pickFeaturedReview(reviewed);
  const featuredReviewId = featuredBook ? parseReviewIdFromUrl(featuredBook.reviewUrl) : "";
  const latestReviewsWritten = [...reviewed]
    .filter((b) => b._reviewDate)
    .filter((b) => b.hasReview !== false)
    .filter((b) => !featuredReviewId || parseReviewIdFromUrl(b.reviewUrl) !== featuredReviewId)
    .sort(compareReviewsByRecency);

  const topFavorite = [...readBooks]
    .filter((b) => typeof b.drzrating === "number" && b.drzrating > 0)
    .sort((a, b) => {
      if (b.drzrating !== a.drzrating) return b.drzrating - a.drzrating;
      return (b._date?.getTime() ?? 0) - (a._date?.getTime() ?? 0);
    })
    .slice(0, LIBRARY_LIST_EXPANDED_COUNT);

  const totalReviewedGr = reviewedGr.length;
  const reviewedPctOfCatalog = catalogTotal ? (totalReviewedGr / catalogTotal) * 100 : 0;
  const totalLikesGr = reviewedGr.reduce(
    (acc, b) => acc + (Number.isFinite(Number(b.reviewLikes)) ? Number(b.reviewLikes) : 0),
    0,
  );

  const unreadPctStr = catalogTotal > 0 ? ((catalogUnread / catalogTotal) * 100).toFixed(1) : "0.0";
  const readPctStr = catalogTotal > 0 ? ((catalogReadCount / catalogTotal) * 100).toFixed(1) : "0.0";

  titleEl.textContent = t("library_title", lang);
  introEl.textContent = t("library_intro", lang);
  goodreadsNoteEl.textContent = t("library_goodreads_note", lang);
  profileEl.href = "https://www.goodreads.com/user/show/91991657";
  profileEl.textContent = t("library_profile", lang);
  const subTitle = document.getElementById("review-subscribe-title");
  if (subTitle) subTitle.textContent = t("library_subscribe_title", lang);
  const subIntro = document.getElementById("review-subscribe-intro");
  if (subIntro) subIntro.textContent = t("library_subscribe_intro", lang);
  const subLabel = document.querySelector('label[for="review-subscribe-email"]');
  if (subLabel) subLabel.textContent = t("library_subscribe_email_label", lang);
  const subSubmit = document.getElementById("review-subscribe-submit");
  if (subSubmit) subSubmit.textContent = t("library_subscribe_submit", lang);
  const subCancel = document.getElementById("review-subscribe-cancel");
  if (subCancel) subCancel.textContent = t("library_subscribe_cancel", lang);
  const subClose = document.getElementById("review-subscribe-close");
  if (subClose) subClose.setAttribute("aria-label", lang === "en" ? "Close" : "Cerrar");
  sourceEl.textContent = "";
  catalogTotalEl.textContent = String(catalogTotal);
  catalogUnreadEl.textContent = `${catalogUnread} (${unreadPctStr}%)`;
  catalogReadEl.textContent = `${catalogReadCount} (${readPctStr}%)`;
  grReviewedEl.textContent = `${totalReviewedGr} (${reviewedPctOfCatalog.toFixed(1)}%)`;
  totalLikesEl.textContent = `${totalLikesGr}`;
  totalLocalLikesEl.textContent = "0";

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

  await renderFeaturedReview(featuredReviewEl, featuredBook, lang, featuredReviewCardEl);

  addListToggleControls(latestReviewedEl, latestReviewsWritten, lang, seriesMap, {
    initialCount: 5,
    expandedCount: LIBRARY_LIST_EXPANDED_COUNT,
    showMoreKey: "library_show_latest_20",
    showLessKey: "library_show_latest_5",
    includeAllBooksLink: true,
    renderOptions: {
      ...listRenderOpts,
      dateLabelKey: "library_review_date",
      dateValueSelector: (item) => item.reviewDate || "",
    },
  });
  addListToggleControls(latestReadEl, latestReadNoReview, lang, seriesMap, {
    initialCount: 5,
    expandedCount: LIBRARY_LIST_EXPANDED_COUNT,
    showMoreKey: "library_show_latest_20",
    showLessKey: "library_show_latest_5",
    includeAllBooksLink: true,
    renderOptions: listRenderOpts,
  });
  addListToggleControls(topReviewedEl, topReviewedByLikes, lang, seriesMap, {
    initialCount: 5,
    expandedCount: LIBRARY_LIST_EXPANDED_COUNT,
    showMoreKey: "library_show_top_20",
    showLessKey: "library_show_latest_5",
    includeAllBooksLink: true,
    renderOptions: listRenderOpts,
  });
  addListToggleControls(top50El, topFavorite, lang, seriesMap, {
    initialCount: 5,
    expandedCount: LIBRARY_LIST_EXPANDED_COUNT,
    showMoreKey: "library_show_top_20",
    showLessKey: "library_show_latest_5",
    includeAllBooksLink: true,
    renderOptions: listRenderOpts,
  });
  hydrateTotalLocalLikes(totalLocalLikesEl, reviewedGr).catch(() => {});
}

main().catch((err) => {
  console.error(err);
  const chartEl = document.getElementById("library-yearly-chart");
  const lang = getPageLang();
  if (chartEl) {
    chartEl.innerHTML = `<p class="photo-card__error">${t("library_stats_error", lang)}</p>`;
  }
});
