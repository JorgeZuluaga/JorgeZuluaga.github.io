/**
 * Cloudflare Worker: Open Graph / Twitter preview for book.html?bookid=…
 *
 * Humans → 302 to https://jorgezuluaga.github.io/book.html?…
 * Social crawlers → HTML with og:image = book cover (no JS required).
 *
 * Share URLs (examples):
 *   https://book-og-worker.jorgezuluaga.workers.dev/?bookid=89009188
 *   https://book-og-worker.jorgezuluaga.workers.dev/book/89009188
 *   https://book-og-worker.jorgezuluaga.workers.dev/?isbn=9788418741838
 */

const DEFAULT_SITE_BASE = "https://jorgezuluaga.github.io";

const BOT_UA_RE =
  /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|TelegramBot|WhatsApp|SkypeUriPreview|Applebot|Googlebot|bingbot|Baiduspider|DuckDuckBot|Embedly|Quora Link Preview|Showyoubot|outbrain|pinterest|redditbot|vkShare|W3C_Validator|Iframely|OpenGraph|preview/i;

function siteBase(env) {
  return String(env?.SITE_BASE_URL || DEFAULT_SITE_BASE).replace(/\/$/, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeIsbn(value) {
  return String(value ?? "")
    .replace(/[^0-9Xx]/g, "")
    .toUpperCase();
}

function isBot(request) {
  const ua = request.headers.get("user-agent") || "";
  return BOT_UA_RE.test(ua);
}

function parseBookParams(url) {
  const bookidQ = String(url.searchParams.get("bookid") || "").trim();
  const isbnQ = String(url.searchParams.get("isbn") || "").trim();
  const path = url.pathname.replace(/\/+$/, "") || "/";

  let bookId = "";
  let isbn = "";

  const bookPath = path.match(/^\/book\/([^/]+)$/i);
  const isbnPath = path.match(/^\/isbn\/([^/]+)$/i);
  if (bookPath) {
    const raw = decodeURIComponent(bookPath[1]).trim();
    if (/^\d+$/.test(raw)) bookId = raw;
    else if (raw.toLowerCase().startsWith("isbn:")) isbn = normalizeIsbn(raw.slice(5));
    else isbn = normalizeIsbn(raw);
  } else if (isbnPath) {
    isbn = normalizeIsbn(decodeURIComponent(isbnPath[1]));
  }

  if (bookidQ) {
    if (bookidQ.toLowerCase().startsWith("isbn:")) isbn = normalizeIsbn(bookidQ.slice(5));
    else if (/^\d+$/.test(bookidQ)) bookId = bookidQ;
    else isbn = normalizeIsbn(bookidQ);
  }
  if (isbnQ) isbn = normalizeIsbn(isbnQ);

  return { bookId, isbn };
}

function bookPageUrl(base, { bookId, isbn }) {
  if (bookId) return `${base}/book.html?bookid=${encodeURIComponent(bookId)}`;
  if (isbn) return `${base}/book.html?isbn=${encodeURIComponent(isbn)}`;
  return `${base}/book.html`;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    cf: { cacheTtl: 300, cacheEverything: true },
    headers: { "user-agent": "jorgezuluaga-book-og-worker/1.0" },
  });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function urlExists(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      cf: { cacheTtl: 86400, cacheEverything: true },
      headers: { "user-agent": "jorgezuluaga-book-og-worker/1.0" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function resolveCoverUrl(base, { bookId, isbn, libraryBook, detailsRow }) {
  const reviewIdMatch = String(libraryBook?.reviewUrl || "").match(/\/review\/show\/(\d+)/);
  const reviewId = reviewIdMatch ? reviewIdMatch[1] : "";
  const localCover = String(libraryBook?.reviewLocalCoverUrl || "").trim().replace(/^\.\//, "");
  const candidates = [];

  if (localCover) candidates.push(`${base}/${localCover}`);
  if (reviewId) {
    for (const ext of ["jpg", "jpeg", "png", "webp"]) {
      candidates.push(`${base}/reviews/covers/${reviewId}.${ext}`);
    }
  }

  const isbnNorm = normalizeIsbn(isbn || libraryBook?.isbn || libraryBook?.ISBN || detailsRow?.ISBN);
  if (isbnNorm) {
    const variants = [isbnNorm];
    if (
      isbnNorm.length === 13 &&
      (isbnNorm.startsWith("978") || isbnNorm.startsWith("979"))
    ) {
      variants.push(isbnNorm.slice(3));
    }
    for (const variant of variants) {
      for (const ext of ["png", "jpg", "jpeg", "webp"]) {
        candidates.push(`${base}/antilibrary/covers/${variant}.${ext}`);
      }
    }
  }

  candidates.push(`${base}/assets/profile-library.webp`);
  candidates.push(`${base}/assets/profile.jpg`);

  const seen = new Set();
  for (const url of candidates) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    if (await urlExists(url)) return url;
  }
  return `${base}/assets/profile.jpg`;
}

function findLibraryBook(books, bookId, isbn) {
  if (bookId) {
    const hit = books.find((b) => String(b?.bookId || "").trim() === bookId);
    if (hit) return hit;
  }
  if (isbn) {
    return books.find((b) => normalizeIsbn(b?.isbn || b?.ISBN) === isbn) || null;
  }
  return null;
}

function findDetailsRow(rows, bookId, isbn, libraryBook) {
  if (bookId) {
    const byId = rows.find((r) => String(r?.bookId || "").trim() === bookId);
    if (byId) return byId;
  }
  const want = normalizeIsbn(isbn || libraryBook?.isbn || libraryBook?.ISBN);
  if (want) {
    return rows.find((r) => normalizeIsbn(r?.ISBN) === want) || null;
  }
  return null;
}

function buildOgHtml({
  title,
  author,
  description,
  imageUrl,
  canonicalUrl,
  shareUrl,
  lang,
}) {
  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(description);
  const safeImage = escapeHtml(imageUrl);
  const safeCanonical = escapeHtml(canonicalUrl);
  const safeShare = escapeHtml(shareUrl);
  const byLine =
    lang === "en"
      ? `Book by ${author} in Jorge Zuluaga’s library`
      : `Libro de ${author} en la biblioteca de Jorge I. Zuluaga`;

  return `<!DOCTYPE html>
<html lang="${lang === "en" ? "en" : "es"}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDesc}" />
  <link rel="canonical" href="${safeCanonical}" />
  <meta property="og:type" content="book" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDesc}" />
  <meta property="og:url" content="${safeShare}" />
  <meta property="og:image" content="${safeImage}" />
  <meta property="og:image:alt" content="${safeTitle}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDesc}" />
  <meta name="twitter:image" content="${safeImage}" />
  <meta http-equiv="refresh" content="0;url=${safeCanonical}" />
</head>
<body>
  <p><a href="${safeCanonical}">${safeTitle}</a> — ${escapeHtml(byLine)}</p>
</body>
</html>`;
}

async function handleBookPreview(request, env, url) {
  const base = siteBase(env);
  const params = parseBookParams(url);
  if (!params.bookId && !params.isbn) {
    return new Response("Missing bookid or isbn", { status: 400 });
  }

  const canonical = bookPageUrl(base, params);
  const shareUrl = url.origin + url.pathname + url.search;

  if (!isBot(request)) {
    return Response.redirect(canonical, 302);
  }

  const [library, details] = await Promise.all([
    fetchJson(`${base}/info/library.json`),
    fetchJson(`${base}/info/library-details.json`),
  ]);

  const books = Array.isArray(library?.books) ? library.books : [];
  const detailsRows = Array.isArray(details?.books) ? details.books : [];
  const libraryBook = findLibraryBook(books, params.bookId, params.isbn);
  const detailsRow = findDetailsRow(detailsRows, params.bookId, params.isbn, libraryBook);

  const title =
    String(libraryBook?.title || detailsRow?.Title || detailsRow?.title || "").trim() ||
    "Libro";
  const author =
    String(libraryBook?.author || detailsRow?.Author || detailsRow?.author || "").trim() ||
    "—";
  const lang = url.searchParams.get("lang") === "en" ? "en" : "es";
  const description =
    lang === "en"
      ? `${title} by ${author} — Jorge Zuluaga’s library`
      : `${title} de ${author} — Biblioteca de Jorge I. Zuluaga`;

  const imageUrl = await resolveCoverUrl(base, {
    bookId: params.bookId || String(libraryBook?.bookId || "").trim(),
    isbn: params.isbn || normalizeIsbn(libraryBook?.isbn || detailsRow?.ISBN),
    libraryBook,
    detailsRow,
  });

  const html = buildOgHtml({
    title,
    author,
    description,
    imageUrl,
    canonicalUrl: canonical,
    shareUrl,
    lang,
  });

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, OPTIONS",
        },
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      if (!url.searchParams.get("bookid") && !url.searchParams.get("isbn")) {
        return new Response(
          JSON.stringify({
            ok: true,
            service: "book-og-worker",
            usage: [
              "/?bookid=89009188",
              "/book/89009188",
              "/?isbn=9788418741838",
              "/isbn/9788418741838",
            ],
          }),
          { headers: { "content-type": "application/json; charset=utf-8" } },
        );
      }
    }

    try {
      return await handleBookPreview(request, env, url);
    } catch (err) {
      return new Response(`Error: ${err?.message || err}`, { status: 500 });
    }
  },
};
