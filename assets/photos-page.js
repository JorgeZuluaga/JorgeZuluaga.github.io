import {
  applyThemeAriaFromLang,
  getPageLang,
  pickLocalized,
  t,
  withLangQuery,
} from "./i18n.js";
import { applyHeaderLangChrome } from "./library-nav.js";
import { trackEvent, trackPageView } from "./visitor-tracker.js";

const PHOTOS_JSON = "./info/photos/photos.json";

function sortPhotos(photos) {
  const arr = [...photos];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function photoSrcPath(file) {
  return photoAssetPath(file);
}

function photoAssetPath(relativePath) {
  const parts = String(relativePath || "")
    .split("/")
    .filter(Boolean);
  if (!parts.length) return "";
  return `./info/photos/${parts.map(encodeURIComponent).join("/")}`;
}

function photoDownloadPath(p) {
  return photoAssetPath(p?.downloadFile || p?.file);
}

function photoDownloadName(p) {
  const raw = String(p?.downloadFile || p?.file || "").trim();
  return raw.split("/").pop() || raw;
}

function photoDownloadBytes(p) {
  if (p?.downloadSizeBytes != null) return p.downloadSizeBytes;
  return p?.sizeBytes;
}

function photoIsVisible(p) {
  if (!p || typeof p !== "object") return false;
  const show = p.show;
  return show !== false && show !== 0 && show !== "0";
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
  const list = sortPhotos(photos).filter((p) => p?.file && photoIsVisible(p));
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

function formatResolution(width, height, locale = "es-CO") {
  const w = Number(width);
  const h = Number(height);
  if (!w || !h) return "—";
  return `${w.toLocaleString(locale)} × ${h.toLocaleString(locale)} px`;
}

function photoTechLine(p, locale) {
  const res = formatResolution(p.width, p.height, locale);
  const sz = formatBytes(p.sizeBytes);
  const parts = [res, sz].filter((x) => x && x !== "—");
  return parts.join(" · ");
}

function applyPhotosChrome(lang) {
  document.documentElement.lang = lang === "en" ? "en" : "es";
  document.title =
    lang === "en"
      ? "Photos (press and talks) — Jorge I. Zuluaga"
      : "Fotos (prensa y conferencias) — Jorge I. Zuluaga";

  const skip = document.querySelector(".skip-link");
  if (skip) skip.textContent = t("skip", lang);

  const back = document.querySelector(".photos-back");
  if (back) {
    back.textContent = t("photos_back_cv", lang);
    back.href = withLangQuery("./index.html");
  }

  applyHeaderLangChrome(lang, {
    esId: "photos-lang-es",
    enId: "photos-lang-en",
    hrefEs: "./photos.html",
    hrefEn: "./photos.html?lang=en",
  });

  document.querySelectorAll(".theme-button").forEach((btn) => {
    btn.setAttribute("aria-label", t("theme_toggle", lang));
  });
  applyThemeAriaFromLang(lang);

  const footer = document.querySelector("footer.print-mode-target p");
  if (footer) {
    footer.innerHTML = `${t("footer_line", lang)} <a class="link" href="${withLangQuery(
      "./index.html",
    )}">${t("footer_cv_link", lang)}</a>`;
  }

  const closeBtn = document.querySelector(".photo-lightbox__close");
  if (closeBtn) closeBtn.setAttribute("aria-label", t("photos_preview_close", lang));
  const lbTitle = document.getElementById("photo-lightbox-title");
  if (lbTitle) lbTitle.textContent = t("photos_preview_title", lang);
  const dl = document.getElementById("photo-lightbox-download");
  if (dl) dl.textContent = t("photos_download_file", lang);
}

function openLightbox(p, imgPath, lang, locale) {
  const lb = document.getElementById("photo-lightbox");
  const imgEl = lb?.querySelector(".photo-lightbox__img");
  const metaEl = document.getElementById("photo-lightbox-meta");
  const dlEl = document.getElementById("photo-lightbox-download");
  const closeBtn = lb?.querySelector(".photo-lightbox__close");
  if (!lb || !imgEl || !metaEl || !dlEl) return;

  imgEl.src = imgPath;
  const titleText = pickLocalized(p, "title", lang) ?? p.file ?? "";
  const dateText = pickLocalized(p, "dateLabel", lang) ?? "";
  const descriptionText = pickLocalized(p, "description", lang) ?? "";

  imgEl.alt = titleText ? String(titleText) : "";

  metaEl.replaceChildren();
  const title = document.createElement("p");
  title.className = "photo-lightbox__line photo-lightbox__line--title";
  title.textContent = titleText;
  metaEl.appendChild(title);

  const tech = document.createElement("p");
  tech.className = "photo-lightbox__line photo-lightbox__line--tech";
  tech.textContent = photoTechLine(p, locale);
  metaEl.appendChild(tech);

  if (dateText) {
    const d = document.createElement("p");
    d.className = "photo-lightbox__line photo-lightbox__line--date";
    d.textContent = dateText;
    metaEl.appendChild(d);
  }

  if (descriptionText) {
    const desc = document.createElement("p");
    desc.className = "photo-lightbox__line photo-lightbox__line--desc";
    desc.textContent = descriptionText;
    metaEl.appendChild(desc);
  }

  dlEl.href = photoDownloadPath(p);
  dlEl.setAttribute("download", photoDownloadName(p));
  dlEl.textContent = `${t("photos_download", lang)} (${formatBytes(photoDownloadBytes(p))})`;
  dlEl.onclick = () => {
    trackEvent("image_download", {
      source: "photos_lightbox",
      fileName: photoDownloadName(p),
      title: pickLocalized(p, "title", lang) ?? "",
    });
  };

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

function renderProfileBlocks(profiles, lang, container) {
  if (!container) return;
  container.replaceChildren();
  const list = Array.isArray(profiles) ? profiles : [];
  if (!list.length) return;

  for (const profile of list) {
    const block = document.createElement("article");
    block.className = "photos-profile__block";

    const subtitle = document.createElement("h3");
    subtitle.className = "photos-profile__subtitle";
    subtitle.textContent =
      pickLocalized(profile, "title", lang) ?? profile.id ?? "";

    const text = document.createElement("p");
    text.className = "photos-intro photos-profile__text";
    text.textContent = pickLocalized(profile, "text", lang) ?? "";

    block.appendChild(subtitle);
    block.appendChild(text);
    container.appendChild(block);
  }
}

async function main() {
  const lang = getPageLang();
  const locale = lang === "en" ? "en-US" : "es-CO";
  trackPageView("photos_page");
  applyPhotosChrome(lang);
  wireLightbox();

  const res = await fetch(PHOTOS_JSON, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar info/photos/photos.json (${res.status})`);
  const data = await res.json();

  const titleEl = document.getElementById("photos-page-title");
  const introEl = document.getElementById("photos-page-intro");
  const profileTitleEl = document.getElementById("photos-profile-title");
  const profileBlocksEl = document.getElementById("photos-profile-blocks");
  const gridEl = document.getElementById("photos-grid");
  if (!titleEl || !introEl || !gridEl) return;

  titleEl.textContent = pickLocalized(data, "title", lang) ?? t("photos_title", lang);
  introEl.textContent = pickLocalized(data, "intro", lang) ?? t("photos_intro", lang);
  if (profileTitleEl) profileTitleEl.textContent = t("photos_profile_title", lang);
  renderProfileBlocks(data.profiles, lang, profileBlocksEl);

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
    const titleText = pickLocalized(p, "title", lang) ?? file;
    const dateText = pickLocalized(p, "dateLabel", lang) ?? "";
    const descriptionText = pickLocalized(p, "description", lang) ?? "";

    img.alt = titleText ? String(titleText) : t("photos_photo_fallback", lang);
    img.loading = "lazy";
    img.decoding = "async";
    thumb.appendChild(img);

    const open = () => openLightbox(p, imgPath, lang, locale);
    thumb.addEventListener("click", open);
    thumb.setAttribute("role", "button");
    thumb.tabIndex = 0;
    thumb.setAttribute("aria-label", `${t("photos_preview_aria", lang)} ${titleText || file}`);
    thumb.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });

    const body = document.createElement("div");
    body.className = "photo-card__body";
    const h3 = document.createElement("h3");
    h3.textContent = titleText ?? file;
    const dateP = document.createElement("p");
    dateP.className = "photo-card__date";
    dateP.textContent = dateText;
    const descP = document.createElement("p");
    descP.className = "photo-card__desc";
    descP.textContent = descriptionText;

    const techP = document.createElement("p");
    techP.className = "photo-card__tech";
    techP.textContent = photoTechLine(p, locale);

    const actions = document.createElement("div");
    actions.className = "photo-card__actions";

    const previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.className = "photo-card__preview";
    previewBtn.textContent = t("photos_preview", lang);
    previewBtn.addEventListener("click", open);

    const dl = document.createElement("a");
    dl.className = "link photo-card__dl";
    dl.href = photoDownloadPath(p);
    dl.setAttribute("download", photoDownloadName(p));
    dl.target = "_blank";
    dl.rel = "noopener noreferrer";
    dl.textContent = t("photos_download", lang);
    dl.addEventListener("click", () => {
      trackEvent("image_download", {
        source: "photos_grid",
        fileName: photoDownloadName(p),
        title: titleText,
      });
    });

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
  const lang = getPageLang();
  if (gridEl) {
    gridEl.innerHTML = `<p class="photo-card__error">${t("photos_error", lang)}</p>`;
  }
});
