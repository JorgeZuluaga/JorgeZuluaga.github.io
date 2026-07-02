/** Shared cover URL resolution (Goodreads mirror + BookBuddy antilibrary/covers). */

export function normalizeIsbn(value) {
  return String(value || "").replace(/[^0-9Xx]/g, "").toUpperCase();
}

/** Goodreads bookId → ISBN from library-details.json (BookBuddy export). */
export function buildDetailsIsbnByBookId(detailsBooks) {
  const map = new Map();
  for (const row of detailsBooks || []) {
    const bookId = String(row?.bookId || "").trim();
    const isbn = normalizeIsbn(row?.ISBN ?? row?.isbn);
    if (bookId && isbn) map.set(bookId, isbn);
  }
  return map;
}

export function pushReviewMirrorCoverCandidates(candidates, reviewUrl) {
  const match = String(reviewUrl || "").match(/\/review\/show\/(\d+)/);
  const id = match ? match[1] : "";
  if (!id) return;
  candidates.push(`./reviews/covers/${id}.jpg`);
  candidates.push(`./reviews/covers/${id}.jpeg`);
  candidates.push(`./reviews/covers/${id}.png`);
  candidates.push(`./reviews/covers/${id}.webp`);
}

export function pushAntilibraryCoverCandidates(candidates, isbnStr) {
  const normalized = normalizeIsbn(isbnStr);
  if (!normalized) return;
  const variants = [normalized];
  if (
    normalized.length === 13 &&
    (normalized.startsWith("978") || normalized.startsWith("979"))
  ) {
    variants.push(normalized.slice(3));
  }
  const seen = new Set();
  for (const variant of variants) {
    if (seen.has(variant)) continue;
    seen.add(variant);
    for (const ext of ["png", "jpg", "webp", "jpeg"]) {
      candidates.push(`./antilibrary/covers/${variant}.${ext}`);
    }
  }
}

/**
 * Cover candidates: mirror → Goodreads ISBN → BookBuddy ISBN (library-details).
 */
export function collectBookCoverCandidates(item, { detailsIsbnByBookId } = {}) {
  const candidates = [];
  const localCover = String(item?.reviewLocalCoverUrl || "").trim();
  if (localCover) candidates.push(localCover);
  pushReviewMirrorCoverCandidates(candidates, item?.reviewUrl);

  const isbnOrder = [];
  const grIsbn = normalizeIsbn(item?.isbn ?? item?.ISBN);
  if (grIsbn) isbnOrder.push(grIsbn);

  const bookId = String(item?.bookId || "").trim();
  const detailsIsbn =
    bookId && detailsIsbnByBookId instanceof Map
      ? normalizeIsbn(detailsIsbnByBookId.get(bookId))
      : "";
  if (detailsIsbn && !isbnOrder.includes(detailsIsbn)) isbnOrder.push(detailsIsbn);

  for (const isbn of isbnOrder) {
    pushAntilibraryCoverCandidates(candidates, isbn);
  }
  return candidates;
}

export function bindCoverImage(img, candidates) {
  img.dataset.candidates = JSON.stringify(candidates);
  img.dataset.candidateIdx = "0";
  img.onerror = function onCoverError() {
    const list = JSON.parse(this.dataset.candidates || "[]");
    const idx = parseInt(this.dataset.candidateIdx, 10) + 1;
    if (idx < list.length) {
      this.dataset.candidateIdx = String(idx);
      this.src = list[idx];
    } else {
      this.onerror = null;
      this.src = "./assets/images/dummy-cover.jpeg";
    }
  };
  img.src = candidates.length > 0 ? candidates[0] : "./assets/images/dummy-cover.jpeg";
}
