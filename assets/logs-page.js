const TOKEN_STORAGE_KEY = "visitorLogsReadToken";

function endpointFromMeta() {
  const el = document.querySelector('meta[name="visitor-log-read-endpoint"]');
  return String(el?.getAttribute("content") ?? "").trim();
}

function fmt(n) {
  return Number(n || 0).toLocaleString("es-CO");
}

function countBy(items, selector) {
  const map = new Map();
  for (const item of items) {
    const key = selector(item);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function renderRows(tbodyId, rows) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="2">Sin datos</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map(([k, v]) => `<tr><td>${String(k)}</td><td>${fmt(v)}</td></tr>`)
    .join("");
}

function renderSummary(logs) {
  const box = document.getElementById("logs-summary");
  if (!box) return;
  const uniqueIps = new Set(logs.map((x) => x.ip).filter(Boolean)).size;
  const uniquePages = new Set(logs.map((x) => x.page).filter(Boolean)).size;
  const imageDownloads = logs.filter((x) => x.eventType === "image_download").length;
  const pdfClicks = logs.filter((x) => x.eventType === "pdf_print_click").length;

  box.innerHTML = [
    ["Total eventos", fmt(logs.length)],
    ["IPs únicas", fmt(uniqueIps)],
    ["Páginas únicas", fmt(uniquePages)],
    ["Descargas imagen", fmt(imageDownloads)],
    ["Clic PDF", fmt(pdfClicks)],
  ]
    .map(
      ([k, v]) =>
        `<article class="logs-card"><p class="logs-card__k">${k}</p><p class="logs-card__v">${v}</p></article>`,
    )
    .join("");
}

async function buildReviewTitleMap() {
  try {
    const res = await fetch("./info/library.json", { cache: "no-store" });
    if (!res.ok) return new Map();
    const data = await res.json();
    const books = Array.isArray(data?.books) ? data.books : [];
    const out = new Map();
    for (const book of books) {
      const localUrl = String(book?.reviewLocalUrl || "");
      const title = String(book?.title || "").trim();
      if (!localUrl || !title) continue;
      const m = localUrl.match(/\/reviews\/(\d+)\.html$/);
      if (!m) continue;
      out.set(m[1], title);
    }
    return out;
  } catch {
    return new Map();
  }
}

function reviewIdFromPath(pagePath) {
  const m = String(pagePath || "").match(/\/reviews\/(\d+)\.html$/);
  return m ? m[1] : "";
}

async function renderReport(logs) {
  const reviewTitleMap = await buildReviewTitleMap();
  renderSummary(logs);

  const pageViews = logs.filter((x) => x.eventType === "page_view");
  renderRows("by-page", countBy(pageViews, (x) => x.page || "(sin página)"));

  const reviewViews = pageViews.filter((x) => /\/reviews\/\d+\.html$/.test(String(x.page || "")));
  renderRows(
    "by-review",
    countBy(reviewViews, (x) => {
      const reviewId = reviewIdFromPath(x.page);
      if (!reviewId) return "(reseña sin id)";
      return reviewTitleMap.get(reviewId) || "Libro no encontrado en library.json";
    }),
  );

  renderRows(
    "by-image",
    countBy(logs.filter((x) => x.eventType === "image_download"), (x) => x?.details?.fileName || "(sin nombre)"),
  );

  renderRows(
    "by-month",
    countBy(pageViews, (x) => String(x.timestampServer || "").slice(0, 7)),
  );

  renderRows("by-event", countBy(logs, (x) => x.eventType || "unknown"));
}

function setStatus(msg) {
  const el = document.getElementById("logs-status");
  if (el) el.textContent = msg;
}

function setError(msg = "") {
  const el = document.getElementById("logs-error");
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg;
}

function getTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get("token") || "").trim();
}

function getToken() {
  const tokenFromUrl = getTokenFromUrl();
  if (tokenFromUrl) {
    localStorage.setItem(TOKEN_STORAGE_KEY, tokenFromUrl);
    return tokenFromUrl;
  }
  return String(localStorage.getItem(TOKEN_STORAGE_KEY) || "").trim();
}

async function loadLogs() {
  const endpoint = endpointFromMeta();
  if (!endpoint) {
    setError("Falta meta visitor-log-read-endpoint.");
    return;
  }

  const token = getToken();
  if (!token) {
    setError("Falta token. Abre la página como logs.html?token=TU_TOKEN.");
    setStatus("Sin token.");
    return;
  }

  setError("");
  setStatus("Consultando logs...");

  const url = new URL(endpoint);
  url.searchParams.set("token", token);

  const res = await fetch(url.toString(), {
    method: "GET",
    mode: "cors",
    credentials: "omit",
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("Token inválido.");
    throw new Error(`Error HTTP ${res.status}`);
  }

  const data = await res.json();
  const logs = Array.isArray(data.logs) ? data.logs : [];
  await renderReport(logs);
  setStatus(`Actualizado: ${new Date().toLocaleString("es-CO")} · ${fmt(logs.length)} eventos`);
}

function wire() {
  const refreshBtn = document.getElementById("logs-refresh");
  refreshBtn?.addEventListener("click", () => loadLogs().catch((e) => {
    setError(e.message || "No fue posible cargar logs.");
    setStatus("Error de consulta.");
  }));
}

wire();
loadLogs().catch((e) => {
  setError(e.message || "No fue posible cargar logs.");
  setStatus("Error de consulta.");
});

