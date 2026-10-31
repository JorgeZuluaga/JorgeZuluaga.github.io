(() => {
  "use strict";

  const API = window.BOOKLOC_API || "https://booklocation-worker.booklocation-jorgezuluaga.workers.dev";
  const $ = (id) => document.getElementById(id);
  const ZXING_URL = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";

  let data = { locations: {}, books: {} };
  let catalog = new Map(); // isbn13 -> {title, author, isbn}
  let currentLoc = localStorage.getItem("bl_cur_loc") || "";
  let scanHandler = null;
  let stream = null;
  let scanTimer = null;
  let editing = ""; // código de la ubicación que se está renombrando

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function status(msg, isErr) {
    const el = $("status");
    el.textContent = msg || "";
    el.className = isErr ? "bl-err" : "bl-muted";
  }

  // ISBN-10 -> ISBN-13 para que ambos formatos coincidan.
  function normIsbn(raw) {
    const s = String(raw || "").replace(/[\s-]/g, "").toUpperCase();
    if (/^\d{13}$/.test(s)) return s;
    if (/^\d{9}[\dX]$/.test(s)) {
      const core = "978" + s.slice(0, 9);
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1);
      return core + ((10 - (sum % 10)) % 10);
    }
    return "";
  }

  function slug(name) {
    return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  }

  // ---------- API ----------
  // Pide el token con un formulario dentro de la página (sin diálogos del navegador).
  function token() {
    const saved = localStorage.getItem("bl_token");
    if (saved) return Promise.resolve(saved);
    const box = $("token-box");
    box.hidden = false;
    $("token-input").focus();
    return new Promise((resolve) => {
      box.onsubmit = (e) => {
        e.preventDefault();
        const t = $("token-input").value.trim();
        if (!t) return;
        localStorage.setItem("bl_token", t);
        $("token-input").value = "";
        box.hidden = true;
        resolve(t);
      };
    });
  }
  async function api(path, body) {
    const res = await fetch(API + path, {
      method: body ? "POST" : "GET",
      headers: { authorization: "Bearer " + (await token()), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      localStorage.removeItem("bl_token");
      throw new Error("Token incorrecto: vuelve a intentarlo.");
    }
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json.error || "Error " + res.status);
    return json.data || json;
  }

  // ---------- Datos ----------
  async function loadCatalog() {
    const add = (title, author, isbn, cover) => {
      const k = normIsbn(isbn);
      if (!k) return;
      if (!catalog.has(k)) catalog.set(k, { title: title || "(sin título)", author: author || "", isbn: k, cover: cover || "" });
      else if (cover && !catalog.get(k).cover) catalog.get(k).cover = cover;
    };
    const [lib, det] = await Promise.all([
      fetch("./info/library.json").then((r) => r.json()).catch(() => ({})),
      fetch("./info/library-details.json").then((r) => r.json()).catch(() => ({})),
    ]);
    (lib.books || []).forEach((b) => add(b.title, b.author, b.isbn, b.reviewLocalCoverUrl));
    (det.books || []).forEach((b) => add(b.Title, b.Author, b.ISBN));
  }
  async function loadLocations() {
    data = await api("/booklocation.json");
  }

  const locName = (code) => data.locations[code]?.name || code;

  // ---------- Escáner ----------
  function loadZXing() {
    if (window.ZXing) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = ZXING_URL;
      s.onload = resolve;
      s.onerror = () => reject(new Error("No se pudo cargar el lector de códigos"));
      document.head.appendChild(s);
    });
  }

  async function startScan(handler) {
    stopScan();
    scanHandler = handler;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch {
      status("No se pudo abrir la cámara (necesita HTTPS y permiso).", true);
      return;
    }
    const video = $("video");
    video.srcObject = stream;
    await video.play();
    $("scanner").hidden = false;
    status("Apunta al código de barras…");

    // Detector nativo si existe (puede fallar con ciertos formatos, p. ej. en iOS); ZXing siempre como respaldo.
    let native = null;
    if ("BarcodeDetector" in window) {
      try { native = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "code_128", "qr_code"] }); } catch { native = null; }
    }
    await loadZXing();
    const Z = window.ZXing;
    const reader = new Z.MultiFormatReader();
    reader.setHints(new Map([
      [Z.DecodeHintType.TRY_HARDER, true],
      [Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.QR_CODE]],
    ]));
    const canvas = document.createElement("canvas");
    const detect = async () => {
      if (!video.videoWidth) return undefined;
      if (native) {
        try {
          const r = (await native.detect(video))[0]?.rawValue;
          if (r) return r;
        } catch { native = null; }
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0);
      const src = new Z.HTMLCanvasElementLuminanceSource(canvas);
      for (const bmp of [new Z.BinaryBitmap(new Z.HybridBinarizer(src)), new Z.BinaryBitmap(new Z.HybridBinarizer(src.invert()))]) {
        try { return reader.decode(bmp).getText(); } catch { /* sin código en este cuadro */ }
      }
      return undefined;
    };

    let last = "";
    let lastAt = 0;
    scanTimer = setInterval(async () => {
      const code = await detect().catch(() => undefined);
      if (!code) return;
      const now = Date.now();
      if (code === last && now - lastAt < 2500) return;
      last = code;
      lastAt = now;
      if (navigator.vibrate) navigator.vibrate(60);
      status("");
      scanHandler && scanHandler(code.trim());
    }, 250);
  }

  function stopScan() {
    clearInterval(scanTimer);
    scanTimer = null;
    scanHandler = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    $("scanner").hidden = true;
  }

  // ---------- Buscar ----------
  // ---------- Búsqueda en línea (solo si el ISBN no está en el catálogo) ----------
  const online = new Map(); // isbn -> {title, author, cover, source} | null (no encontrado) | "pending"

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function lookupOnline(isbn) {
    if (online.has(isbn)) return online.get(isbn);
    online.set(isbn, "pending");
    let found = null;
    try {
      const g = await fetchJson("https://www.googleapis.com/books/v1/volumes?q=isbn:" + isbn + "&maxResults=1");
      const v = g.items?.[0]?.volumeInfo;
      if (v?.title) {
        found = {
          title: [v.title, v.subtitle].filter(Boolean).join(": "),
          author: (v.authors || []).join(", "),
          cover: (v.imageLinks?.thumbnail || "").replace(/^http:/, "https:"),
          source: "Google Books",
        };
      }
    } catch { /* se intenta Open Library */ }
    if (!found) {
      try {
        const o = (await fetchJson("https://openlibrary.org/api/books?bibkeys=ISBN:" + isbn + "&format=json&jscmd=data"))["ISBN:" + isbn];
        if (o?.title) {
          found = {
            title: [o.title, o.subtitle].filter(Boolean).join(": "),
            author: (o.authors || []).map((a) => a.name).join(", "),
            cover: o.cover?.medium || "",
            source: "Open Library",
          };
        }
      } catch { /* sin resultado */ }
    }
    online.set(isbn, found);
    return found;
  }

  function coverCandidates(isbn, b) {
    const list = [];
    if (b?.cover) list.push(b.cover);
    ["png", "jpg", "webp", "jpeg"].forEach((e) => list.push(`./antilibrary/covers/${isbn}.${e}`));
    return list;
  }

  function coverHtml(list) {
    if (!list.length) return "";
    return `<img class="bl-cover" alt="" loading="lazy" src="${esc(list[0])}" data-rest="${esc(JSON.stringify(list.slice(1)))}" />`;
  }

  // Si una portada no carga, prueba la siguiente; si no hay más, la oculta.
  function onCoverError(e) {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains("bl-cover")) return;
    let rest = [];
    try { rest = JSON.parse(img.dataset.rest || "[]"); } catch { rest = []; }
    if (rest.length) {
      img.dataset.rest = JSON.stringify(rest.slice(1));
      img.src = rest[0];
    } else {
      img.remove();
    }
  }

  function bookCard(isbn) {
    let b = catalog.get(isbn);
    let note = "";
    if (!b) {
      const o = online.get(isbn);
      if (o === undefined || o === "pending") {
        if (o === undefined) lookupOnline(isbn).then(renderSearch);
        note = "No está en tu catálogo. Buscando el ISBN en Google Books…";
      } else if (o) {
        b = o;
        note = "No está en tu catálogo; encontrado en " + o.source + ".";
      } else {
        note = "No está en tu catálogo ni se encontró el ISBN en Google Books u Open Library.";
      }
    }
    const loc = data.books[isbn]?.location;
    const opts = Object.entries(data.locations)
      .map(([c, l]) => `<option value="${esc(c)}"${c === loc ? " selected" : ""}>${esc(l.name)}</option>`).join("");
    const cover = coverHtml(b ? (catalog.has(isbn) ? coverCandidates(isbn, b) : [b.cover].filter(Boolean)) : []);
    return `<div class="bl-card bl-book">${cover}<div class="bl-book__body"><strong>${esc(b?.title || "ISBN " + isbn)}</strong>
      <div class="bl-muted">${esc(b?.author || "")} · ${esc(isbn)}</div>
      ${note ? `<div class="bl-muted">${esc(note)}</div>` : ""}
      <div>${loc ? `📍 <span class="bl-loc">${esc(locName(loc))}</span>` : '<span class="bl-muted">Sin ubicación registrada</span>'}</div>
      <div class="bl-row"><select data-move-sel="${esc(isbn)}"><option value="">${loc ? "Mover a…" : "Asignar a…"}</option>${opts}</select>
      <button class="bl-btn" data-move="${esc(isbn)}">Guardar</button>${loc ? `<button class="bl-btn" data-unassign="${esc(isbn)}">Quitar</button>` : ""}</div></div></div>`;
  }

  function renderSearch() {
    const q = $("q").value.trim().toLowerCase();
    const out = $("results");
    if (q.length < 2) { out.innerHTML = ""; return; }
    const digits = normIsbn(q);
    const hits = [];
    for (const [isbn, b] of catalog) {
      if (isbn === digits || (b.title + " " + b.author).toLowerCase().includes(q)) hits.push(isbn);
      if (hits.length >= 30) break;
    }
    if (digits && !catalog.has(digits)) hits.push(digits);
    // Con ubicación primero.
    hits.sort((a, b) => Number(!!data.books[b]) - Number(!!data.books[a]));
    out.innerHTML = hits.length ? hits.map(bookCard).join("") : '<p class="bl-muted">Sin resultados.</p>';
  }

  // ---------- Asignar ----------
  function renderCurLoc() {
    $("cur-loc").textContent = currentLoc ? "📍 " + locName(currentLoc) : "Escanea el código de una ubicación";
  }
  function logLine(html, cls) {
    const d = document.createElement("div");
    d.className = "bl-card " + (cls || "");
    d.innerHTML = html;
    $("a-log").prepend(d);
  }

  async function handleAssignCode(raw) {
    const code = String(raw).trim();
    if (/^LOC-/i.test(code)) {
      const key = "LOC-" + code.slice(4);
      if (!data.locations[key]) { logLine("Ubicación desconocida: " + esc(code), "err"); return; }
      currentLoc = key;
      localStorage.setItem("bl_cur_loc", key);
      renderCurLoc();
      logLine("Ubicación: <strong>" + esc(locName(key)) + "</strong>");
      return;
    }
    const isbn = normIsbn(code);
    if (!isbn) { logLine("Código no reconocido: " + esc(code), "err"); return; }
    if (!currentLoc) { logLine("Primero escanea una ubicación.", "err"); return; }
    try {
      data = await api("/assign", { isbn, location: currentLoc });
      let title = catalog.get(isbn)?.title;
      if (!title) title = (await lookupOnline(isbn).catch(() => null))?.title;
      logLine("✅ " + esc(title || "ISBN " + isbn + " (no encontrado en ningún catálogo)") + " → <span class=\"bl-loc\">" + esc(locName(currentLoc)) + "</span>");
    } catch (e) {
      logLine(esc(e.message), "err");
    }
  }

  // ---------- Ubicaciones / etiquetas ----------
  function renderLocs() {
    const counts = {};
    Object.values(data.books).forEach((b) => { counts[b.location] = (counts[b.location] || 0) + 1; });
    const entries = Object.entries(data.locations);
    $("l-sheet-row").hidden = !entries.length;
    $("l-list").innerHTML = entries.length
      ? entries.map(([code, l]) => `<div class="bl-card"><strong>${esc(l.name)}</strong>
          <div class="bl-muted">${esc(code)} · ${counts[code] || 0} libros</div>
          <div class="bl-row"><button class="bl-btn" data-show="${esc(code)}">Etiqueta</button><button class="bl-btn" data-rename="${esc(code)}">Renombrar</button><button class="bl-btn" data-del="${esc(code)}">Borrar</button></div></div>`).join("")
      : '<p class="bl-muted">Aún no hay ubicaciones.</p>';
  }

  function barcodeSvg(code) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svg, code, { format: "CODE128", width: 2, height: 80, displayValue: true, margin: 10 });
    return svg;
  }

  function buildSheet() {
    const codes = Object.keys(data.locations);
    if (!codes.length) { status("No hay ubicaciones.", true); return false; }
    if (!window.JsBarcode) { status("Generador de códigos aún cargando; reintenta.", true); return false; }
    const sheet = $("l-sheet");
    sheet.innerHTML = codes.map((c) => `<div class="bl-cell"><div>${esc(locName(c))}</div><div data-code="${esc(c)}"></div></div>`).join("");
    sheet.querySelectorAll("[data-code]").forEach((d) => d.appendChild(barcodeSvg(d.dataset.code)));
    sheet.hidden = false;
    return true;
  }

  // Dibuja la matriz de etiquetas en un canvas y la descarga como PNG.
  async function downloadSheet() {
    const codes = Object.keys(data.locations);
    if (!buildSheet()) return;
    const cols = 3, cw = 360, ch = 190, pad = 10;
    const rows = Math.ceil(codes.length / cols);
    const canvas = document.createElement("canvas");
    canvas.width = cols * cw + pad * 2;
    canvas.height = rows * ch + pad * 2;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < codes.length; i++) {
      const x = pad + (i % cols) * cw;
      const y = pad + Math.floor(i / cols) * ch;
      ctx.strokeStyle = "#999";
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x + 2, y + 2, cw - 4, ch - 4);
      ctx.fillStyle = "#000";
      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(locName(codes[i]).slice(0, 34), x + cw / 2, y + 26);
      const svg = barcodeSvg(codes[i]);
      const w = svg.getAttribute("width").replace("px", "");
      const h = svg.getAttribute("height").replace("px", "");
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      });
      const scale = Math.min((cw - 20) / w, (ch - 50) / h, 1.5);
      ctx.drawImage(img, x + (cw - w * scale) / 2, y + 40, w * scale, h * scale);
    }
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "etiquetas-ubicaciones.png";
    a.click();
  }

  function printSheet() {
    if (!buildSheet()) return;
    document.body.classList.add("print-sheet");
    window.addEventListener("afterprint", () => document.body.classList.remove("print-sheet"), { once: true });
    window.print();
  }

  function showLabel(code) {
    const box = $("l-label");
    box.hidden = false;
    $("l-print-row").hidden = false;
    box.innerHTML = `<div><strong>${esc(locName(code))}</strong></div><svg id="l-svg"></svg>`;
    if (window.JsBarcode) {
      JsBarcode("#l-svg", code, { format: "CODE128", width: 2, height: 80, displayValue: true });
    } else {
      status("Generador de códigos aún cargando; reintenta.", true);
    }
  }

  async function addLocation() {
    const name = $("l-name").value.trim();
    const s = slug(name);
    if (!s) { status("Escribe un nombre.", true); return; }
    const code = editing || "LOC-" + s;
    try {
      data = await api("/location", { code, name });
      $("l-name").value = "";
      $("l-add").textContent = "Crear";
      const wasEditing = editing;
      editing = "";
      renderLocs();
      if (!wasEditing) showLabel(code);
      status("");
    } catch (e) { status(e.message, true); }
  }

  // ---------- UI ----------
  function setTab(tab) {
    stopScan();
    document.querySelectorAll("nav.bl-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    ["search", "assign", "locs"].forEach((t) => { $("tab-" + t).hidden = t !== tab; });
    if (tab === "locs") renderLocs();
    if (tab === "assign") renderCurLoc();
  }

  async function init() {
    document.querySelectorAll("nav.bl-tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
    $("scan-stop").onclick = stopScan;
    $("q").addEventListener("input", renderSearch);
    $("results").addEventListener("error", onCoverError, true);
    $("q-scan").onclick = () => startScan((code) => {
      const isbn = normIsbn(code);
      if (!isbn) { status("Código no reconocido: " + code, true); return; }
      stopScan();
      $("q").value = isbn;
      renderSearch();
    });
    $("a-scan").onclick = () => startScan(handleAssignCode);
    const manual = () => { const v = $("a-manual").value; $("a-manual").value = ""; if (v.trim()) handleAssignCode(v); };
    $("a-add").onclick = manual;
    $("a-manual").addEventListener("keydown", (e) => { if (e.key === "Enter") manual(); });
    $("l-add").onclick = addLocation;
    $("l-sheet-png").onclick = () => downloadSheet().catch((e) => status(e.message || "No se pudo generar la imagen", true));
    $("l-sheet-print").onclick = printSheet;
    $("l-print").onclick = () => { document.body.classList.remove("print-sheet"); window.print(); };
    $("reset-token").onclick = () => { localStorage.removeItem("bl_token"); location.reload(); };
    $("results").addEventListener("click", async (e) => {
      const mv = e.target.dataset.move;
      const un = e.target.dataset.unassign;
      try {
        if (mv) {
          const sel = e.target.parentElement.querySelector("select").value;
          if (!sel) { status("Elige una ubicación.", true); return; }
          data = await api("/assign", { isbn: mv, location: sel });
        } else if (un) {
          data = await api("/unassign", { isbn: un });
        } else return;
        status("Guardado ✅");
        renderSearch();
      } catch (err) { status(err.message, true); }
    });
    $("l-list").addEventListener("click", async (e) => {
      const ren = e.target.dataset.rename;
      if (ren) {
        editing = ren;
        $("l-name").value = data.locations[ren]?.name || "";
        $("l-add").textContent = "Guardar nombre";
        $("l-name").focus();
        return;
      }
      const show = e.target.dataset.show;
      const del = e.target.dataset.del;
      if (show) showLabel(show);
      if (del && e.target.dataset.armed !== "1") {
        e.target.dataset.armed = "1";
        e.target.textContent = "¿Seguro? Pulsa de nuevo";
        return;
      }
      if (del) {
        try {
          data = await api("/location-delete", { code: del });
          if (currentLoc === del) { currentLoc = ""; localStorage.removeItem("bl_cur_loc"); }
          renderLocs();
        } catch (err) { status(err.message, true); }
      }
    });

    loadAll();
  }

  async function loadAll(retry) {
    if (!retry) status("Cargando…");
    try {
      await Promise.all([loadCatalog(), loadLocations()]);
      status("");
      renderSearch();
    } catch (e) {
      status(e.message, true);
      if (!localStorage.getItem("bl_token")) loadAll(true);
    }
  }

  init();
})();
