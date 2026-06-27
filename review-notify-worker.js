/**
 * Cloudflare Worker: suscripción por correo a nuevas reseñas.
 *
 * POST /subscribe          { email, lang? }
 * GET  /unsubscribe?token=
 * POST /notify             Authorization: Bearer NOTIFY_TOKEN — { reviews: [...] }
 * GET  /subscriber-count  — { count } (público, sin emails)
 * POST /admin/seed         Authorization: Bearer NOTIFY_TOKEN — { emails: [...] }
 * POST /admin/dedupe       Authorization: Bearer NOTIFY_TOKEN — limpia duplicados en KV
 * POST /admin/unsubscribe  Authorization: Bearer NOTIFY_TOKEN — { email }
 * GET  /admin/subscribers  Authorization: Bearer NOTIFY_TOKEN
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

const SUBSCRIBER_COUNT_KEY = "meta:subscriber_count";

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...extraHeaders },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...CORS },
  });
}

function normalizeEmail(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function emailHash(email) {
  const data = new TextEncoder().encode(normalizeEmail(email));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bearerToken(request) {
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

function requireNotifyToken(request, env) {
  const expected = String(env.NOTIFY_TOKEN || "").trim();
  if (!expected) return { ok: false, response: json({ ok: false, error: "notify_token_not_configured" }, 503) };
  const got = bearerToken(request);
  if (!got || got !== expected) {
    return { ok: false, response: json({ ok: false, error: "unauthorized" }, 401) };
  }
  return { ok: true };
}

async function getSubscriber(kv, email) {
  const key = `sub:${await emailHash(email)}`;
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveSubscriber(kv, record) {
  const key = `sub:${await emailHash(record.email)}`;
  await kv.put(key, JSON.stringify(record));
}

async function listSubscriberKeys(kv) {
  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: "sub:", cursor, limit: 1000 });
    keys.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

async function parseSubscriberRecord(raw) {
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw);
    return rec && typeof rec === "object" ? rec : null;
  } catch {
    return null;
  }
}

function pickPreferredSubscriber(a, b) {
  const rank = (rec) => {
    if (rec?.status === "confirmed") return 2;
    return 1;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra > rb ? a : b;
  const ta = Date.parse(a?.subscribedAt || "") || 0;
  const tb = Date.parse(b?.subscribedAt || "") || 0;
  return ta >= tb ? a : b;
}

function dedupeSubscriberRecords(records) {
  const byEmail = new Map();
  for (const item of records) {
    const email = normalizeEmail(item.rec?.email || "");
    if (!email || !isValidEmail(email)) continue;
    const prev = byEmail.get(email);
    byEmail.set(email, prev ? pickPreferredSubscriber(prev.rec, item.rec) : item.rec);
  }
  return byEmail;
}

async function listConfirmedSubscribers(kv) {
  const keys = await listSubscriberKeys(kv);
  const records = [];
  for (const k of keys) {
    const raw = await kv.get(k.name);
    const rec = await parseSubscriberRecord(raw);
    if (rec && rec.status === "confirmed" && rec.email) {
      records.push({ key: k.name, rec });
    }
  }
  const unique = dedupeSubscriberRecords(records);
  return [...unique.values()];
}

async function rebuildSubscriberCount(kv) {
  const subs = await listConfirmedSubscribers(kv);
  await kv.put(SUBSCRIBER_COUNT_KEY, String(subs.length));
  return subs.length;
}

async function getCachedSubscriberCount(kv) {
  const raw = await kv.get(SUBSCRIBER_COUNT_KEY);
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return rebuildSubscriberCount(kv);
}

async function adjustSubscriberCount(kv, delta) {
  const current = await getCachedSubscriberCount(kv);
  const next = Math.max(0, current + delta);
  await kv.put(SUBSCRIBER_COUNT_KEY, String(next));
  return next;
}

async function dedupeSubscribers(kv) {
  const keys = await listSubscriberKeys(kv);
  const records = [];
  for (const k of keys) {
    const raw = await kv.get(k.name);
    const rec = await parseSubscriberRecord(raw);
    records.push({ key: k.name, rec });
  }

  const byEmail = new Map();
  const invalidKeys = [];
  for (const item of records) {
    const email = normalizeEmail(item.rec?.email || "");
    if (!item.rec || !email || !isValidEmail(email)) {
      invalidKeys.push(item.key);
      continue;
    }
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push(item);
  }

  let removed = 0;
  let merged = 0;
  for (const [email, items] of byEmail.entries()) {
    let keepRec = items[0].rec;
    for (const item of items.slice(1)) {
      keepRec = pickPreferredSubscriber(keepRec, item.rec);
    }
    const canonicalKey = `sub:${await emailHash(email)}`;
    const canonicalRecord = {
      email,
      status: keepRec?.status === "confirmed" ? "confirmed" : keepRec?.status || "confirmed",
      source: keepRec?.source || "dedupe",
      subscribedAt: keepRec?.subscribedAt || new Date().toISOString(),
      unsubscribeToken: keepRec?.unsubscribeToken || randomToken(),
    };
    await kv.put(canonicalKey, JSON.stringify(canonicalRecord));
    if (!items.some((item) => item.key === canonicalKey)) merged += 1;
    for (const item of items) {
      if (item.key === canonicalKey) continue;
      await kv.delete(item.key);
      removed += 1;
    }
  }

  for (const key of invalidKeys) {
    await kv.delete(key);
    removed += 1;
  }

  const remaining = await listConfirmedSubscribers(kv);
  await kv.put(SUBSCRIBER_COUNT_KEY, String(remaining.length));
  return {
    ok: true,
    removedKeys: removed,
    mergedCanonical: merged,
    uniqueConfirmed: remaining.length,
    emails: remaining.map((s) => s.email),
  };
}

async function upsertConfirmed(kv, email, source = "form") {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    return { ok: false, error: "invalid_email" };
  }
  const existing = await getSubscriber(kv, normalized);
  if (existing && existing.status === "confirmed") {
    return { ok: true, status: "already_subscribed", email: normalized };
  }
  const record = {
    email: normalized,
    status: "confirmed",
    source,
    subscribedAt: existing?.subscribedAt || new Date().toISOString(),
    unsubscribeToken: existing?.unsubscribeToken || randomToken(),
  };
  await saveSubscriber(kv, record);
  await adjustSubscriberCount(kv, existing && existing.status === "confirmed" ? 0 : 1);
  return { ok: true, status: "subscribed", email: normalized };
}

function siteBase(env) {
  return String(env.SITE_BASE_URL || "https://jorgezuluaga.github.io").replace(/\/$/, "");
}

function redirectToLibrary(env, params = "") {
  const base = siteBase(env);
  const q = params ? (params.startsWith("?") ? params : `?${params}`) : "";
  return Response.redirect(`${base}/biblioteca.html${q}`, 302);
}

async function handleSubscribe(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const email = normalizeEmail(body.email);
  const result = await upsertConfirmed(env.REVIEW_NOTIFY, email, "form");
  if (!result.ok) return json(result, 400);
  return json({ ok: true, status: result.status, email: result.email });
}

async function handleUnsubscribe(url, env) {
  const token = String(url.searchParams.get("token") || "").trim();
  if (!token) return html("<p>Token inválido.</p>", 400);

  const keys = await listConfirmedSubscribers(env.REVIEW_NOTIFY);
  const match = keys.find((r) => r.unsubscribeToken === token);
  if (!match) return html("<p>Suscripción no encontrada.</p>", 404);

  await env.REVIEW_NOTIFY.delete(`sub:${await emailHash(match.email)}`);
  await adjustSubscriberCount(env.REVIEW_NOTIFY, -1);
  return redirectToLibrary(env, "subscribe=unsubscribed");
}

async function handleSeed(request, env) {
  const auth = requireNotifyToken(request, env);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const emails = Array.isArray(body.emails) ? body.emails : [];
  const results = [];
  for (const raw of emails) {
    results.push(await upsertConfirmed(env.REVIEW_NOTIFY, raw, "admin_seed"));
  }
  await rebuildSubscriberCount(env.REVIEW_NOTIFY);
  return json({ ok: true, results });
}

async function handleSubscriberCount(env) {
  const count = await getCachedSubscriberCount(env.REVIEW_NOTIFY);
  return json(
    { ok: true, count },
    200,
    { "cache-control": "public, max-age=300" },
  );
}

async function handleAdminUnsubscribe(request, env) {
  const auth = requireNotifyToken(request, env);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) {
    return json({ ok: false, error: "invalid_email" }, 400);
  }

  const existing = await getSubscriber(env.REVIEW_NOTIFY, email);
  if (!existing) {
    return json({ ok: false, error: "not_found", email }, 404);
  }

  await env.REVIEW_NOTIFY.delete(`sub:${await emailHash(email)}`);
  await adjustSubscriberCount(env.REVIEW_NOTIFY, -1);
  return json({ ok: true, removed: true, email });
}

async function handleDedupeSubscribers(request, env) {
  const auth = requireNotifyToken(request, env);
  if (!auth.ok) return auth.response;
  const result = await dedupeSubscribers(env.REVIEW_NOTIFY);
  return json(result);
}

async function handleListSubscribers(request, env) {
  const auth = requireNotifyToken(request, env);
  if (!auth.ok) return auth.response;
  const subs = await listConfirmedSubscribers(env.REVIEW_NOTIFY);
  return json({
    ok: true,
    count: subs.length,
    emails: subs.map((s) => s.email),
    subscribers: subs.map((s) => ({
      email: s.email,
      unsubscribeToken: s.unsubscribeToken,
    })),
  });
}

async function handleNotify(request, env) {
  const auth = requireNotifyToken(request, env);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const reviews = Array.isArray(body.reviews) ? body.reviews : [];
  if (!reviews.length) return json({ ok: true, sent: 0, message: "no_reviews" });

  const subs = await listConfirmedSubscribers(env.REVIEW_NOTIFY);
  if (!subs.length) return json({ ok: true, sent: 0, message: "no_subscribers" });

  return json({
    ok: true,
    queued: true,
    subscriberCount: subs.length,
    reviewCount: reviews.length,
    message: "use_local_gmail_sender",
    subscribers: subs.map((s) => s.email),
    reviews,
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/subscribe") {
        return handleSubscribe(request, env);
      }
      if (request.method === "GET" && url.pathname === "/unsubscribe") {
        return handleUnsubscribe(url, env);
      }
      if (request.method === "POST" && url.pathname === "/admin/seed") {
        return handleSeed(request, env);
      }
      if (request.method === "GET" && url.pathname === "/subscriber-count") {
        return handleSubscriberCount(env);
      }
      if (request.method === "POST" && url.pathname === "/admin/unsubscribe") {
        return handleAdminUnsubscribe(request, env);
      }
      if (request.method === "POST" && url.pathname === "/admin/dedupe") {
        return handleDedupeSubscribers(request, env);
      }
      if (request.method === "GET" && url.pathname === "/admin/subscribers") {
        return handleListSubscribers(request, env);
      }
      if (request.method === "POST" && url.pathname === "/notify") {
        return handleNotify(request, env);
      }
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "review-notify-worker" });
      }
      return json({ ok: false, error: "not_found" }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : "worker_exception";
      return json({ ok: false, error: "worker_exception", message }, 500);
    }
  },
};
