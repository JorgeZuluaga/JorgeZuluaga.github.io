const PHOTOS_JSON = "./info/photos/photos.json";

function sortPhotos(photos) {
  return [...photos].sort((a, b) => {
    const y = (b.year ?? 0) - (a.year ?? 0);
    if (y !== 0) return y;
    return (b.month ?? 0) - (a.month ?? 0);
  });
}

function photoSrcPath(file) {
  return `./info/photos/${encodeURIComponent(file)}`;
}

/** Resuelve true solo si el archivo de imagen existe y es legible por el navegador. */
function imageUrlLoads(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function filterPhotosWithExistingFiles(photos) {
  const list = sortPhotos(photos).filter((p) => p?.file);
  const checked = await Promise.all(
    list.map(async (p) => {
      const url = photoSrcPath(p.file);
      const ok = await imageUrlLoads(url);
      return ok ? p : null;
    })
  );
  return checked.filter(Boolean);
}

function formatBytes(n) {
  if (n == null || Number.isNaN(n) || n < 0) return "—";
  const b = Number(n);
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 ** 2).toFixed(2)} MB`;
}

function formatResolution(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!w || !h) return "—";
  return `${w.toLocaleString("es-CO")} × ${h.toLocaleString("es-CO")} px`;
}

function photoTechLine(p) {
  const res = formatResolution(p.width, p.height);
  const sz = formatBytes(p.sizeBytes);
  const parts = [res, sz].filter((x) => x && x !== "—");
  return parts.join(" · ");
}

function openLightbox(p, imgPath) {
  const lb = document.getElementById("photo-lightbox");
  const imgEl = lb?.querySelector(".photo-lightbox__img");
  const metaEl = document.getElementById("photo-lightbox-meta");
  const dlEl = document.getElementById("photo-lightbox-download");
  const closeBtn = lb?.querySelector(".photo-lightbox__close");
  if (!lb || !imgEl || !metaEl || !dlEl) return;

  imgEl.src = imgPath;
  imgEl.alt = p.title ? String(p.title) : "";

  metaEl.replaceChildren();
  const title = document.createElement("p");
  title.className = "photo-lightbox__line photo-lightbox__line--title";
  title.textContent = p.title ?? p.file ?? "";
  metaEl.appendChild(title);

  const tech = document.createElement("p");
  tech.className = "photo-lightbox__line photo-lightbox__line--tech";
  tech.textContent = photoTechLine(p);
  metaEl.appendChild(tech);

  if (p.dateLabel) {
    const d = document.createElement("p");
    d.className = "photo-lightbox__line photo-lightbox__line--date";
    d.textContent = p.dateLabel;
    metaEl.appendChild(d);
  }

  if (p.description) {
    const desc = document.createElement("p");
    desc.className = "photo-lightbox__line photo-lightbox__line--desc";
    desc.textContent = p.description;
    metaEl.appendChild(desc);
  }

  dlEl.href = imgPath;
  dlEl.setAttribute("download", p.file ?? "");
  dlEl.textContent = `Descargar (${formatBytes(p.sizeBytes)})`;

  lb.hidden = false;
  document.body.style.overflow = "hidden";
  closeBtn?.focus();

  const onKey = (e) => {
    if (e.key === "Escape") closeLightbox();
  };
  lb._onKeydown = onKey;
  document.addEventListener("keydown", onKey);
}

function closeLightbox() {
  const lb = document.getElementById("photo-lightbox");
  if (!lb || lb.hidden) return;
  lb.hidden = true;
  document.body.style.overflow = "";
  const imgEl = lb.querySelector(".photo-lightbox__img");
  if (imgEl) {
    imgEl.removeAttribute("src");
    imgEl.alt = "";
  }
  if (lb._onKeydown) {
    document.removeEventListener("keydown", lb._onKeydown);
    lb._onKeydown = null;
  }
}

function wireLightbox() {
  const lb = document.getElementById("photo-lightbox");
  if (!lb) return;
  lb.querySelectorAll("[data-lightbox-close]").forEach((el) => {
    el.addEventListener("click", () => closeLightbox());
  });
}

async function main() {
  wireLightbox();

  const res = await fetch(PHOTOS_JSON, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar info/photos/photos.json (${res.status})`);
  const data = await res.json();

  const titleEl = document.getElementById("photos-page-title");
  const introEl = document.getElementById("photos-page-intro");
  const gridEl = document.getElementById("photos-grid");
  if (!titleEl || !introEl || !gridEl) return;

  titleEl.textContent = data.title ?? "Fotografías";
  introEl.textContent = data.intro ?? "";

  const photos = await filterPhotosWithExistingFiles(data.photos ?? []);
  const frag = document.createDocumentFragment();

  for (const p of photos) {
    const file = p.file;
    if (!file) continue;
    const imgPath = photoSrcPath(file);

    const article = document.createElement("article");
    article.className = "photo-card";

    const thumb = document.createElement("div");
    thumb.className = "photo-card__thumb";
    const img = document.createElement("img");
    img.src = imgPath;
    img.alt = p.title ? String(p.title) : "Fotografía";
    img.loading = "lazy";
    img.decoding = "async";
    thumb.appendChild(img);

    const open = () => openLightbox(p, imgPath);
    thumb.addEventListener("click", open);
    thumb.setAttribute("role", "button");
    thumb.tabIndex = 0;
    thumb.setAttribute("aria-label", `Vista previa: ${p.title || file}`);
    thumb.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });

    const body = document.createElement("div");
    body.className = "photo-card__body";
    const h3 = document.createElement("h3");
    h3.textContent = p.title ?? file;
    const dateP = document.createElement("p");
    dateP.className = "photo-card__date";
    dateP.textContent = p.dateLabel ?? "";
    const descP = document.createElement("p");
    descP.className = "photo-card__desc";
    descP.textContent = p.description ?? "";

    const techP = document.createElement("p");
    techP.className = "photo-card__tech";
    techP.textContent = photoTechLine(p);

    const actions = document.createElement("div");
    actions.className = "photo-card__actions";

    const previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.className = "photo-card__preview";
    previewBtn.textContent = "Vista previa";
    previewBtn.addEventListener("click", open);

    const dl = document.createElement("a");
    dl.className = "link photo-card__dl";
    dl.href = imgPath;
    dl.setAttribute("download", file);
    dl.target = "_blank";
    dl.rel = "noopener noreferrer";
    dl.textContent = "Descargar";

    body.appendChild(h3);
    if (p.dateLabel) body.appendChild(dateP);
    if (p.description) body.appendChild(descP);
    body.appendChild(techP);
    actions.appendChild(previewBtn);
    actions.appendChild(dl);
    body.appendChild(actions);

    article.appendChild(thumb);
    article.appendChild(body);
    frag.appendChild(article);
  }

  gridEl.appendChild(frag);
}

main().catch((err) => {
  console.error(err);
  const gridEl = document.getElementById("photos-grid");
  if (gridEl) {
    gridEl.innerHTML =
      "<p class=\"photo-card__error\"><strong>No se pudieron cargar las fotos.</strong> Compruebe que exista <code>info/photos/photos.json</code> y la consola del navegador.</p>";
  }
});
