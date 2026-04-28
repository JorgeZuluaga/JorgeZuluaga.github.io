const DEFAULT_ENDPOINT = "";
const STORAGE_KEY = "visitorLogEndpoint";

function normalizeEndpoint(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) return "";
  return value;
}

function getEndpointFromDom() {
  const el = document.querySelector('meta[name="visitor-log-endpoint"]');
  if (!el) return "";
  return normalizeEndpoint(el.getAttribute("content"));
}

function getEndpoint() {
  const fromDom = getEndpointFromDom();
  if (fromDom) return fromDom;
  const fromStorage = normalizeEndpoint(localStorage.getItem(STORAGE_KEY));
  if (fromStorage) return fromStorage;
  return normalizeEndpoint(DEFAULT_ENDPOINT);
}

function safeJsonStringify(payload) {
  try {
    return JSON.stringify(payload);
  } catch {
    return "{}";
  }
}

function isSameOrigin(endpoint) {
  try {
    return new URL(endpoint).origin === window.location.origin;
  } catch {
    return false;
  }
}

function normalizePathname(rawPathname) {
  const value = String(rawPathname || "").trim();
  if (!value) return "/";
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, "/");
  return collapsed || "/";
}

function sendPayload(endpoint, payload) {
  const body = safeJsonStringify(payload);
  if (!endpoint) return false;

  // Avoid cross-origin sendBeacon ("ping") because some browsers block it by CORS.
  if (navigator.sendBeacon && isSameOrigin(endpoint)) {
    const blob = new Blob([body], { type: "application/json" });
    const ok = navigator.sendBeacon(endpoint, blob);
    if (ok) return true;
  }

  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    mode: "cors",
    credentials: "omit",
  }).catch(() => {});
  return true;
}

export function trackEvent(eventType, details = {}) {
  const endpoint = getEndpoint();
  if (!endpoint) return false;

  const payload = {
    eventType,
    timestamp: new Date().toISOString(),
    page: normalizePathname(location.pathname),
    url: location.href,
    referrer: document.referrer || "",
    userAgent: navigator.userAgent || "",
    language: document.documentElement.lang || navigator.language || "",
    details,
  };
  return sendPayload(endpoint, payload);
}

export function trackPageView(pageName) {
  return trackEvent("page_view", { pageName });
}

