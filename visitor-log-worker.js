/**
 * Cloudflare Worker: registro simple de visitas/descargas.
 *
 * Guarda cada evento como una linea JSON en KV usando timestamp + random UUID.
 * Requiere:
 * 1) Crear namespace KV, por ejemplo VISITOR_LOGS
 * 2) Enlazar en wrangler.toml:
 *    [[kv_namespaces]]
 *    binding = "VISITOR_LOGS"
 *    id = "TU_NAMESPACE_ID"
 *
 * Endpoint: POST /log
 * Like de reseñas: POST /review-like
 * Conteo de likes por reseña: GET /review-like-count/:reviewId
 * Detalle JSON por reseña (IPs): GET /review-likes/:reviewId.json?token=TU_TOKEN
 * (Opcional) Listado protegido por token: GET /logs?token=TU_TOKEN
 * Define LOG_READ_TOKEN en variables del Worker para leer logs.
 */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, GET, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
    },
  });
}

function getIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "unknown"
  );
}

function getCountry(request) {
  const raw = (request.headers.get("cf-ipcountry") || "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  return "XX";
}

function extractReadToken(request, url) {
  const auth = request.headers.get("authorization") || "";
  const bearerMatch = auth.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) return bearerMatch[1].trim();
  return (url.searchParams.get("token") || "").trim();
}

function parseReviewId(pathname, prefix, suffix = "") {
  if (!pathname.startsWith(prefix)) return "";
  if (suffix && !pathname.endsWith(suffix)) return "";
  const raw = pathname.slice(prefix.length, pathname.length - suffix.length).trim();
  if (!/^\d+$/.test(raw)) return "";
  return raw;
}

async function listAllByPrefix(kv, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    keys.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

async function countReviewLikes(kv, reviewId) {
  const prefix = `review_like:${reviewId}:`;
  const keys = await listAllByPrefix(kv, prefix);
  return keys.length;
}

function reviewLikeCountKey(reviewId) {
  return `review_like_count:${reviewId}`;
}

async function getStoredReviewLikeCount(kv, reviewId) {
  const raw = await kv.get(reviewLikeCountKey(reviewId));
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

async function setStoredReviewLikeCount(kv, reviewId, count) {
  const safe = Number.isFinite(Number(count)) ? Math.max(0, Math.floor(Number(count))) : 0;
  await kv.put(reviewLikeCountKey(reviewId), String(safe));
}

async function incrementStoredReviewLikeCount(kv, reviewId) {
  const current = await getStoredReviewLikeCount(kv, reviewId);
  const next = (current ?? 0) + 1;
  await setStoredReviewLikeCount(kv, reviewId, next);
  return next;
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "POST, GET, OPTIONS",
            "access-control-allow-headers": "content-type, authorization",
          },
        });
      }

      if (request.method === "POST" && url.pathname === "/log") {
        let body;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ ok: false, error: "invalid_json" }, 400);
        }

        const now = new Date().toISOString();
        const record = {
          id: crypto.randomUUID(),
          timestampServer: now,
          ip: getIp(request),
          country: getCountry(request),
          eventType: body.eventType || "unknown",
          page: body.page || "",
          url: body.url || "",
          referrer: body.referrer || "",
          userAgent: body.userAgent || "",
          language: body.language || "",
          details: body.details || {},
          timestampClient: body.timestamp || "",
        };

        const key = `${now}_${record.id}`;
        await env.VISITOR_LOGS.put(key, JSON.stringify(record));
        return jsonResponse({ ok: true });
      }

      if (request.method === "POST" && url.pathname === "/review-like") {
        let body;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ ok: false, error: "invalid_json" }, 400);
        }

        const reviewId = String(body?.reviewId || "").trim();
        if (!/^\d+$/.test(reviewId)) {
          return jsonResponse({ ok: false, error: "invalid_review_id" }, 400);
        }

        const now = new Date().toISOString();
        const ip = getIp(request);
        const key = `review_like:${reviewId}:${ip}`;
        const alreadyRaw = await env.VISITOR_LOGS.get(key);
        const already = Boolean(alreadyRaw);

        if (!already) {
          const likeRecord = {
            reviewId,
            ip,
            country: getCountry(request),
            page: body?.page || "",
            url: body?.url || "",
            timestampServer: now,
          };
          await env.VISITOR_LOGS.put(key, JSON.stringify(likeRecord));
          await incrementStoredReviewLikeCount(env.VISITOR_LOGS, reviewId);
        }

        let count = await getStoredReviewLikeCount(env.VISITOR_LOGS, reviewId);
        if (count === null) {
          try {
            count = await countReviewLikes(env.VISITOR_LOGS, reviewId);
            await setStoredReviewLikeCount(env.VISITOR_LOGS, reviewId, count);
          } catch {
            count = 0;
          }
        }
        return jsonResponse({ ok: true, reviewId, liked: !already, alreadyLiked: already, count });
      }

      if (request.method === "GET" && url.pathname.startsWith("/review-like-count/")) {
        const reviewId = parseReviewId(url.pathname, "/review-like-count/");
        if (!reviewId) return jsonResponse({ ok: false, error: "invalid_review_id" }, 400);

        let count = await getStoredReviewLikeCount(env.VISITOR_LOGS, reviewId);
        if (count === null) {
          try {
            // Fallback path (one-time) for old data before the counter key existed.
            count = await countReviewLikes(env.VISITOR_LOGS, reviewId);
            await setStoredReviewLikeCount(env.VISITOR_LOGS, reviewId, count);
          } catch (err) {
            const message = err instanceof Error ? err.message : "unknown_error";
            return jsonResponse(
              { ok: false, error: "kv_quota_exceeded", message },
              429,
            );
          }
        }
        return jsonResponse({ ok: true, reviewId, count });
      }

      if (request.method === "GET" && url.pathname.startsWith("/review-likes/") && url.pathname.endsWith(".json")) {
        const reviewId = parseReviewId(url.pathname, "/review-likes/", ".json");
        if (!reviewId) return jsonResponse({ ok: false, error: "invalid_review_id" }, 400);

        const token = extractReadToken(request, url);
        if (!env.LOG_READ_TOKEN || token !== env.LOG_READ_TOKEN) {
          return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        }

        const prefix = `review_like:${reviewId}:`;
        const keys = await listAllByPrefix(env.VISITOR_LOGS, prefix);
        const values = await Promise.all(
          keys.map(async (k) => {
            const raw = await env.VISITOR_LOGS.get(k.name);
            if (!raw) return null;
            try {
              return JSON.parse(raw);
            } catch {
              return null;
            }
          }),
        );
        const likes = values
          .filter(Boolean)
          .sort((a, b) => String(b.timestampServer).localeCompare(String(a.timestampServer)));

        return jsonResponse({ ok: true, reviewId, count: likes.length, likes });
      }

      if (request.method === "GET" && url.pathname === "/logs") {
        const token = extractReadToken(request, url);
        if (!env.LOG_READ_TOKEN || token !== env.LOG_READ_TOKEN) {
          return jsonResponse({ ok: false, error: "unauthorized" }, 401);
        }

        let list;
        try {
          list = await env.VISITOR_LOGS.list({ limit: 200 });
        } catch (err) {
          const message = err instanceof Error ? err.message : "unknown_error";
          return jsonResponse(
            { ok: false, error: "kv_quota_exceeded", message },
            429,
          );
        }
        const values = await Promise.all(
          list.keys.map(async (k) => {
            const raw = await env.VISITOR_LOGS.get(k.name);
            if (!raw) return null;
            try {
              return JSON.parse(raw);
            } catch {
              return null;
            }
          }),
        );
        const logs = values.filter(Boolean).sort((a, b) =>
          String(b.timestampServer).localeCompare(String(a.timestampServer)),
        );
        return jsonResponse({ ok: true, count: logs.length, logs });
      }

      return jsonResponse({ ok: false, error: "not_found" }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown_worker_error";
      return jsonResponse({ ok: false, error: "worker_exception", message }, 500);
    }
  },
};

