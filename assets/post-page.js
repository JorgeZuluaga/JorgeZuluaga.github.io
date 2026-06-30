const LIBRARY_JSON = "./info/library.json";
const BUSCALIBRE_JSON = "./info/buscalibre.json";
const FAVICON_URL = "./assets/favicon.png";
const QR_API = "https://api.qrserver.com/v1/create-qr-code/";

function parseReviewIdFromUrl(reviewUrl) {
  const match = String(reviewUrl || "").match(/\/review\/show\/(\d+)/);
  return match ? match[1] : "";
}

function getQueryId() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get("bookid") || params.get("reviewid") || "").trim();
}

function findBookByQueryId(books, id) {
  const q = String(id || "").trim();
  if (!q || !Array.isArray(books)) return null;
  const byReview = books.find((book) => parseReviewIdFromUrl(book?.reviewUrl) === q);
  if (byReview) return byReview;
  return books.find((book) => String(book?.bookId || "").trim() === q) || null;
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

function firstParagraph(text) {
  const paragraph = String(text || "")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)[0];
  return paragraph ? [paragraph] : [];
}

function extractMetaContent(raw, attr, value) {
  const pattern = new RegExp(
    `<meta\\s+${attr}=["']${value}["']\\s+content=["']([^"']*)["']`,
    "i",
  );
  const match = String(raw || "").match(pattern);
  if (match) return match[1].trim();
  const patternAlt = new RegExp(
    `<meta\\s+content=["']([^"']*)["']\\s+${attr}=["']${value}["']`,
    "i",
  );
  const alt = String(raw || "").match(patternAlt);
  return alt ? alt[1].trim() : "";
}

function reviewShareUrl(raw, reviewId) {
  const share = extractMetaContent(raw, "name", "share-url");
  if (share) return share;
  const og = extractMetaContent(raw, "property", "og:url");
  if (og) return og;
  return new URL(`./reviews/${reviewId}.html`, window.location.href).href;
}

function formatStars(rating) {
  const rounded = Math.round(Number(rating));
  if (!Number.isFinite(rounded) || rounded < 1) return "";
  const filled = Math.min(5, Math.max(0, rounded));
  return `${"★".repeat(filled)}${"☆".repeat(5 - filled)}`;
}

function qrImageUrl(targetUrl, size = 108) {
  const data = encodeURIComponent(String(targetUrl || "").trim());
  return `${QR_API}?size=${size}x${size}&margin=8&data=${data}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderError(message) {
  const root = document.getElementById("post-root");
  if (!root) return;
  root.className = "post-canvas post-status";
  root.innerHTML = message;
}

function renderPost({ book, reviewId, paragraphs, coverSrc, reviewUrl, buscalibreUrl }) {
  const root = document.getElementById("post-root");
  if (!root) return;

  const title = String(book.title || "").trim();
  const author = String(book.author || "").trim();
  const stars = formatStars(book.rating);

  const metaParts = [];
  if (author) metaParts.push(`Por ${author}`);
  if (stars) {
    metaParts.push(`<span class="post-stars" aria-label="Calificación: ${escapeHtml(String(book.rating))} de 5">${stars}</span>`);
  }

  const excerptHtml = paragraphs
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");

  const buscalibreBlock = buscalibreUrl
    ? `<div class="post-qr-block">
        <img src="${escapeHtml(qrImageUrl(buscalibreUrl))}" width="108" height="108" alt="QR Buscalibre" decoding="async" />
        <p class="post-qr-label"><strong>Consíguelo en Buscalibre</strong>Escanea para comprar el libro</p>
      </div>`
    : `<div class="post-qr-block">
        <p class="post-qr-label"><strong>Buscalibre</strong>Enlace no disponible para este título</p>
      </div>`;

  root.className = "post-canvas";
  root.innerHTML = `
    <div class="post-inner">
      <div class="post-topbar">
        <div class="post-topbar__mark">
          <img class="post-topbar__logo" src="${escapeHtml(FAVICON_URL)}" width="52" height="52" alt="Dr. Z" decoding="async" />
          <span class="post-topbar__name">Dr.Z</span>
        </div>
        <p class="post-topbar__handles">@jorgeizuluagac · @dr.zacademy</p>
      </div>
      <header class="post-header">
        <img class="post-cover" src="${escapeHtml(coverSrc)}" alt="Portada de ${escapeHtml(title)}" width="340" decoding="async" />
        <div class="post-header__text">
          <p class="post-hashtag">#LibrosRecomendados</p>
          <h1 class="post-title">${escapeHtml(title)}</h1>
          ${metaParts.length ? `<p class="post-meta">${metaParts.join(" · ")}</p>` : ""}
          <p class="post-byline">Reseña por Jorge I. Zuluaga, Dr. Z</p>
          <section class="post-excerpt" aria-label="Extracto de la reseña">
            ${excerptHtml}
          </section>
        </div>
      </header>
      <footer class="post-footer">
        <div class="post-qr-block">
          <img src="${escapeHtml(qrImageUrl(reviewUrl))}" width="108" height="108" alt="QR reseña" decoding="async" />
          <p class="post-qr-label"><strong>Lee la reseña completa</strong>Escanea para abrir en la web</p>
        </div>
        ${buscalibreBlock}
      </footer>
    </div>
  `;
}

async function loadPost() {
  const queryId = getQueryId();
  if (!queryId) {
    renderError(
      "Indica el id de la reseña o del libro.<br><br>Ejemplo: <code>post.html?bookid=8628849214</code>",
    );
    return;
  }

  try {
    const [libraryRes, buscalibreRes] = await Promise.all([
      fetch(LIBRARY_JSON, { cache: "no-store" }),
      fetch(BUSCALIBRE_JSON, { cache: "no-store" }),
    ]);

    if (!libraryRes.ok) {
      renderError("No se pudo cargar la biblioteca.");
      return;
    }

    const library = await libraryRes.json();
    const books = Array.isArray(library?.books) ? library.books : [];
    const book = findBookByQueryId(books, queryId);

    if (!book) {
      renderError(`No se encontró ningún libro con id <code>${escapeHtml(queryId)}</code>.`);
      return;
    }

    const reviewId = parseReviewIdFromUrl(book.reviewUrl);
    if (!reviewId) {
      renderError("Este libro no tiene reseña publicada.");
      return;
    }

    const reviewPath = String(book.reviewLocalUrl || `./reviews/${reviewId}.html`).trim();
    const reviewRes = await fetch(reviewPath, { cache: "no-store" });
    if (!reviewRes.ok) {
      renderError("No se pudo cargar el HTML de la reseña.");
      return;
    }

    const reviewHtml = await reviewRes.text();
    const paragraphs = firstParagraph(extractReviewBodyFromHtml(reviewHtml));
    if (!paragraphs.length) {
      renderError("La reseña no tiene texto para mostrar.");
      return;
    }

    const reviewUrl = reviewShareUrl(reviewHtml, reviewId);
    const coverSrc = String(book.reviewLocalCoverUrl || `./reviews/covers/${reviewId}.jpg`).trim();

    let buscalibreUrl = "";
    if (buscalibreRes.ok) {
      const buscalibre = await buscalibreRes.json();
      const bookId = String(book.bookId || "").trim();
      const entry = buscalibre?.books?.[bookId];
      buscalibreUrl = String(entry?.url || "").trim();
    }

    renderPost({
      book,
      reviewId,
      paragraphs,
      coverSrc,
      reviewUrl,
      buscalibreUrl,
    });
  } catch {
    renderError("Error al generar el post. Revisa la consola del navegador.");
  }
}

loadPost();
