import { trackPageView } from "./visitor-tracker.js";

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

trackReviewVisit();
hydrateReviewLikesFromLibrary();

