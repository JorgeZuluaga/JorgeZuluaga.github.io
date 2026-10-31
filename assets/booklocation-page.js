(() => {
  "use strict";

  const API = window.BOOKLOC_API || "https://booklocation-worker.booklocation-jorgezuluaga.workers.dev";
  const $ = (id) => document.getElementById(id);
  const ZXING_URL = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";

  let data = { locations: {}, books: {} };
  let catalog = new Map(); // isbn13 -> {title, author, isbn}
  let currentLoc = ""; // ubicación activa en «Asignar» (solo en memoria)
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
    const [lib, det, aliases] = await Promise.all([
      fetch("./info/library.json").then((r) => r.json()).catch(() => ({})),
      fetch("./info/library-details.json").then((r) => r.json()).catch(() => ({})),
      fetch("./info/booklocation-aliases.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    (lib.books || []).forEach((b) => add(b.title, b.author, b.isbn, b.reviewLocalCoverUrl));
    (det.books || []).forEach((b) => add(b.Title, b.Author, b.ISBN));
    // ISBN escaneado distinto al del catálogo (generado por bin/reconcile_booklocation.py).
    Object.entries(aliases.aliases || {}).forEach(([scanned, target]) => {
      const t = catalog.get(normIsbn(target));
      if (t && !catalog.has(scanned)) catalog.set(scanned, { ...t, isbn: scanned });
    });
  }
  async function loadLocations() {
    data = await api("/booklocation.json");
  }

  // Ubicaciones en orden alfabético (ignora mayúsculas y acentos).
  const sortedLocs = () => Object.entries(data.locations)
    .sort((a, b) => a[1].name.localeCompare(b[1].name, "es", { sensitivity: "base", numeric: true }));

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

  let scanId = 0;

  async function startScan(handler) {
    stopScan();
    const id = ++scanId;
    scanHandler = handler;
    let st;
    try {
      st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch {
      status("No se pudo abrir la cámara (necesita HTTPS y permiso). Puedes escribir el dato abajo.", true);
      return;
    }
    if (id !== scanId) { st.getTracks().forEach((t) => t.stop()); return; }
    stream = st;
    const video = $("video");
    video.srcObject = stream;
    await video.play().catch(() => {});
    if (id !== scanId) return;
    $("scanner").hidden = false;

    // Detector nativo si existe (puede fallar con ciertos formatos, p. ej. en iOS); ZXing siempre como respaldo.
    let native = null;
    if ("BarcodeDetector" in window) {
      try { native = new BarcodeDetector({ formats: ["qr_code", "ean_13", "ean_8", "upc_a", "code_128"] }); } catch { native = null; }
    }
    await loadZXing();
    if (id !== scanId) return;
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
      if (!code || id !== scanId) return;
      const now = Date.now();
      if (code === last && now - lastAt < 2500) return;
      last = code;
      lastAt = now;
      if (navigator.vibrate) navigator.vibrate(60);
      scanHandler && scanHandler(code.trim());
    }, 250);
  }

  function stopScan() {
    scanId++;
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

  // Título/autor a guardar junto a la asignación cuando el ISBN no está en el catálogo.
  function extraFor(isbn, typed) {
    if (catalog.has(isbn)) return {};
    const o = online.get(isbn);
    const t = typed || (o && o !== "pending" ? o.title : "") || data.books[isbn]?.title || "";
    const a = (o && o !== "pending" ? o.author : "") || data.books[isbn]?.author || "";
    return { ...(t ? { title: t } : {}), ...(a ? { author: a } : {}) };
  }

  function bookCard(isbn) {
    let b = catalog.get(isbn);
    const stored = data.books[isbn];
    if (b && stored?.title) b = { ...b, title: stored.title, author: stored.author || b.author };
    let note = "";
    if (!b && data.books[isbn]?.title) {
      b = { title: data.books[isbn].title, author: data.books[isbn].author || "", cover: "" };
      note = "Título escrito por ti (ISBN fuera del catálogo).";
    }
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
    const opts = sortedLocs()
      .map(([c, l]) => `<option value="${esc(c)}"${c === loc ? " selected" : ""}>${esc(l.name)}</option>`).join("");
    const cover = coverHtml(b ? (catalog.has(isbn) ? coverCandidates(isbn, b) : [b.cover].filter(Boolean)) : []);
    return `<div class="bl-card bl-book">${cover}<div class="bl-book__body"><strong>${esc(b?.title || "ISBN " + isbn)}</strong>
      <div class="bl-muted">${esc(b?.author || "")} · ${esc(isbn)}</div>
      ${note ? `<div class="bl-muted">${esc(note)}</div>` : ""}
      <div>${loc ? `📍 <span class="bl-loc">${esc(locName(loc))}</span>` : '<span class="bl-muted">Sin ubicación registrada</span>'}</div>
      ${!catalog.has(isbn) && !b?.title ? `<div class="bl-row"><input data-title-input="${esc(isbn)}" placeholder="Escribe el título (para conciliar después)" /></div>` : ""}
      <div class="bl-move"><select data-move-sel="${esc(isbn)}"><option value="">${loc ? "Mover a…" : "Asignar a…"}</option>${opts}</select>
      <div class="bl-row"><button class="bl-btn bl-primary" data-move="${esc(isbn)}">Guardar</button>
      <button class="bl-btn" data-move-scan="${esc(isbn)}">📷 Escanear destino</button>
      ${loc ? `<button class="bl-btn" data-unassign="${esc(isbn)}">Quitar</button>` : ""}</div></div></div></div>`;
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
  function bookLabel(isbn) {
    const c = catalog.get(isbn);
    const st = data.books[isbn];
    const title = st?.title || c?.title;
    const author = st?.author || c?.author || "";
    return title
      ? `<strong>${esc(title)}</strong> <span class="bl-muted">${esc(author)} · ${esc(isbn)}</span>`
      : `<strong>ISBN ${esc(isbn)}</strong> <span class="bl-muted">(sin título)</span>`;
  }

  function booksIn(code) {
    return Object.entries(data.books)
      .filter(([, b]) => b.location === code)
      .sort((a, b) => String(b[1].updatedAt).localeCompare(String(a[1].updatedAt)))
      .map(([isbn]) => isbn);
  }

  // attr: atributo data-* que marca cada libro como clicable.
  function listHtml(code, attr) {
    const isbns = booksIn(code);
    if (!isbns.length) return '<p class="bl-muted">Aún no hay libros aquí.</p>';
    return isbns.map((isbn) => `<div class="bl-item"><div class="bl-open" role="button" tabindex="0" ${attr}="${esc(isbn)}">${bookLabel(isbn)} <span class="bl-muted">›</span></div></div>`).join("");
  }

  // ---------- Asignar (flujo guiado: ubicación → libro → ficha) ----------
  const STEP_EL = { loc: "as-loc", main: "as-main", isbn: "as-isbn", form: "as-form" };
  let formIsbn = "";

  function showStep(step) {
    stopScan();
    Object.entries(STEP_EL).forEach(([k, id]) => { $(id).hidden = k !== step; });
    if (step === "loc") {
      fillLocSelect();
      $("as-loc-cancel").hidden = !currentLoc;
    } else if (step === "main") {
      renderMain();
    } else if (step === "isbn") {
      $("as-isbn-input").value = "";
    }
  }

  // La cámara es opcional: solo se abre con el botón 📷 de cada paso.
  function openLocCamera() {
    startScan((code) => {
      const key = locFromCode(code);
      if (!key) { status("Eso no es una ubicación conocida: " + code, true); return; }
      chooseLoc(key);
    });
  }

  function enterAssign() {
    showStep(currentLoc && data.locations[currentLoc] ? "main" : "loc");
  }

  function locFromCode(raw) {
    const m = String(raw).trim().match(/^LOC-(.+)$/i);
    const key = m ? "LOC-" + m[1] : "";
    return data.locations[key] ? key : "";
  }

  function fillLocSelect() {
    const entries = sortedLocs();
    $("as-loc-select").innerHTML = entries.length
      ? '<option value="">Elige una ubicación…</option>' + entries.map(([c, l]) => `<option value="${esc(c)}">${esc(l.name)}</option>`).join("")
      : '<option value="">No hay ubicaciones (créalas en «Ubicaciones»)</option>';
  }

  function chooseLoc(key) {
    currentLoc = key;
    status("");
    $("a-log").innerHTML = "";
    showStep("main");
  }

  function renderMain() {
    $("cur-loc").textContent = "📍 " + locName(currentLoc);
    $("a-books-title").textContent = `Libros en esta ubicación (${booksIn(currentLoc).length})`;
    $("a-books-list").innerHTML = listHtml(currentLoc, "data-edit");
  }

  function mainMessage(html) {
    $("a-log").innerHTML = `<div class="bl-card">${html}</div>`;
  }

  function submitIsbn(raw) {
    const isbn = normIsbn(raw);
    if (!isbn) { status("No es un ISBN válido: " + raw, true); return; }
    status("");
    openForm(isbn);
  }

  async function openForm(isbn) {
    formIsbn = isbn;
    showStep("form");
    const st = data.books[isbn];
    const c = catalog.get(isbn);
    $("af-isbn").textContent = isbn;
    $("af-title").value = st?.title || c?.title || "";
    $("af-author").value = st?.author || c?.author || "";
    $("af-loc").innerHTML = sortedLocs()
      .map(([code, l]) => `<option value="${esc(code)}"${code === currentLoc ? " selected" : ""}>${esc(l.name)}</option>`).join("");
    $("af-remove").hidden = !st;
    $("af-cover").innerHTML = coverHtml(coverCandidates(isbn, c));

    const notes = [];
    if (c) notes.push("Está en tu catálogo.");
    if (st && st.location !== currentLoc) notes.push(`Ya estaba en «${locName(st.location)}»; al guardar se moverá.`);
    else if (st) notes.push("Ya estaba en esta ubicación.");
    const noteEl = $("af-note");
    noteEl.textContent = notes.join(" ");

    if (!c && !st?.title) {
      noteEl.textContent = "Buscando en Google Books…";
      const o = await lookupOnline(isbn).catch(() => null);
      if (formIsbn !== isbn || $("as-form").hidden) return;
      if (o && o !== "pending") {
        if (!$("af-title").value) $("af-title").value = o.title;
        if (!$("af-author").value) $("af-author").value = o.author;
        if (o.cover && !$("af-cover").firstChild) $("af-cover").innerHTML = coverHtml([o.cover]);
        notes.unshift(`Encontrado en ${o.source}; revísalo.`);
      } else {
        notes.unshift("No está en tu catálogo ni en Google Books u Open Library: escribe título y autor.");
      }
      noteEl.textContent = notes.join(" ");
    }
  }

  async function saveForm(e) {
    e.preventDefault();
    const isbn = formIsbn;
    const location = $("af-loc").value;
    if (!location) { status("Elige una ubicación.", true); return; }
    const title = $("af-title").value.trim();
    const author = $("af-author").value.trim();
    const c = catalog.get(isbn);
    // Si coincide con el catálogo no se guarda copia del título/autor.
    const same = c && title === c.title && author === c.author;
    try {
      data = await api("/assign", { isbn, location, title: same ? "" : title, author: same ? "" : author });
      showStep("main");
      mainMessage("✅ " + esc(title || "ISBN " + isbn) + ' → <span class="bl-loc">' + esc(locName(location)) + "</span>");
    } catch (err) { status(err.message, true); }
  }

  async function removeForm() {
    const isbn = formIsbn;
    try {
      data = await api("/unassign", { isbn });
      showStep("main");
      mainMessage("🗑 Quitado: " + esc(catalog.get(isbn)?.title || "ISBN " + isbn));
    } catch (err) { status(err.message, true); }
  }

  // ---------- Ubicaciones / etiquetas ----------
  function renderLocs() {
    const counts = {};
    Object.values(data.books).forEach((b) => { counts[b.location] = (counts[b.location] || 0) + 1; });
    const entries = sortedLocs();
    $("l-sheet-row").hidden = !entries.length;
    $("l-list").innerHTML = entries.length
      ? entries.map(([code, l]) => `<div class="bl-card"><strong>${esc(l.name)}</strong>
          <div class="bl-muted">${esc(code)}</div>
          <details><summary>${counts[code] || 0} libros</summary>${listHtml(code, "data-open")}</details>
          <div class="bl-row"><button class="bl-btn" data-show="${esc(code)}">Etiqueta</button><button class="bl-btn" data-rename="${esc(code)}">Renombrar</button><button class="bl-btn" data-del="${esc(code)}">Borrar</button></div></div>`).join("")
      : '<p class="bl-muted">Aún no hay ubicaciones.</p>';
  }

  // Etiquetas en QR: más robustas que Code128 con códigos largos (y legibles desde cualquier ángulo).
  function barcodeSvg(code) {
    const qr = qrcode(0, "M");
    qr.addData(code);
    qr.make();
    const tpl = document.createElement("div");
    tpl.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: false });
    return tpl.firstElementChild;
  }

  function buildSheet() {
    const codes = Object.keys(data.locations);
    if (!codes.length) { status("No hay ubicaciones.", true); return false; }
    if (!window.qrcode) { status("Generador de códigos aún cargando; reintenta.", true); return false; }
    const sheet = $("l-sheet");
    sheet.innerHTML = codes.map((c) => `<div class="bl-cell"><div>${esc(locName(c))}</div><div data-code="${esc(c)}"></div><div class="bl-code">${esc(c)}</div></div>`).join("");
    sheet.querySelectorAll("[data-code]").forEach((d) => d.appendChild(barcodeSvg(d.dataset.code)));
    sheet.hidden = false;
    return true;
  }

  // Dibuja la matriz de etiquetas en un canvas y la descarga como PNG.
  async function downloadSheet() {
    const codes = Object.keys(data.locations);
    if (!buildSheet()) return;
    const cols = 3, cw = 360, ch = 330, pad = 10;
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
      const scale = Math.min((cw - 20) / w, (ch - 70) / h);
      ctx.drawImage(img, x + (cw - w * scale) / 2, y + 40, w * scale, h * scale);
      ctx.font = "11px monospace";
      ctx.fillText(codes[i], x + cw / 2, y + ch - 12);
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
    if (!window.qrcode) { status("Generador de códigos aún cargando; reintenta.", true); return; }
    box.innerHTML = `<div><strong>${esc(locName(code))}</strong></div>`;
    box.appendChild(barcodeSvg(code));
    box.insertAdjacentHTML("beforeend", `<div class="bl-code">${esc(code)}</div>`);
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
  // Abre la ficha de edición de un libro (cambiar ubicación o quitarlo).
  function openBook(isbn) {
    setTab("search");
    $("q").value = isbn;
    renderSearch();
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function onOpen(e) {
    const el = e.target.closest("[data-open]");
    if (!el) return;
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    openBook(el.dataset.open);
  }

  function setTab(tab) {
    stopScan();
    document.querySelectorAll("nav.bl-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    ["search", "assign", "locs"].forEach((t) => { $("tab-" + t).hidden = t !== tab; });
    if (tab === "locs") renderLocs();
    if (tab === "assign") enterAssign();
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
    $("as-loc-use").onclick = () => {
      const v = $("as-loc-select").value;
      if (!v) { status("Elige una ubicación.", true); return; }
      chooseLoc(v);
    };
    $("as-loc-cam").onclick = openLocCamera;
    $("as-isbn-cam").onclick = () => startScan((code) => submitIsbn(code));
    $("as-loc-cancel").onclick = () => showStep("main");
    $("as-change").onclick = () => showStep("loc");
    $("as-new").onclick = () => {
      showStep("isbn");
      startScan((code) => submitIsbn(code));
    };
    $("as-isbn-go").onclick = () => submitIsbn($("as-isbn-input").value);
    $("as-isbn-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitIsbn($("as-isbn-input").value); } });
    $("as-isbn-cancel").onclick = () => showStep("main");
    $("as-form").addEventListener("submit", saveForm);
    $("as-form").addEventListener("error", onCoverError, true);
    $("af-cancel").onclick = () => showStep("main");
    $("af-remove").onclick = removeForm;
    $("a-books-list").addEventListener("click", (e) => {
      const el = e.target.closest("[data-edit]");
      if (el) openForm(el.dataset.edit);
    });
    $("a-books-list").addEventListener("keydown", (e) => {
      const el = e.target.closest("[data-edit]");
      if (el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openForm(el.dataset.edit); }
    });
    $("l-add").onclick = addLocation;
    $("l-sheet-png").onclick = () => downloadSheet().catch((e) => status(e.message || "No se pudo generar la imagen", true));
    $("l-sheet-print").onclick = printSheet;
    $("l-print").onclick = () => { document.body.classList.remove("print-sheet"); window.print(); };
    $("reset-token").onclick = () => { localStorage.removeItem("bl_token"); location.reload(); };
    $("l-list").addEventListener("click", onOpen);
    $("l-list").addEventListener("keydown", onOpen);
    $("results").addEventListener("click", async (e) => {
      const mv = e.target.dataset.move;
      const un = e.target.dataset.unassign;
      const ms = e.target.dataset.moveScan;
      if (ms) {
        // Mover escaneando la etiqueta de la nueva ubicación.
        status("Escanea la etiqueta de la nueva ubicación…");
        startScan(async (code) => {
          const key = /^LOC-/i.test(code) ? "LOC-" + code.slice(4) : "";
          if (!key || !data.locations[key]) { status("Eso no es una ubicación conocida: " + code, true); return; }
          stopScan();
          try {
            const typed = e.target.closest(".bl-book")?.querySelector("[data-title-input]")?.value.trim() || "";
            data = await api("/assign", { isbn: ms, location: key, ...extraFor(ms, typed) });
            status("Movido a " + locName(key) + " ✅");
            renderSearch();
          } catch (err) { status(err.message, true); }
        });
        return;
      }
      try {
        if (mv) {
          const sel = e.target.parentElement.querySelector("select").value;
          if (!sel) { status("Elige una ubicación.", true); return; }
          const typed = e.target.closest(".bl-book")?.querySelector("[data-title-input]")?.value.trim() || "";
          data = await api("/assign", { isbn: mv, location: sel, ...extraFor(mv, typed) });
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
          if (currentLoc === del) currentLoc = "";
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
      if (!$("as-loc").hidden) fillLocSelect();
    } catch (e) {
      status(e.message, true);
      if (!localStorage.getItem("bl_token")) loadAll(true);
    }
  }

  init();
})();
