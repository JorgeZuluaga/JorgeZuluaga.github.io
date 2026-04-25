import { trackEvent, trackPageView } from "./visitor-tracker.js";

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
      localLikesAria: "Local likes:",
      localLikesSuffix: "(local likes)",
    };
  }
  return {
    like: "Me gusta",
    liked: "Te gusta",
    likeAria: "Me gusta. Total",
    localLikesAria: "Me gusta locales:",
    localLikesSuffix: "(me gusta locales)",
  };
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
  localNode.textContent = `👏 ${safeCount} ${text.localLikesSuffix}`;
}

async function hydrateReviewLikesFromLibrary() {
  const reviewId = getCurrentReviewId();
  if (!reviewId) return;
  try {
    const response = await fetch("../info/library.json", { cache: "no-store" });
    if (!response.ok) return;
    const library = await response.json();
    const books = Array.isArray(library?.books) ? library.books : [];
    const match = books.find((book) => parseReviewIdFromUrl(book?.reviewUrl) === reviewId);
    if (!match) return;
    updateLikesInPage(match.reviewLikes);
  } catch (_err) {
    // Non-critical: keep static likes from generated HTML.
  }
}

function upsertLikeButtonUI(reviewId, initialCount = 0) {
  const text = uiText();
  const fixedHost = document.getElementById("review-like-actions");
  const card = document.querySelector("article.card");
  const host = fixedHost || card;
  if (!host || !reviewId) return;
  if (document.getElementById("review-like-btn")) return;

  const wrap = document.createElement("p");
  wrap.className = "likes likes-local";
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
  const base = workerBaseFromLogEndpoint();
  if (!reviewId || !base) return;

  const initialCount = await fetchLikeCount(base, reviewId);
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
      trackEvent("review_like_click", { reviewId, count, alreadyLiked: Boolean(data?.alreadyLiked) });
    } catch {
      btn.disabled = false;
    }
  });
}

trackReviewVisit();
hydrateReviewLikesFromLibrary();
wireReviewLikeButton();

