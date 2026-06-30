import { getPageLang } from "./i18n.js";
import { applyLibrarySectionNav } from "./library-nav.js";
import { trackEvent, trackPageView } from "./visitor-tracker.js";

applyLibrarySectionNav(getPageLang(), null, "../");

function trackReviewVisit() {
  trackPageView("review_page");
}

function getCurrentReviewId() {
  const parts = window.location.pathname.split("/");
  const fileName = parts[parts.length - 1] || "";
  const match = fileName.match(/^(\d+)\.html$/);
  return match ? match[1] : "";
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

function likesStorageKey(reviewId) {
  return `review_like_clicked_${reviewId}`;
}

function isEnglishPage() {
  return String(document.documentElement.lang || "").toLowerCase().startsWith("en");
}

function uiText() {
  if (isEnglishPage()) {
    return {
      like: "Like",
      liked: "You like",
      likeAria: "Like. Total",
      share: "Share",
      copied: "Copied",
      copiedToast: "Link copied to clipboard",
      subscribe: "Subscribe",
      subscribeAria: "Subscribe to new review email alerts",
      buscalibreLabel: "Get it on",
      buscalibreBuy: "Get it on Buscalibre",
      localLikesAria: "Local likes:",
      localLikesSuffix: "(local likes)",
    };
  }
  return {
    like: "Me gusta",
    liked: "Te gusta",
    likeAria: "Me gusta. Total",
    share: "Compartir",
    copied: "Copiado",
    copiedToast: "Enlace copiado a portapapeles",
    subscribe: "Suscribirse",
    subscribeAria: "Suscribirse a nuevas reseñas por correo",
    buscalibreLabel: "Consíguelo en",
    buscalibreBuy: "Consíguelo en Buscalibre",
    localLikesAria: "Me gusta locales:",
    localLikesSuffix: "(me gusta locales)",
  };
}

function shareUrlFromMeta() {
  const meta = document.querySelector('meta[name="share-url"]');
  const direct = meta ? String(meta.getAttribute("content") || "").trim() : "";
  if (direct) return direct;
  // Fallbacks so the share UI always shows, even if no shortlink was generated yet.
  const og = document.querySelector('meta[property="og:url"]');
  const ogValue = og ? String(og.getAttribute("content") || "").trim() : "";
  if (ogValue) return ogValue;
  try {
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

async function copyToClipboard(text) {
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

function showToast(message) {
  const msg = String(message || "").trim();
  if (!msg) return;
  const existing = document.getElementById("share-toast");
  const el = existing || document.createElement("div");
  el.id = "share-toast";
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

function updateLikesInPage(likesValue) {
  const likesNode = document.querySelector(".likes");
  if (!likesNode) return;
  const likes = Number.isFinite(Number(likesValue)) ? Math.max(0, Number(likesValue)) : 0;
  const link = likesNode.querySelector("a");
  if (link) {
    likesNode.setAttribute("aria-label", `Likes en GoodReads: ${likes}`);
    likesNode.innerHTML = "";
    likesNode.appendChild(link);
    likesNode.append(` ${likes}`);
    return;
  }
  likesNode.textContent = `👍 ${likes}`;
}

function updateLocalLikesInPage(count) {
  const text = uiText();
  const safeCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
  let localNode = document.querySelector(".likes-local-inline");
  if (!localNode) {
    const row = document.querySelector(".rating-row");
    if (!row) return;
    localNode = document.createElement("p");
    localNode.className = "likes likes-local-inline";
    row.appendChild(localNode);
  }
  localNode.setAttribute("aria-label", `${text.localLikesAria} ${safeCount}`);
  localNode.textContent = `👏 ${safeCount}`;
}

async function hydrateReviewLikesFromLibrary() {
  const reviewId = getCurrentReviewId();
  if (!reviewId) return { localLikes: null };
  try {
    const response = await fetch("../info/library.json", { cache: "no-store" });
    if (!response.ok) return { localLikes: null };
    const library = await response.json();
    const books = Array.isArray(library?.books) ? library.books : [];
    const match = books.find((book) => parseReviewIdFromUrl(book?.reviewUrl) === reviewId);
    if (!match) return { localLikes: null };
    updateLikesInPage(match.reviewLikes);
    const localLikes = Number(match.reviewLocalLikes);
    if (Number.isFinite(localLikes)) {
      const safe = Math.max(0, localLikes);
      updateLocalLikesInPage(safe);
      return { localLikes: safe };
    }
    return { localLikes: null };
  } catch (_err) {
    // Non-critical: keep static likes from generated HTML.
    return { localLikes: null };
  }
}

function reviewSubscribeCtaEnabled() {
  const meta = document.querySelector('meta[name="review-subscribe-cta"]');
  if (!meta) return false;
  const value = String(meta.getAttribute("content") || "").trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "no";
}

function reviewBuscalibreCtaDisabled() {
  const meta = document.querySelector('meta[name="review-buscalibre-cta"]');
  if (!meta) return false;
  const value = String(meta.getAttribute("content") || "").trim().toLowerCase();
  return value === "0" || value === "false" || value === "no";
}

const BUSCALIBRE_LOGO_URL =
  "https://statics.cdn0.buscalibre.com/images/logos/20231208132739buscalibre.png";

function createBuscalibreBlock(url, bookTitle) {
  const text = uiText();
  const wrap = document.createElement("p");
  wrap.className = "review-buscalibre-wrap";

  const textLink = document.createElement("a");
  textLink.className = "link review-buscalibre-text-link";
  textLink.href = url;
  textLink.target = "_blank";
  textLink.rel = "noopener noreferrer sponsored";
  textLink.textContent = text.buscalibreLabel;
  textLink.setAttribute("aria-label", `${text.buscalibreBuy}: ${bookTitle}`);

  const logoLink = document.createElement("a");
  logoLink.id = "review-buscalibre-link";
  logoLink.className = "buscalibre-brand-link";
  logoLink.href = url;
  logoLink.target = "_blank";
  logoLink.rel = "noopener noreferrer sponsored";
  logoLink.setAttribute("aria-label", `${text.buscalibreBuy}: ${bookTitle}`);

  const mark = document.createElement("span");
  mark.className = "buscalibre-brand-link__mark";

  const logo = document.createElement("img");
  logo.className = "buscalibre-brand-link__logo";
  logo.src = BUSCALIBRE_LOGO_URL;
  logo.alt = "Buscalibre";
  logo.decoding = "async";
  logo.loading = "lazy";

  mark.appendChild(logo);
  logoLink.appendChild(mark);
  wrap.append(textLink, logoLink);
  return wrap;
}

function findGoodreadsLinksParagraph() {
  for (const paragraph of document.querySelectorAll("p")) {
    if (paragraph.querySelector('a[href*="goodreads.com/review/show"]')) {
      return paragraph;
    }
  }
  return null;
}

async function wireBuscalibreLink() {
  if (reviewBuscalibreCtaDisabled()) return;
  if (document.getElementById("review-buscalibre-link")) return;

  const goodreadsParagraph = findGoodreadsLinksParagraph();
  if (!goodreadsParagraph) return;

  const reviewId = getCurrentReviewId();
  if (!reviewId) return;

  try {
    const [libraryResponse, buscalibreResponse] = await Promise.all([
      fetch("../info/library.json", { cache: "no-store" }),
      fetch("../info/buscalibre.json", { cache: "no-store" }),
    ]);
    if (!libraryResponse.ok || !buscalibreResponse.ok) return;

    const library = await libraryResponse.json();
    const buscalibre = await buscalibreResponse.json();
    const books = Array.isArray(library?.books) ? library.books : [];
    const match = books.find((book) => parseReviewIdFromUrl(book?.reviewUrl) === reviewId);
    const bookId = String(match?.bookId || "").trim();
    if (!bookId) return;

    const entry = buscalibre?.books?.[bookId];
    const url = String(entry?.url || "").trim();
    if (!url) return;

    const bookTitle = String(entry?.title || match?.title || "").trim() || bookId;
    goodreadsParagraph.insertAdjacentElement(
      "afterend",
      createBuscalibreBlock(url, bookTitle),
    );
  } catch (_err) {
    // Non-critical: keep page without Buscalibre CTA.
  }
}

function bibliotecaSubscribeHref() {
  const params = new URLSearchParams();
  params.set("subscribe", "open");
  if (isEnglishPage()) params.set("lang", "en");
  return `../biblioteca.html?${params.toString()}`;
}

const REVIEW_HEADER_ICON_STYLE = "padding: 0; border: 0; background: transparent; cursor: pointer;";
const REVIEW_HEADER_SVG_STYLE = "vertical-align: -3px; margin-left: 0.35rem;";

const REVIEW_SUBSCRIBE_HEADER_MAIL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" style="${REVIEW_HEADER_SVG_STYLE}">
  <rect x="2" y="4" width="20" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect>
  <path d="m2 7 10 7 10-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
</svg>`;

function wireHeaderSubscribeIcon() {
  const text = uiText();
  const existing = document.getElementById("review-subscribe-header-btn");
  if (existing) {
    if (!existing.__subscribeBound) {
      existing.__subscribeBound = true;
      existing.setAttribute("aria-label", text.subscribeAria);
      existing.addEventListener("click", () => {
        window.location.href = bibliotecaSubscribeHref();
      });
    }
    return;
  }
  if (!reviewSubscribeCtaEnabled()) return;

  const reviewBy = document.querySelector(".review-by");
  if (!reviewBy) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "review-subscribe-header-btn";
  btn.className = "link";
  btn.setAttribute("style", REVIEW_HEADER_ICON_STYLE);
  btn.setAttribute("aria-label", text.subscribeAria);
  btn.innerHTML = REVIEW_SUBSCRIBE_HEADER_MAIL_ICON;
  btn.addEventListener("click", () => {
    window.location.href = bibliotecaSubscribeHref();
  });

  const shareBtn = reviewBy.querySelector('[data-share-copy="1"]');
  if (shareBtn) {
    shareBtn.insertAdjacentElement("afterend", btn);
  } else {
    reviewBy.appendChild(btn);
  }
}

const REVIEW_SUBSCRIBE_MAIL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
  <rect x="2" y="4" width="20" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect>
  <path d="m2 7 10 7 10-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
</svg>`;

function styleSecondaryReviewActionButton(el) {
  el.style.display = "inline-flex";
  el.style.alignItems = "center";
  el.style.gap = "0.35rem";
  el.style.padding = "0.45rem 0.75rem";
  el.style.fontSize = "0.9rem";
}

function appendSubscribeCta(wrap) {
  if (!wrap || !reviewSubscribeCtaEnabled()) return;
  if (document.getElementById("review-subscribe-cta")) return;

  const text = uiText();
  const subscribeBtn = document.createElement("button");
  subscribeBtn.id = "review-subscribe-cta";
  subscribeBtn.type = "button";
  subscribeBtn.className = "logs-refresh";
  styleSecondaryReviewActionButton(subscribeBtn);
  subscribeBtn.setAttribute("aria-label", text.subscribeAria);
  subscribeBtn.innerHTML = `<span>${text.subscribe}</span>${REVIEW_SUBSCRIBE_MAIL_ICON}`;
  subscribeBtn.addEventListener("click", () => {
    window.location.href = bibliotecaSubscribeHref();
  });
  wrap.appendChild(subscribeBtn);
}

function createReviewActionsWrap() {
  const host = document.getElementById("review-like-actions") || document.querySelector("article.card");
  if (!host) return null;
  const wrap = document.createElement("p");
  wrap.className = "likes likes-local review-action-bar";
  wrap.style.marginTop = "1rem";
  host.appendChild(wrap);
  return wrap;
}

function ensureSubscribeCta() {
  if (!reviewSubscribeCtaEnabled() || document.getElementById("review-subscribe-cta")) return;
  const wrap =
    document.getElementById("review-like-btn")?.parentElement ||
    document.querySelector("#review-like-actions .likes-local") ||
    createReviewActionsWrap();
  appendSubscribeCta(wrap);
}

function upsertLikeButtonUI(reviewId, initialCount = 0) {
  const text = uiText();
  const fixedHost = document.getElementById("review-like-actions");
  const card = document.querySelector("article.card");
  const host = fixedHost || card;
  if (!host || !reviewId) return;
  if (document.getElementById("review-like-btn")) return;

  const wrap = document.createElement("p");
  wrap.className = "likes likes-local review-action-bar";
  wrap.style.marginTop = "1rem";

  const btn = document.createElement("button");
  btn.id = "review-like-btn";
  btn.type = "button";
  btn.className = "logs-refresh";
  btn.style.padding = "0.45rem 0.75rem";
  btn.style.fontSize = "0.9rem";
  btn.textContent = `${text.like} (${initialCount})`;
  btn.setAttribute("aria-label", `${text.likeAria} ${initialCount}`);

  if (localStorage.getItem(likesStorageKey(reviewId)) === "1") {
    btn.disabled = true;
    btn.textContent = `${text.liked} (${initialCount})`;
  }

  wrap.appendChild(btn);

  const shareUrl = shareUrlFromMeta();
  if (shareUrl) {
    const shareBtn = document.createElement("button");
    shareBtn.type = "button";
    shareBtn.className = "logs-refresh";
    styleSecondaryReviewActionButton(shareBtn);
    shareBtn.setAttribute("aria-label", text.share);
    shareBtn.innerHTML = `<span data-share-label>${text.share}</span>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="M8 12v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M12 16V3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M8.5 6.5 12 3l3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>`;
    shareBtn.addEventListener("click", async () => {
      const ok = await copyToClipboard(shareUrl);
      const label = shareBtn.querySelector?.("[data-share-label]");
      if (label) {
        const prev = label.textContent;
        label.textContent = ok ? text.copied : text.share;
        setTimeout(() => {
          label.textContent = prev;
        }, 1200);
      }
      if (ok) showToast(text.copiedToast);
    });
    wrap.appendChild(shareBtn);
  }
  appendSubscribeCta(wrap);
  host.appendChild(wrap);
}

function updateLikeButtonCount(count, likedByMe = false) {
  const text = uiText();
  const btn = document.getElementById("review-like-btn");
  if (!btn) return;
  const safeCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
  btn.textContent = likedByMe ? `${text.liked} (${safeCount})` : `${text.like} (${safeCount})`;
  btn.setAttribute("aria-label", `${text.likeAria} ${safeCount}`);
}

async function fetchLikeCount(base, reviewId) {
  if (!base || !reviewId) return 0;
  try {
    const response = await fetch(`${base}/review-like-count/${reviewId}`, { cache: "no-store" });
    if (!response.ok) return 0;
    const data = await response.json();
    return Number.isFinite(Number(data?.count)) ? Number(data.count) : 0;
  } catch {
    return 0;
  }
}

async function wireReviewLikeButton() {
  const reviewId = getCurrentReviewId();
  if (!reviewId) return;
  const base = workerBaseFromLogEndpoint();
  if (!base) {
    ensureSubscribeCta();
    return;
  }

  const fromLibrary = await hydrateReviewLikesFromLibrary();
  let initialCount = await fetchLikeCount(base, reviewId);
  if (initialCount <= 0 && Number.isFinite(Number(fromLibrary?.localLikes))) {
    initialCount = Number(fromLibrary.localLikes);
  }
  updateLocalLikesInPage(initialCount);
  upsertLikeButtonUI(reviewId, initialCount);
  const btn = document.getElementById("review-like-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
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
      if (!response.ok) throw new Error("No se pudo registrar el like.");
      const data = await response.json();
      const count = Number.isFinite(Number(data?.count)) ? Number(data.count) : initialCount;
      localStorage.setItem(likesStorageKey(reviewId), "1");
      updateLocalLikesInPage(count);
      updateLikeButtonCount(count, true);
      const alreadyLiked = Boolean(data?.alreadyLiked);
      if (alreadyLiked) {
        trackEvent("review_like_already_liked", { reviewId, count, alreadyLiked });
      } else {
        trackEvent("review_like_click", { reviewId, count, alreadyLiked });
      }
    } catch {
      btn.disabled = false;
    }
  });
  ensureSubscribeCta();
}

trackReviewVisit();
wireReviewLikeButton();
// Wire the share icon near the author line (if present).
(() => {
  const shareUrl = shareUrlFromMeta();
  if (!shareUrl) return;
  const text = uiText();
  const btns = document.querySelectorAll('[data-share-copy="1"]');
  for (const btn of btns) {
    if (!btn || btn.__shareBound) continue;
    btn.__shareBound = true;
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const ok = await copyToClipboard(shareUrl);
      if (ok) showToast(text.copiedToast);
      // No UI feedback here: it’s just an icon.
    });
    btn.setAttribute("aria-label", text.share);
  }
})();

wireHeaderSubscribeIcon();
wireBuscalibreLink();

