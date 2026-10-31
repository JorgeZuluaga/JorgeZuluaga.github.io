/**
 * Cloudflare Worker: ubicaciones de libros (booklocation.json).
 *
 * Guarda un único documento JSON en KV (clave "booklocation.json"):
 * {
 *   "updatedAt": "...",
 *   "locations": { "LOC-salon-1": { "name": "Salón 1" } },
 *   "books": { "9789586554299": { "location": "LOC-salon-1", "updatedAt": "..." } }
 * }
 * No toca info/library.json. Todos los endpoints requieren el token
 * (Authorization: Bearer <BOOKLOC_TOKEN>).
 *
 * Endpoints:
 *   GET  /booklocation.json
 *   POST /assign          { isbn, location }
 *   POST /unassign        { isbn }
 *   POST /location        { code, name }
 *   POST /location-delete { code }
 */

const KEY = "booklocation.json";

function cors(request, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = request.headers.get("origin") || "";
  const allow = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : allowed[0] || "";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    vary: "origin",
  };
}

function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...cors(request, env),
    },
  });
}

async function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

async function authorized(request, env) {
  const expected = String(env.BOOKLOC_TOKEN || "");
  if (!expected) return false;
  const m = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return m ? timingSafeEqual(m[1].trim(), expected) : false;
}

async function load(env) {
  const raw = await env.BOOK_LOCATIONS.get(KEY);
  if (!raw) return { updatedAt: null, locations: {}, books: {} };
  const data = JSON.parse(raw);
  data.locations ||= {};
  data.books ||= {};
  return data;
}

async function save(env, data) {
  data.updatedAt = new Date().toISOString();
  await env.BOOK_LOCATIONS.put(KEY, JSON.stringify(data, null, 2));
  return data;
}

const isIsbn = (s) => /^\d{9}[\dX]$|^\d{13}$/.test(s);
const isLocCode = (s) => /^LOC-[A-Za-z0-9_-]{1,60}$/.test(s);

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(request, env) });
    }
    if (!(await authorized(request, env))) {
      return json(request, env, { ok: false, error: "unauthorized" }, 401);
    }

    const { pathname } = new URL(request.url);

    if (request.method === "GET" && pathname === "/booklocation.json") {
      return json(request, env, await load(env));
    }
    if (request.method !== "POST") {
      return json(request, env, { ok: false, error: "not_found" }, 404);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json(request, env, { ok: false, error: "invalid_json" }, 400);
    }

    const data = await load(env);
    const isbn = String(body.isbn || "").replace(/[\s-]/g, "").toUpperCase();
    const code = String(body.code || body.location || "").trim();

    if (pathname === "/assign") {
      if (!isIsbn(isbn) || !isLocCode(code)) {
        return json(request, env, { ok: false, error: "invalid_params" }, 400);
      }
      if (!data.locations[code]) {
        return json(request, env, { ok: false, error: "unknown_location" }, 404);
      }
      data.books[isbn] = { location: code, updatedAt: new Date().toISOString() };
    } else if (pathname === "/unassign") {
      if (!isIsbn(isbn)) return json(request, env, { ok: false, error: "invalid_params" }, 400);
      delete data.books[isbn];
    } else if (pathname === "/location") {
      const name = String(body.name || "").trim().slice(0, 120);
      if (!isLocCode(code) || !name) {
        return json(request, env, { ok: false, error: "invalid_params" }, 400);
      }
      data.locations[code] = { name };
    } else if (pathname === "/location-delete") {
      if (!isLocCode(code)) return json(request, env, { ok: false, error: "invalid_params" }, 400);
      delete data.locations[code];
      for (const [k, v] of Object.entries(data.books)) {
        if (v.location === code) delete data.books[k];
      }
    } else {
      return json(request, env, { ok: false, error: "not_found" }, 404);
    }

    return json(request, env, { ok: true, data: await save(env, data) });
  },
};
