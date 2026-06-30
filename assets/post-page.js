const LIBRARY_JSON = "./info/library.json";
const BUSCALIBRE_JSON = "./info/buscalibre.json";
const DRZ_LOGO_URL = "./assets/drz.png";
const QR_API = "https://api.qrserver.com/v1/create-qr-code/";

const CAPTION_HASHTAGS =
  "#LibrosRecomendados #Bookstagram #InstaLibros #TiempoDeLeer #PasiónPorLosLibros";

function isEnglishPage() {
  return new URLSearchParams(window.location.search).get("lang") === "en";
}

function captionUiText() {
  if (isEnglishPage()) {
    return {
      panelTitle: "Caption for your Instagram post",
      copy: "Copy",
      copied: "Copied",
      cta: "I invite you to read the full review to learn more about this book. 👇",
      linkLabel: "🔗 Read the full review here:",
      byPrefix: "By",
    };
  }
  return {
    panelTitle: "Texto para la publicación en Instagram",
    copy: "Copiar",
    copied: "Copiado",
    cta: "Te invito a leer la reseña completa para profundizar en este tema. 👇",
    linkLabel: "🔗 Lee la reseña completa aquí:",
    byPrefix: "Por",
  };
}

function excerptForCaption(fullText) {
  const paragraphs = String(fullText || "")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const first = paragraphs[0] || String(fullText || "").trim();
  if (!first) return "";
  if (paragraphs.length > 1) return `${first} [...]`;
  return first;
}

function buildInstagramCaption({ book, reviewBody, reviewLinkLabel }) {
  const ui = captionUiText();
  const title = String(book.title || "").trim();
  const author = String(book.author || "").trim();
  const stars = formatStars(book.rating);
  const header = `"${title}" ${ui.byPrefix} ${author}${stars ? ` ${stars}` : ""}`;
  const excerpt = excerptForCaption(reviewBody);
  const link = String(reviewLinkLabel || "").trim();

  return [
    header,
    "",
    excerpt,
    "",
    ui.cta,
    "",
    link ? `${ui.linkLabel} ${link}` : "",
    "",
    CAPTION_HASHTAGS,
  ]
    .filter((line, index, arr) => !(line === "" && arr[index + 1] === ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function copyTextToClipboard(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
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

function renderCaptionPanel(captionText) {
  const panel = document.getElementById("post-caption-panel");
  const titleEl = document.getElementById("post-caption-title");
  const textEl = document.getElementById("post-caption-text");
  const copyBtn = document.getElementById("post-caption-copy");
  if (!panel || !titleEl || !textEl || !copyBtn) return;

  const ui = captionUiText();
  titleEl.textContent = ui.panelTitle;
  textEl.textContent = captionText;
  copyBtn.textContent = ui.copy;
  copyBtn.replaceWith(copyBtn.cloneNode(true));
  const freshCopyBtn = document.getElementById("post-caption-copy");
  freshCopyBtn?.addEventListener("click", async () => {
    const ok = await copyTextToClipboard(captionText);
    if (!ok) return;
    freshCopyBtn.textContent = ui.copied;
    setTimeout(() => {
      freshCopyBtn.textContent = ui.copy;
    }, 1400);
  });
  panel.hidden = false;
}

function hideCaptionPanel() {
  const panel = document.getElementById("post-caption-panel");
  if (panel) panel.hidden = true;
}

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

function isShortUrl(url) {
  try {
    const host = new URL(String(url || "").trim()).hostname.toLowerCase();
    return host === "is.gd" || host === "v.gd";
  } catch {
    return false;
  }
}

function displayCompactUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const path = parsed.pathname + parsed.search;
    if (path.length > 46) {
      return `${parsed.host}${path.slice(0, 22)}…${path.slice(-20)}`;
    }
    return `${parsed.host}${path}`;
  } catch {
    return value.length > 52 ? `${value.slice(0, 26)}…${value.slice(-22)}` : value;
  }
}

async function shortenUrl(longUrl) {
  const url = String(longUrl || "").trim();
  if (!url) return "";
  if (isShortUrl(url)) return url;

  for (const host of ["is.gd", "v.gd"]) {
    try {
      const api = `https://${host}/create.php?format=simple&url=${encodeURIComponent(url)}`;
      const res = await fetch(api);
      if (!res.ok) continue;
      const text = (await res.text()).trim();
      const candidate = text.split(/\s+/)[0] || "";
      if (candidate.startsWith("http") && isShortUrl(candidate)) return candidate;
    } catch {
      // try next host
    }
  }

  return displayCompactUrl(url);
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
  hideCaptionPanel();
  if (!root) return;
  root.className = "post-canvas post-status";
  root.innerHTML = message;
}

function renderPost({ book, reviewId, paragraphs, coverSrc, reviewUrl, reviewLinkLabel, buscalibreUrl }) {
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
        <p class="post-qr-label">
          <strong>Consíguelo en Buscalibre</strong>
          <span class="post-qr-sublabel">Escanea para comprar el libro</span>
        </p>
      </div>`
    : `<div class="post-qr-block">
        <p class="post-qr-label"><strong>Buscalibre</strong>Enlace no disponible para este título</p>
      </div>`;

  root.className = "post-canvas";
  root.innerHTML = `
    <div class="post-inner">
      <div class="post-topbar">
        <div class="post-topbar__mark">
          <img class="post-topbar__logo" src="${escapeHtml(DRZ_LOGO_URL)}" width="88" height="88" alt="Dr. Z" decoding="async" />
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
          <p class="post-qr-label">
            <strong>Lee la reseña completa</strong>
            <span class="post-qr-sublabel">Escanea para abrir en la web</span>
            <span class="post-qr-link">${escapeHtml(reviewLinkLabel || reviewUrl)}</span>
          </p>
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
    const reviewBody = extractReviewBodyFromHtml(reviewHtml);
    const paragraphs = firstParagraph(reviewBody);
    if (!paragraphs.length) {
      renderError("La reseña no tiene texto para mostrar.");
      return;
    }

    const reviewQrUrl = reviewShareUrl(reviewHtml, reviewId);
    let reviewLinkLabel = reviewQrUrl;
    if (!isShortUrl(reviewQrUrl)) {
      const shortened = await shortenUrl(reviewQrUrl);
      reviewLinkLabel = shortened;
    }

    const coverSrc = String(book.reviewLocalCoverUrl || `./reviews/covers/${reviewId}.jpg`).trim();

    let buscalibreUrl = "";
    if (buscalibreRes.ok) {
      const buscalibre = await buscalibreRes.json();
      const bookId = String(book.bookId || "").trim();
      const entry = buscalibre?.books?.[bookId];
      const longBuscalibreUrl = String(entry?.url || "").trim();
      if (longBuscalibreUrl) {
        const shortened = await shortenUrl(longBuscalibreUrl);
        buscalibreUrl = isShortUrl(shortened) ? shortened : longBuscalibreUrl;
      }
    }

    const captionText = buildInstagramCaption({
      book,
      reviewBody,
      reviewLinkLabel,
    });

    renderPost({
      book,
      reviewId,
      paragraphs,
      coverSrc,
      reviewUrl: reviewQrUrl,
      reviewLinkLabel,
      buscalibreUrl,
    });
    renderCaptionPanel(captionText);
  } catch {
    renderError("Error al generar el post. Revisa la consola del navegador.");
  }
}

loadPost();
