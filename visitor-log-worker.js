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

function extractReadToken(request, url) {
  const auth = request.headers.get("authorization") || "";
  const bearerMatch = auth.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) return bearerMatch[1].trim();
  return (url.searchParams.get("token") || "").trim();
}

export default {
  async fetch(request, env) {
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

    if (request.method === "GET" && url.pathname === "/logs") {
      const token = extractReadToken(request, url);
      if (!env.LOG_READ_TOKEN || token !== env.LOG_READ_TOKEN) {
        return jsonResponse({ ok: false, error: "unauthorized" }, 401);
      }

      const list = await env.VISITOR_LOGS.list({ limit: 200 });
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
  },
};

