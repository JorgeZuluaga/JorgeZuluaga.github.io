const TOKEN_STORAGE_KEY = "visitorLogsReadToken";
let allLogsCache = [];
let selectedCountry = "";

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

function codeToFlagEmoji(code) {
  const cc = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "🏳️";
  const base = 127397;
  return String.fromCodePoint(...cc.split("").map((c) => base + c.charCodeAt(0)));
}

function countryLabel(code) {
  const cc = String(code || "XX").toUpperCase();
  return `${codeToFlagEmoji(cc)} ${cc}`;
}

function isKnownCountry(code) {
  const cc = String(code || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) && cc !== "XX";
}

function computeCountryUniqueIpRows(pageViews) {
  const map = new Map();
  for (const row of pageViews) {
    const cc = String(row.country || "").trim().toUpperCase();
    if (!isKnownCountry(cc)) continue;
    const ip = String(row.ip || "").trim();
    if (!ip) continue;
    if (!map.has(cc)) map.set(cc, new Set());
    map.get(cc).add(ip);
  }
  const rows = [...map.entries()].map(([cc, set]) => [cc, set.size]);
  rows.sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((acc, [, c]) => acc + c, 0);
  return { rows, total };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderRows(tbodyId, rows) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="2">Sin datos</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${fmt(v)}</td></tr>`)
    .join("");
}

function renderRowsHtml(tbodyId, rows) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="2">Sin datos</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map(([kHtml, v]) => `<tr><td>${kHtml}</td><td>${v}</td></tr>`)
    .join("");
}

function renderSummary(logs) {
  const box = document.getElementById("logs-summary");
  if (!box) return;
  const uniqueIps = new Set(logs.map((x) => x.ip).filter(Boolean)).size;
  const uniquePages = new Set(logs.map((x) => x.page).filter(Boolean)).size;
  const imageDownloads = logs.filter((x) => x.eventType === "image_download").length;
  const pdfClicks = logs.filter((x) => x.eventType === "pdf_print_click").length;
  const reviewOpens = logs.filter(
    (x) => x.eventType === "page_view" && /\/reviews\/\d+\.html$/.test(String(x.page || "")),
  ).length;

  box.innerHTML = [
    ["Total eventos", fmt(logs.length)],
    ["IPs únicas", fmt(uniqueIps)],
    ["Páginas únicas", fmt(uniquePages)],
    ["Reseñas abiertas", fmt(reviewOpens)],
    ["Descargas imagen", fmt(imageDownloads)],
    ["Clic PDF", fmt(pdfClicks)],
  ]
    .map(
      ([k, v]) =>
        `<article class="logs-card"><p class="logs-card__k">${k}</p><p class="logs-card__v">${v}</p></article>`,
    )
    .join("");
}

function renderCountryFilterStatus() {
  const el = document.getElementById("country-filter-status");
  if (!el) return;
  if (!selectedCountry) {
    el.textContent = "Filtro: todos los países.";
    return;
  }
  el.textContent = `Filtro: ${countryLabel(selectedCountry)}.`;
}

function renderCountryCloud(rows, total) {
  const el = document.getElementById("country-cloud");
  if (!el) return;
  const chips = [];
  chips.push(`<button class="country-chip${selectedCountry ? "" : " active"}" data-country="">🌍 Todos</button>`);
  for (const [code, count] of rows) {
    const cc = String(code || "XX").toUpperCase();
    chips.push(
      `<button class="country-chip${selectedCountry === cc ? " active" : ""}" data-country="${escapeHtml(cc)}">${countryLabel(cc)}</button>`,
    );
  }
  el.innerHTML = chips.join("");
  el.querySelectorAll(".country-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedCountry = String(btn.getAttribute("data-country") || "").toUpperCase();
      renderCountryFilterStatus();
      renderReportFromCache().catch((e) => {
        setError(e.message || "No fue posible actualizar filtro por país.");
      });
    });
  });
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

function reviewLinkHtml(pagePath, title) {
  const href = String(pagePath || "").trim();
  const label = escapeHtml(title || "Libro no encontrado en library.json");
  if (!href) return label;
  return `<a class="link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function imageLinkHtml(fileName) {
  const raw = String(fileName || "").trim();
  if (!raw) return escapeHtml("(sin nombre)");
  const href = /^https?:\/\//i.test(raw)
    ? raw
    : `./info/photos/${encodeURIComponent(raw)}`;
  return `<a class="link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(raw)}</a>`;
}

async function renderReport(logs) {
  const allPageViews = logs.filter((x) => x.eventType === "page_view");
  const { rows: countryRows, total: countryTotal } = computeCountryUniqueIpRows(allPageViews);
  renderCountryCloud(countryRows, countryTotal);
  renderRowsHtml(
    "by-country",
    countryRows.map(([code, count]) => {
      const pct = countryTotal > 0 ? ((count / countryTotal) * 100).toFixed(1) : "0.0";
      return [countryLabel(code), `${fmt(count)} (${pct}%)`];
    }),
  );
  renderCountryFilterStatus();

  const filteredLogs = selectedCountry
    ? logs.filter((x) => String(x.country || "XX").toUpperCase() === selectedCountry)
    : logs;

  const reviewTitleMap = await buildReviewTitleMap();
  renderSummary(filteredLogs);

  const pageViews = filteredLogs.filter((x) => x.eventType === "page_view");
  const reviewPathRegex = /\/reviews\/\d+\.html$/;
  const nonReviewPageViews = pageViews.filter((x) => !reviewPathRegex.test(String(x.page || "")));
  renderRows("by-page", countBy(nonReviewPageViews, (x) => x.page || "(sin página)"));

  const reviewViews = pageViews.filter((x) => reviewPathRegex.test(String(x.page || "")));
  const reviewRows = countBy(reviewViews, (x) => {
    const reviewId = reviewIdFromPath(x.page);
    if (!reviewId) return "(reseña sin id)";
    const title = reviewTitleMap.get(reviewId) || "Libro no encontrado en library.json";
    return `${x.page}|||${title}`;
  }).map(([k, v]) => {
    const [pagePath, title] = String(k).split("|||");
    return [reviewLinkHtml(pagePath, title), v];
  });
  renderRowsHtml(
    "by-review",
    reviewRows,
  );

  const imageRows = countBy(
    filteredLogs.filter((x) => x.eventType === "image_download"),
    (x) => x?.details?.fileName || "(sin nombre)",
  ).map(([fileName, count]) => [imageLinkHtml(fileName), count]);
  renderRowsHtml(
    "by-image",
    imageRows,
  );

  renderRows(
    "by-month",
    countBy(pageViews, (x) => String(x.timestampServer || "").slice(0, 7)),
  );

  renderRows("by-event", countBy(filteredLogs, (x) => x.eventType || "unknown"));
}

async function renderReportFromCache() {
  await renderReport(allLogsCache);
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
  allLogsCache = logs;
  await renderReportFromCache();
  const visibleCount = selectedCountry
    ? logs.filter((x) => String(x.country || "XX").toUpperCase() === selectedCountry).length
    : logs.length;
  setStatus(`Actualizado: ${new Date().toLocaleString("es-CO")} · ${fmt(visibleCount)} eventos visibles`);
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

