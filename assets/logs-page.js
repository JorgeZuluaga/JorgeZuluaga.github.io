const TOKEN_STORAGE_KEY = "visitorLogsReadToken";
let allLogsCache = [];
let selectedCountry = "";
let selectedRangeDays = 7;

function endpointFromMeta() {
  const el = document.querySelector('meta[name="visitor-log-read-endpoint"]');
  return String(el?.getAttribute("content") ?? "").trim();
}

function fmt(n) {
  return Number(n || 0).toLocaleString("es-CO");
}

function normalizePagePath(rawPath) {
  const value = String(rawPath || "").trim();
  if (!value) return "";
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, "/");
  return collapsed || "/";
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

function dateKeyLocal(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function plusDays(dateObj, deltaDays) {
  const copy = new Date(dateObj);
  copy.setDate(copy.getDate() + deltaDays);
  return copy;
}

function formatShortDate(dateObj) {
  const dd = String(dateObj.getDate()).padStart(2, "0");
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function formatLastEventTimestamp(logs) {
  const latest = logs.reduce((best, row) => {
    const raw = String(row?.timestampServer || "").trim();
    if (!raw) return best;
    const ts = Date.parse(raw);
    if (Number.isNaN(ts)) return best;
    if (!best || ts > best.ts) return { ts, raw };
    return best;
  }, null);
  if (!latest) return "Sin datos";
  return new Date(latest.raw).toLocaleString("es-CO");
}

function buildTimeSeries(logs, days) {
  const safeDays = Math.max(1, Number(days) || 7);
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = plusDays(end, -(safeDays - 1));
  const rows = [];
  const byDay = new Map();

  for (let i = 0; i < safeDays; i += 1) {
    const dt = plusDays(start, i);
    const key = dateKeyLocal(dt);
    byDay.set(key, { date: dt, events: 0, ipSet: new Set() });
  }

  for (const log of logs) {
    const rawTs = String(log?.timestampServer || "").trim();
    if (!rawTs) continue;
    const dt = new Date(rawTs);
    if (Number.isNaN(dt.getTime())) continue;
    const key = dateKeyLocal(dt);
    const bucket = byDay.get(key);
    if (!bucket) continue;
    bucket.events += 1;
    const ip = String(log?.ip || "").trim();
    if (ip) bucket.ipSet.add(ip);
  }

  for (const [, bucket] of byDay) {
    rows.push({
      date: bucket.date,
      label: formatShortDate(bucket.date),
      events: bucket.events,
      visitors: bucket.ipSet.size,
    });
  }

  return rows;
}

function pointsForSeries(series, valueSelector, width, height, padX, padTop, padBottom, maxY) {
  const n = series.length;
  const plotW = Math.max(1, width - 2 * padX);
  const plotH = Math.max(1, height - padTop - padBottom);
  return series.map((row, idx) => {
    const x = padX + (n === 1 ? plotW / 2 : (idx / (n - 1)) * plotW);
    const raw = Number(valueSelector(row) || 0);
    const y = padTop + (1 - raw / maxY) * plotH;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
}

function pointDataForSeries(series, valueSelector, width, height, padX, padTop, padBottom, maxY) {
  const n = series.length;
  const plotW = Math.max(1, width - 2 * padX);
  const plotH = Math.max(1, height - padTop - padBottom);
  return series.map((row, idx) => {
    const x = padX + (n === 1 ? plotW / 2 : (idx / (n - 1)) * plotW);
    const value = Number(valueSelector(row) || 0);
    const y = padTop + (1 - value / maxY) * plotH;
    return { x, y, value, label: row.label };
  });
}

function wireTimeSeriesTooltip(host) {
  if (!host) return;
  host.style.position = "relative";
  let tooltip = host.querySelector(".logs-chart-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "logs-chart-tooltip";
    Object.assign(tooltip.style, {
      position: "absolute",
      left: "0px",
      top: "0px",
      transform: "translate(-50%, calc(-100% - 10px))",
      background: "rgba(15, 23, 42, 0.94)",
      color: "#fff",
      fontSize: "12px",
      lineHeight: "1.2",
      borderRadius: "6px",
      padding: "6px 8px",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity .12s ease",
      zIndex: "10",
    });
    host.appendChild(tooltip);
  }

  const show = (evt) => {
    const target = evt.currentTarget;
    const text = String(target?.getAttribute("data-tooltip") || "").trim();
    if (!text) return;
    tooltip.textContent = text;
    tooltip.style.left = `${evt.offsetX}px`;
    tooltip.style.top = `${evt.offsetY}px`;
    tooltip.style.opacity = "1";
  };

  const move = (evt) => {
    tooltip.style.left = `${evt.offsetX}px`;
    tooltip.style.top = `${evt.offsetY}px`;
  };

  const hide = () => {
    tooltip.style.opacity = "0";
  };

  host.querySelectorAll(".logs-chart-point").forEach((point) => {
    point.addEventListener("mouseenter", show);
    point.addEventListener("mousemove", move);
    point.addEventListener("mouseleave", hide);
    point.addEventListener("blur", hide);
  });
}

function renderTimeSeries(logs) {
  const host = document.getElementById("logs-timeseries");
  if (!host) return;
  const series = buildTimeSeries(logs, selectedRangeDays);
  const maxY = Math.max(
    1,
    ...series.map((x) => x.events),
    ...series.map((x) => x.visitors),
  );
  const width = 920;
  const height = 280;
  const padX = 40;
  const padTop = 16;
  const padBottom = 36;
  const yTickCount = 4;
  const yTicks = [];
  for (let i = 0; i <= yTickCount; i += 1) {
    const yValue = (maxY * i) / yTickCount;
    yTicks.push(Math.round(yValue));
  }
  const uniqueTicks = [...new Set(yTicks)];

  if (!series.length) {
    host.innerHTML = '<p class="logs-chart-empty">Sin datos para el rango seleccionado.</p>';
    return;
  }

  const eventsPoints = pointsForSeries(
    series,
    (r) => r.events,
    width,
    height,
    padX,
    padTop,
    padBottom,
    maxY,
  ).join(" ");
  const visitorsPoints = pointsForSeries(
    series,
    (r) => r.visitors,
    width,
    height,
    padX,
    padTop,
    padBottom,
    maxY,
  ).join(" ");
  const eventsPointData = pointDataForSeries(
    series,
    (r) => r.events,
    width,
    height,
    padX,
    padTop,
    padBottom,
    maxY,
  );
  const visitorsPointData = pointDataForSeries(
    series,
    (r) => r.visitors,
    width,
    height,
    padX,
    padTop,
    padBottom,
    maxY,
  );

  const plotH = Math.max(1, height - padTop - padBottom);
  const grid = uniqueTicks
    .map((tick) => {
      const y = padTop + (1 - tick / maxY) * plotH;
      return `<line x1="${padX}" y1="${y.toFixed(2)}" x2="${(width - padX).toFixed(2)}" y2="${y.toFixed(2)}" stroke="rgba(128,128,128,0.25)" stroke-width="1" />
      <text x="${(padX - 8).toFixed(2)}" y="${(y + 4).toFixed(2)}" text-anchor="end" font-size="11" fill="var(--black)" opacity="0.8">${tick}</text>`;
    })
    .join("");

  const xLabelsStep = Math.max(1, Math.floor(series.length / 8));
  const xLabels = series
    .map((row, idx) => {
      if (idx % xLabelsStep !== 0 && idx !== series.length - 1) return "";
      const x = padX + (series.length === 1 ? (width - 2 * padX) / 2 : (idx / (series.length - 1)) * (width - 2 * padX));
      return `<text x="${x.toFixed(2)}" y="${(height - 10).toFixed(2)}" text-anchor="middle" font-size="11" fill="var(--black)" opacity="0.8">${row.label}</text>`;
    })
    .join("");
  const eventDots = eventsPointData
    .map(
      (p) =>
        `<circle class="logs-chart-point" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="5" fill="var(--accent)" data-tooltip="${escapeHtml(`${p.label}: ${fmt(p.value)} eventos`)}" />`,
    )
    .join("");
  const visitorDots = visitorsPointData
    .map(
      (p) =>
        `<circle class="logs-chart-point" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="5" fill="#16a34a" data-tooltip="${escapeHtml(`${p.label}: ${fmt(p.value)} visitantes únicos`)}" />`,
    )
    .join("");

  host.innerHTML = `<svg class="logs-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Serie temporal de eventos y visitantes únicos">
    ${grid}
    <polyline fill="none" stroke="var(--accent)" stroke-width="2.5" points="${eventsPoints}" />
    <polyline fill="none" stroke="#16a34a" stroke-width="2.5" points="${visitorsPoints}" />
    ${eventDots}
    ${visitorDots}
    ${xLabels}
  </svg>`;
  wireTimeSeriesTooltip(host);
}

function renderSummary(logs) {
  const box = document.getElementById("logs-summary");
  if (!box) return;
  const uniqueIps = new Set(logs.map((x) => x.ip).filter(Boolean)).size;
  const uniquePages = new Set(logs.map((x) => normalizePagePath(x.page)).filter(Boolean)).size;
  const imageDownloads = logs.filter((x) => x.eventType === "image_download").length;
  const pdfClicks = logs.filter((x) => x.eventType === "pdf_print_click").length;
  const lastEvent = formatLastEventTimestamp(logs);
  const reviewOpens = logs.filter(
    (x) => x.eventType === "page_view" && /\/reviews\/\d+\.html$/.test(normalizePagePath(x.page)),
  ).length;

  box.innerHTML = [
    ["Total eventos", fmt(logs.length)],
    ["IPs únicas", fmt(uniqueIps)],
    ["Páginas únicas", fmt(uniquePages)],
    ["Reseñas abiertas", fmt(reviewOpens)],
    ["Descargas imagen", fmt(imageDownloads)],
    ["Clic PDF", fmt(pdfClicks)],
    ["Último evento", lastEvent],
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
  const visibleCountryRows = selectedCountry
    ? countryRows.filter(([code]) => String(code || "").toUpperCase() === selectedCountry)
    : countryRows;
  const visibleCountryTotal = visibleCountryRows.reduce((acc, [, c]) => acc + c, 0);
  renderRowsHtml(
    "by-country",
    visibleCountryRows.map(([code, count]) => {
      const baseTotal = selectedCountry ? visibleCountryTotal : countryTotal;
      const pct = baseTotal > 0 ? ((count / baseTotal) * 100).toFixed(1) : "0.0";
      return [countryLabel(code), `${fmt(count)} (${pct}%)`];
    }),
  );
  renderCountryFilterStatus();

  const filteredLogs = selectedCountry
    ? logs.filter((x) => String(x.country || "XX").toUpperCase() === selectedCountry)
    : logs;
  renderTimeSeries(filteredLogs);

  const reviewTitleMap = await buildReviewTitleMap();
  renderSummary(filteredLogs);

  const pageViews = filteredLogs.filter((x) => x.eventType === "page_view");
  const reviewPathRegex = /\/reviews\/\d+\.html$/;
  const nonReviewPageViews = pageViews.filter((x) => !reviewPathRegex.test(normalizePagePath(x.page)));
  renderRows("by-page", countBy(nonReviewPageViews, (x) => normalizePagePath(x.page) || "(sin página)"));

  const reviewViews = pageViews.filter((x) => reviewPathRegex.test(normalizePagePath(x.page)));
  const reviewRows = countBy(reviewViews, (x) => {
    const normalizedPath = normalizePagePath(x.page);
    const reviewId = reviewIdFromPath(normalizedPath);
    if (!reviewId) return "(reseña sin id)";
    const title = reviewTitleMap.get(reviewId) || "Libro no encontrado en library.json";
    return `${normalizedPath}|||${title}`;
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
    let backendError = "";
    try {
      const payload = await res.json();
      const err = String(payload?.error || "").trim();
      const msg = String(payload?.message || "").trim();
      if (err && msg) backendError = `${err}: ${msg}`;
      else if (err) backendError = err;
      else if (msg) backendError = msg;
    } catch {
      backendError = "";
    }
    if (res.status === 401) throw new Error("Token inválido.");
    if (backendError) throw new Error(`Error HTTP ${res.status} (${backendError})`);
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

  const rangeBox = document.getElementById("logs-range-buttons");
  rangeBox?.querySelectorAll("[data-range-days]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const days = Number(btn.getAttribute("data-range-days") || 7);
      selectedRangeDays = Math.max(1, days);
      rangeBox.querySelectorAll("[data-range-days]").forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      renderReportFromCache().catch((e) => {
        setError(e.message || "No fue posible actualizar la curva temporal.");
      });
    });
  });
}

wire();
loadLogs().catch((e) => {
  setError(e.message || "No fue posible cargar logs.");
  setStatus("Error de consulta.");
});

