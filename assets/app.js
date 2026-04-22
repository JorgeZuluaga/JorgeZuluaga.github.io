import {
  applyThemeAriaFromLang,
  getPageLang,
  pickLocalized,
  pickLocalizedArray,
  t,
  withLangQuery,
} from "./i18n.js";
import { trackEvent, trackPageView } from "./visitor-tracker.js";

// Publications are loaded from info/papers.json (single source of truth).
const SOURCES = [];

function normalizeText(s) {
  return (s ?? "")
    .toString()
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripBraces(s) {
  return (s ?? "")
    .toString()
    .replace(/^\s*[{"]+/, "")
    .replace(/[}"]+\s*$/, "")
    .trim();
}

function parseYear(entry) {
  const y = entry.year ?? entry.date ?? "";
  const m = String(y).match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

function splitEntriesLikeBibtex(raw) {
  // Works for standard BibTeX and ORCID-like exports with commas/newlines.
  // Strategy: locate "@<type>{...}" blocks and take balanced braces.
  const text = raw.replace(/\r\n/g, "\n");
  const at = [...text.matchAll(/@\w+\s*\{/g)].map((m) => m.index);
  if (at.length === 0) return [];
  const entries = [];
  for (let i = 0; i < at.length; i++) {
    const start = at[i];
    const end = i + 1 < at.length ? at[i + 1] : text.length;
    entries.push(text.slice(start, end).trim());
  }
  return entries.filter(Boolean);
}

function parseBibLikeEntry(block) {
  // Very tolerant BibTeX-ish parser: extracts type, key, and fields.
  const header = block.match(/^@(\w+)\s*\{\s*([^,]+)\s*,?/);
  const type = header?.[1]?.toLowerCase() ?? "misc";
  const key = header?.[2]?.trim() ?? "";
  const bodyStart = header ? header[0].length : 0;
  let body = block.slice(bodyStart);
  body = body.replace(/^\s*,\s*/g, "").replace(/\}\s*,?\s*$/g, "");

  const fields = {};
  // Parse "field = {value}" OR "field={...}" OR "field = value"
  // We'll scan char-by-char to handle braces in values.
  let i = 0;
  while (i < body.length) {
    // skip whitespace and commas
    while (i < body.length && /[\s,]/.test(body[i])) i++;
    if (i >= body.length) break;

    const nameMatch = body.slice(i).match(/^([a-zA-Z][\w-]*)\s*=/);
    if (!nameMatch) break;
    const name = nameMatch[1].toLowerCase();
    i += nameMatch[0].length;

    while (i < body.length && /\s/.test(body[i])) i++;
    if (i >= body.length) break;

    let value = "";
    const c = body[i];
    if (c === "{") {
      let depth = 0;
      let j = i;
      for (; j < body.length; j++) {
        if (body[j] === "{") depth++;
        else if (body[j] === "}") {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
      }
      value = body.slice(i, j);
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < body.length; j++) {
        if (body[j] === '"' && body[j - 1] !== "\\") {
          j++;
          break;
        }
      }
      value = body.slice(i, j);
      i = j;
    } else {
      // bare until comma/newline
      let j = i;
      for (; j < body.length; j++) {
        if (body[j] === "," || body[j] === "\n") break;
      }
      value = body.slice(i, j);
      i = j;
    }

    fields[name] = stripBraces(value);
  }

  return { type, key, ...fields };
}

function formatAuthors(s) {
  const t = latexToUnicode((s ?? "").toString()).replace(/\s+/g, " ").trim();
  if (!t) return "";
  // ORCID / Scholar use "and" between authors
  const parts = t.split(/\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
  const maxShown = 5;
  if (parts.length <= maxShown) return parts.join(", ");

  // When truncating, ensure we always show "Jorge I Zuluaga" before "et al."
  // (so highlightAuthor() can also work even if he isn't in the first 5 authors).
  const isZuluaga = (author) =>
    /zuluaga\s*,?\s*jorge\s*i\b/i.test(author) ||
    /j\.?\s*i\.?\s*zuluaga\b/i.test(author) ||
    /\bjorge\s*i\s*zuluaga\b/i.test(author);

  const zIdx = parts.findIndex(isZuluaga);
  if (zIdx === -1) {
    // No matching author: show first N, then "et al."
    return `${parts.slice(0, maxShown).join(", ")}, et al.`;
  }

  // If Zuluaga is already in the first N slots, keep the original behavior.
  if (zIdx < maxShown) {
    return `${parts.slice(0, maxShown).join(", ")}, et al.`;
  }

  // Otherwise show first (N-1) + Zuluaga, then "et al."
  const shown = parts.slice(0, maxShown - 1).concat([parts[zIdx]]);
  return `${shown.join(", ")}, et al.`;
}

function latexToUnicode(s) {
  // Very small LaTeX accent decoder for common Spanish/Latin names
  return (s ?? "")
    .toString()
    // LaTeX special i: \i -> i (so that \\'\i becomes í)
    .replace(/\\i/g, "i")
    // Braced accents: {\'e}, {\"u}, {\~n}, {\`a}, {\^o}, etc.
    .replace(/\{\\'([A-Za-z])\}/g, (_, c) => c.normalize("NFD").replace(/./, c => ({
      a: "á", A: "Á", e: "é", E: "É", i: "í", I: "Í", o: "ó", O: "Ó", u: "ú", U: "Ú", n: "ń", N: "Ń"
    })[c] || c))
    // Sometimes we get nested braces like {\'{a}} from BibTeX exports
    .replace(/\{\\'\{?([A-Za-z])\}?\}/g, (_, c) => c.normalize("NFD").replace(/./, c2 => ({
      a: "á", A: "Á", e: "é", E: "É", i: "í", I: "Í", o: "ó", O: "Ó", u: "ú", U: "Ú", n: "ń", N: "Ń"
    })[c2] || c2))
    .replace(/\\'([A-Za-z])/g, (_, c) => ({
      a: "á", A: "Á", e: "é", E: "É", i: "í", I: "Í", o: "ó", O: "Ó", u: "ú", U: "Ú", n: "ń", N: "Ń"
    })[c] || c)
    .replace(/\{\\~([Nn])\}/g, (_, c) => (c === "N" ? "Ñ" : "ñ"))
    .replace(/\\~([Nn])/g, (_, c) => (c === "N" ? "Ñ" : "ñ"))
    .replace(/\{\\c\{c\}\}/gi, (m) => (m === "{\\c{c}}" ? "ç" : "Ç"))
    // Remove remaining braces that were only grouping
    .replace(/[{}]/g, "");
}

function linkForDOI(doi) {
  const d = (doi ?? "").toString().trim();
  if (!d) return null;
  if (/^https?:\/\//i.test(d)) return d;
  return `https://doi.org/${d.replace(/^doi:\s*/i, "")}`;
}

function buildKey(e) {
  const doi = normalizeText(e.doi);
  if (doi) return `doi:${doi.replace(/^https?:\/\/doi\.org\//, "")}`;
  const title = normalizeText(e.title);
  const year = parseYear(e) ?? "";
  return `${title}::${year}`;
}

function cleanTitle(t) {
  return latexToUnicode((t ?? "").toString())
    .replace(/\s+/g, " ")
    .trim();
}

function pickVenue(e) {
  return latexToUnicode(
    e.journal ||
    e.booktitle ||
    e.publisher ||
    e.school ||
    e.institution ||
    ""
  ).toString();
}

function extractArxiv(e) {
  const raw = `${e.journal ?? ""} ${e.note ?? ""} ${e.eprint ?? ""}`.toString();
  const m =
    raw.match(/arxiv(?:\s+preprint)?\s*(?:arxiv:)?\s*([0-9]{4}\.[0-9]{4,5})/i) ||
    raw.match(/arxiv(?:\s+preprint)?\s*(?:arxiv:)?\s*([a-z\-]+\/\d{7})/i);
  if (!m) return null;
  const id = m[1];
  return {
    id,
    url: `https://arxiv.org/abs/${id}`,
  };
}

function isPublished(e) {
  const venue = pickVenue(e).toLowerCase();
  if (!venue) return false;
  if (venue.startsWith("arxiv") || venue.includes("arxiv")) return false;
  return true;
}

function isPreprint(e) {
  const venue = pickVenue(e).toLowerCase();
  if (venue && (venue.startsWith("arxiv") || venue.includes("arxiv"))) return true;
  return !!extractArxiv(e);
}

function hasLink(e) {
  const doiUrl = linkForDOI(e.doi);
  const url = e.url && /^https?:\/\//i.test(e.url) ? e.url : null;
  const arxivInfo = extractArxiv(e);
  return !!(doiUrl || url || arxivInfo);
}

function renderPub(e, extraBadge = null, lang = "es") {
  const title = cleanTitle(e.title) || t("pub_no_title", lang);
  const year = parseYear(e);
  const authors = formatAuthors(e.author);
  const venue = pickVenue(e);
  const selectionRaw = e.selection ?? extraBadge?.selectionClass ?? "";
  const selectionClass = (() => {
    const s = String(selectionRaw || "").toLowerCase();
    // User-facing schema:
    // - selection: "recent" -> CSS class "latest"
    // - selection: "latest" -> CSS class "latest"
    // - selection: "top" -> CSS class "top"
    // - selection: "preprint" -> CSS class "preprint"
    if (s === "recent" || s === "latest") return "latest";
    if (s === "top") return "top";
    if (s === "preprint") return "preprint";
    return s;
  })();

  const doiUrl = linkForDOI(e.doi);
  const rawDoi = (e.doi ?? "").toString().trim().replace(/^doi:\s*/i, "");
  const arxivInfo = extractArxiv(e);
  const links = [
    arxivInfo ? { href: arxivInfo.url, label: `arXiv: ${arxivInfo.id}` } : null,
    doiUrl ? { href: doiUrl, label: rawDoi ? `DOI: ${rawDoi}` : "DOI" } : null,
  ].filter(Boolean);

  const li = document.createElement("li");
  li.className = `pub${selectionClass ? ` ${selectionClass}` : ""}`;
  li.dataset.year = year ?? "";
  li.dataset.source = e.source;
  li.dataset.search = normalizeText(
    `${title} ${authors} ${venue} ${year ?? ""} ${e.doi ?? ""} ${e.url ?? ""} ${arxivInfo?.id ?? ""}`,
  );

  const citationsPart =
    e.citations !== undefined && e.citations !== null && e.citations !== ""
      ? ` · ${t("pub_citations", lang)}: ${escapeHtml(String(e.citations))}`
      : "";

  li.innerHTML = `
    <div class="pub-head">
      <h3 class="pub-title">${escapeHtml(title)}</h3>
    </div>
    <div class="pub-meta">
      ${year ? `${year}. ` : ""}${authors
      ? `${highlightAuthor(escapeHtml(authors))} · `
      : ""
    }${escapeHtml(venue)}${citationsPart}
    </div>
    ${links.length
      ? `<div class="pub-links">
            ${links
        .map(
          (l) =>
            `<a class="link" href="${escapeAttr(l.href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(l.label)}</a>`,
        )
        .join("")}
          </div>`
      : ""
    }
  `;

  return li;
}

function highlightAuthor(s) {
  return s
    .replace(/Jorge\s*I\.?\s*Zuluaga/gi, (m) => `<strong>${m}</strong>`)
    .replace(/J\.?\s*I\.?\s*Zuluaga/gi, (m) => `<strong>${m}</strong>`)
    .replace(/Zuluaga,\s*Jorge\s*I/gi, (m) => `<strong>${m}</strong>`);
}

function escapeHtml(s) {
  return (s ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("`", "&#96;");
}

function parseSelectionTags(selection) {
  return String(selection ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => (s === "latest" ? "recent" : s));
}

async function loadAll() {
  const loaded = [];
  for (const src of SOURCES) {
    const res = await fetch(src.path, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`No se pudo cargar ${src.path} (${res.status})`);
    }
    const raw = await res.text();
    const blocks = splitEntriesLikeBibtex(raw);
    const parsed = blocks
      .map((b, idx) => ({ ...parseBibLikeEntry(b), sourceOrder: idx }))
      .map((e) => ({
        ...e,
        source: src.id,
        sourceLabel: src.label,
        scholarOrder: src.id === "scholar" ? e.sourceOrder : null,
      }));
    loaded.push(...parsed);
  }

  // Normalize + dedupe (prefer ORCID when same key; preserve scholar order)
  const map = new Map();
  for (const e of loaded) {
    if (!e.title && !e.author) continue;
    const k = buildKey(e);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, e);
      continue;
    }

    const prevScholarOrder = prev.scholarOrder ?? null;
    const nextScholarOrder = e.scholarOrder ?? null;
    const scholarOrder =
      prevScholarOrder === null
        ? nextScholarOrder
        : nextScholarOrder === null
          ? prevScholarOrder
          : Math.min(prevScholarOrder, nextScholarOrder);

    const preferred =
      prev.source === "orcid" || e.source !== "orcid" ? prev : e;
    const secondary = preferred === prev ? e : prev;
    const merged = {
      ...secondary,
      ...preferred,
      scholarOrder,
      // Keep a stable "best source label" for the preferred record
      source: preferred.source,
      sourceLabel: preferred.sourceLabel,
    };
    map.set(k, merged);
  }

  const entries = [...map.values()].map((e) => ({
    ...e,
    yearNum: parseYear(e) ?? -1,
    titleClean: cleanTitle(e.title),
  }));

  return entries;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setTextWithBr(id, value) {
  const el = document.getElementById(id);
  if (!el) return;

  const raw = value ?? "";
  // Split on <br/> and <br> tags, escape everything else for safety.
  const parts = raw.split(/<br\s*\/?>/i);
  el.innerHTML = parts.map((p) => escapeHtml(p)).join("<br/>");
}

function setAttr(id, attr, value) {
  const el = document.getElementById(id);
  if (el && value) el.setAttribute(attr, value);
}

function fillYearsRange(entries) {
  const years = entries.map((e) => e.yearNum).filter((y) => y > 0);
  if (!years.length) return;
  const minY = Math.min(...years);
  const maxY = Math.max(...years);
  setText("years", `${minY}–${maxY}`);
}

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function applyIndexChrome(lang) {
  document.documentElement.lang = lang === "en" ? "en" : "es";

  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute("content", t("meta_description", lang));

  const skipLink = document.querySelector(".skip-link");
  if (skipLink) skipLink.textContent = t("skip", lang);
  const gallery = document.querySelector(".header-gallery-link");
  if (gallery) {
    gallery.textContent = t("gallery", lang);
    gallery.setAttribute("href", withLangQuery("./photos.html"));
  }

  const avatar = document.getElementById("avatar");
  if (avatar) avatar.setAttribute("alt", t("avatar_alt", lang));

  document.querySelector(".open-menu-button")?.setAttribute("aria-label", t("menu_open", lang));
  document.querySelector(".close-menu-button")?.setAttribute("aria-label", t("menu_close", lang));

  const navTitles = document.querySelectorAll(
    ".navbar .nav-group-title:not(#nav-language-title)",
  );
  const titleKeys = [
    "nav_group_basic",
    "nav_group_pub",
    "nav_group_exp",
    "nav_group_tech",
    "nav_group_other",
  ];
  navTitles.forEach((el, i) => {
    if (titleKeys[i]) el.textContent = t(titleKeys[i], lang);
  });

  const langTitle = document.getElementById("nav-language-title");
  if (langTitle) {
    langTitle.textContent = lang === "en" ? "Language" : "Idioma";
  }

  const navLinkKeys = [
    "nav_contact",
    "nav_about",
    "nav_education",
    "nav_stays",
    "nav_awards",
    "nav_articles",
    "nav_books",
    "nav_logros",
    "nav_work",
    "nav_teaching",
    "nav_skills",
    "nav_apps",
    "nav_software",
    "nav_photos",
    "nav_library",
  ];
  document.querySelectorAll(".navbar .nav-link").forEach((a, i) => {
    if (navLinkKeys[i]) a.textContent = t(navLinkKeys[i], lang);
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("./") && !href.startsWith("./#")) {
      a.setAttribute("href", withLangQuery(href));
    }
  });

  const langEs = document.getElementById("lang-link-es");
  const langEn = document.getElementById("lang-link-en");
  if (langEs) {
    langEs.href = "./index.html";
    langEs.textContent = t("lang_es", lang);
  }
  if (langEn) {
    langEn.href = "./index.html?lang=en";
    langEn.textContent = t("lang_en", lang);
  }
  if (langEs && langEn) {
    if (lang === "en") {
      langEn.setAttribute("aria-current", "true");
      langEs.removeAttribute("aria-current");
    } else {
      langEs.setAttribute("aria-current", "true");
      langEn.removeAttribute("aria-current");
    }
  }

  const homeFlagsNav = document.getElementById("home-lang-flags");
  if (homeFlagsNav) {
    homeFlagsNav.setAttribute("aria-label", t("home_lang_nav", lang));
  }
  const homeLangEs = document.getElementById("home-lang-es");
  const homeLangEn = document.getElementById("home-lang-en");
  if (homeLangEs) {
    homeLangEs.href = "./index.html";
    homeLangEs.setAttribute("aria-label", t("home_lang_es", lang));
    homeLangEs.setAttribute("title", t("lang_es", lang));
    if (lang === "en") {
      homeLangEs.removeAttribute("aria-current");
    } else {
      homeLangEs.setAttribute("aria-current", "true");
    }
  }
  if (homeLangEn) {
    homeLangEn.href = "./index.html?lang=en";
    homeLangEn.setAttribute("aria-label", t("home_lang_en", lang));
    homeLangEn.setAttribute("title", t("lang_en", lang));
    if (lang === "en") {
      homeLangEn.setAttribute("aria-current", "true");
    } else {
      homeLangEn.removeAttribute("aria-current");
    }
  }

  const homeQr = document.querySelector(".home-qr");
  if (homeQr) {
    homeQr.setAttribute("aria-label", t("home_qr_aria", lang));
    const qrLabel = homeQr.querySelector(".home-qr-label");
    if (qrLabel) qrLabel.textContent = t("home_qr", lang);
  }

  const sectionMap = [
    ["#home", "aria_home"],
    ["#contacto", "section_contact"],
    ["#sobre-mi", "section_about"],
    ["#educacion", "section_education"],
    ["#estancias", "section_stays"],
    ["#premios", "section_awards"],
    ["#publicaciones", "section_publications"],
    ["#libros", "section_books"],
    ["#logros", "section_logros"],
    ["#experiencia-laboral", "section_work"],
    ["#docencia", "section_teaching"],
    ["#habilidades", "section_skills"],
    ["#apps", "section_apps"],
    ["#software", "section_software"],
  ];
  for (const [sel, key] of sectionMap) {
    document.querySelector(sel)?.setAttribute("aria-label", t(key, lang));
  }

  const h2 = (sel, key) => {
    const el = document.querySelector(sel);
    if (el) el.textContent = t(key, lang);
  };
  h2("#contacto h2.title-section", "section_contact");
  h2("#sobre-mi h2.title-section", "section_about");
  h2("#educacion h2.title-section", "section_education");
  h2("#estancias h2.title-section", "section_stays");
  h2("#premios h2.title-section", "section_awards");
  h2("#publicaciones h2.title-section", "section_publications");
  h2("#libros h2.title-section", "section_books");
  h2("#logros h2.title-section", "section_logros");
  h2("#experiencia-laboral h2.title-section", "section_work");
  h2("#docencia h2.title-section", "section_teaching");
  h2("#habilidades h2.title-section", "section_skills");
  h2("#apps h2.title-section", "section_apps");
  h2("#software h2.title-section", "section_software");

  const pubLinks = document.querySelector(".publication-links");
  if (pubLinks) pubLinks.setAttribute("aria-label", t("aria_publication_links", lang));

  const pubNav = document.querySelector(".publication-links");
  if (pubNav) {
    const g = pubNav.querySelector('a[href*="scholar"]');
    if (g) {
      const gSvg = g.querySelector("svg");
      if (gSvg) {
        g.replaceChildren(gSvg, document.createTextNode(` ${t("pub_google_scholar", lang)}`));
      }
    }
    const orcid = pubNav.querySelector('a[href*="orcid"]');
    if (orcid) {
      const oSvg = orcid.querySelector("svg");
      const code = orcid.querySelector("code");
      const codeText = code?.textContent?.trim() ?? "";
      orcid.textContent = "";
      if (oSvg) orcid.appendChild(oSvg);
      orcid.appendChild(document.createTextNode(` ${t("pub_orcid", lang)} `));
      if (codeText) {
        const c = document.createElement("code");
        c.textContent = codeText;
        orcid.appendChild(c);
      }
    }
  }

  const thead = document.querySelector("#publicaciones thead tr");
  if (thead) {
    const ths = thead.querySelectorAll("th");
    if (ths[0]) ths[0].textContent = t("pub_table_source", lang);
    if (ths[1]) ths[1].textContent = t("pub_table_total", lang);
    if (ths[2]) ths[2].textContent = t("pub_table_since", lang);
  }

  const tbody = document.querySelector("#publicaciones tbody");
  if (tbody) {
    const rows = tbody.querySelectorAll("tr");
    const rowKeys = [
      ["pub_stats_citations", "1177", "563"],
      ["pub_stats_hindex", "20", "12"],
      ["pub_stats_i10", "32", "19"],
      ["pub_stats_articles", "90", "—"],
    ];
    rows.forEach((tr, i) => {
      const cfg = rowKeys[i];
      if (!cfg) return;
      const tds = tr.querySelectorAll("td");
      if (tds[0]) tds[0].textContent = t(cfg[0], lang);
      if (tds[1]) tds[1].textContent = cfg[1];
      if (tds[2]) tds[2].textContent = cfg[2];
    });
  }

  const pubH3 = [
    ["#publicaciones h3:nth-of-type(1)", "pub_h3_latest"],
    ["#publicaciones h3:nth-of-type(2)", "pub_h3_top"],
    ["#publicaciones h3:nth-of-type(3)", "pub_h3_best"],
    ["#publicaciones h3:nth-of-type(4)", "pub_h3_multi"],
    ["#publicaciones h3:nth-of-type(5)", "pub_h3_preprints"],
  ];
  for (const [sel, key] of pubH3) {
    const el = document.querySelector(sel);
    if (el) el.textContent = t(key, lang);
  }

  const emptyEl = document.getElementById("empty");
  if (emptyEl) {
    const p = emptyEl.querySelector("p");
    if (p) {
      p.innerHTML = `<strong>${escapeHtml(t("empty_pub_strong", lang))}</strong> ${escapeHtml(t("empty_pub_rest", lang))}`;
    }
  }

  const setMuted = (sel, key) => {
    const el = document.querySelector(sel);
    if (el) el.textContent = t(key, lang);
  };
  setMuted("#libros .muted", "books_intro");
  setMuted("#logros .muted", "logros_intro");
  setMuted("#experiencia-laboral .muted", "work_intro");
  setMuted("#docencia .muted", "teaching_intro");

  const hab = document.querySelector("#habilidades .container");
  if (hab) {
    const p1 = hab.querySelector("p.muted:not(.admin-text)");
    if (p1) p1.textContent = t("skills_intro", lang);
    const p2 = hab.querySelector("p.admin-text");
    if (p2) p2.textContent = t("skills_admin", lang);
  }

  const appsLead = document.querySelector("#apps .container > p");
  if (appsLead) appsLead.textContent = t("apps_lead", lang);
  const softLead = document.querySelector("#software .container > p");
  if (softLead) softLead.textContent = t("software_lead", lang);

  const footerP = document.querySelector("footer.print-mode-target > p");
  if (footerP) {
    const strong = footerP.querySelector("strong#updated");
    const prevUpdated = strong?.textContent ?? "—";
    footerP.textContent = "";
    footerP.appendChild(document.createTextNode(`${t("footer_dev", lang)} `));
    const s = strong ?? document.createElement("strong");
    s.id = "updated";
    s.textContent = prevUpdated;
    footerP.appendChild(s);
  }

  const printBtn = document.getElementById("btn-print");
  if (printBtn) printBtn.textContent = t("footer_pdf", lang);

  document.querySelector(".scroll-to-top-link")?.setAttribute("aria-label", t("scroll_top", lang));
}

async function loadProfile() {
  const res = await fetch("./info/profile.json", { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

async function loadJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`No se pudo cargar ${path} (${res.status})`);
  }
  return res.json();
}

function renderTeaching(profile, lang = "es") {
  if (!profile) return;
  const name = profile.name || "Jorge I. Zuluaga";
  const headline =
    pickLocalized(profile, "headline", lang) ||
    profile.headline ||
    "Producción académica, docencia y reconocimientos.";
  const summary =
    pickLocalized(profile, "summary", lang) ?? profile.summary ?? "";

  setText("name", name);
  setTextWithBr("headline", headline);
  if (summary) {
    const sumEl = document.getElementById("summary") || document.getElementById("kicker");
    if (sumEl) sumEl.textContent = summary;
  }
  if (profile.avatar) {
    setAttr("avatar", "src", profile.avatar);
  }
  if (profile.avatarDownload) {
    const avatarDl = document.getElementById("avatar-download");
    if (avatarDl) {
      avatarDl.href = profile.avatarDownload;
      const base = String(profile.avatarDownload).split("/").pop();
      if (base) avatarDl.setAttribute("download", base);
    }
  }

  const coursesEl = document.getElementById("teaching-courses");
  const supEl = document.getElementById("teaching-supervision");
  const awardsEl = document.getElementById("awards");
  if (!coursesEl || !supEl || !awardsEl) return;

  clearChildren(coursesEl);
  clearChildren(supEl);
  clearChildren(awardsEl);

  // Courses are now loaded from teaching-classroom.json in main()

  const sup = profile.teaching?.supervision ?? [];
  for (const s of sup) {
    const li = document.createElement("li");
    const title = pickLocalized(s, "title", lang) || s.title || "";
    const prog = pickLocalized(s, "program", lang) || s.program || "";
    const inst = pickLocalized(s, "institution", lang) || s.institution || "";
    const years = pickLocalized(s, "years", lang) || s.years || "";
    li.innerHTML = `<strong>${escapeHtml(title)}</strong>${prog ? ` — ${escapeHtml(prog)}` : ""
      }${inst ? `, ${escapeHtml(inst)}` : ""}${years ? `, ${escapeHtml(years)}` : ""}`;
    supEl.appendChild(li);
  }

  const awards = profile.awards ?? [];
  for (const a of awards) {
    const li = document.createElement("li");
    const title = pickLocalized(a, "title", lang) || a.title || "";
    const org = pickLocalized(a, "organization", lang) || a.organization || "";
    const year = pickLocalized(a, "year", lang) || a.year || "";
    li.innerHTML = `<strong>${escapeHtml(title)}</strong>${org ? ` — ${escapeHtml(org)}` : ""
      }${year ? `, ${escapeHtml(year)}` : ""}`;
    awardsEl.appendChild(li);
  }
}

function renderExperience(profile, lang = "es") {
  if (!profile) return;

  const expEl = document.getElementById("experience-laboral-items");
  if (!expEl) return;

  clearChildren(expEl);

  const items = profile.experienceLaboral ?? [];
  let borderIdx = 1;

  for (const item of items) {
    const div = document.createElement("div");
    div.className = `box border${borderIdx}`;
    borderIdx = borderIdx < 6 ? borderIdx + 1 : 1;

    const role =
      pickLocalized(item, "role", lang) || item.role || item.cargo || "";
    const institution =
      pickLocalized(item, "institution", lang) ||
      item.institution ||
      item.organization ||
      "";
    const period = pickLocalized(item, "period", lang) || item.period || "";
    const details =
      pickLocalized(item, "details", lang) || item.details || item.summary || "";

    const metaPieces = [];
    if (period) metaPieces.push(escapeHtml(period));
    if (details) metaPieces.push(escapeHtml(details));
    const metaHtml = metaPieces.length ? `<p>${metaPieces.join(" &middot; ")}</p>` : "";

    div.innerHTML = `
      <div class="info">
        <h3>${escapeHtml(role || t("exp_role_fallback", lang))}</h3>
        <h4>${escapeHtml(institution || t("exp_inst_fallback", lang))}</h4>
        ${metaHtml}
      </div>
    `;

    expEl.appendChild(div);
  }
}

async function renderLogrosProfesionales(lang = "es") {
  const el = document.getElementById("logros-profesionales-items");
  if (!el) return;

  clearChildren(el);
  try {
    const items = await loadJson("./info/logros-profesionales.json");

    let borderIdx = 1;
    for (const item of items) {
      const div = document.createElement("div");
      div.className = `box border${borderIdx}`;
      borderIdx = borderIdx < 6 ? borderIdx + 1 : 1;

      const title = pickLocalized(item, "title", lang) ?? item.title ?? "";
      const subtitle = pickLocalized(item, "subtitle", lang) ?? item.subtitle ?? "";
      const desc =
        pickLocalized(item, "descriptionHtml", lang) ?? item.descriptionHtml ?? "";

      div.innerHTML = `
        <div class="info">
          <h3>${escapeHtml(title)}</h3>
          <h4>${escapeHtml(subtitle)}</h4>
          <p>${desc}</p>
        </div>
      `;

      el.appendChild(div);
    }
  } catch (err) {
    console.error("Error cargando logros:", err);
  }
}

async function renderLibros(lang = "es") {
  const el = document.getElementById("libros-items");
  if (!el) return;

  clearChildren(el);
  try {
    const items = await loadJson("./info/libros.json");

    let borderIdx = 1;
    for (const item of items) {
      const div = document.createElement("div");
      div.className = `box border${borderIdx}`;
      borderIdx = borderIdx < 6 ? borderIdx + 1 : 1;

      const paras = pickLocalizedArray(item, "descriptionParagraphs", lang);
      const descHtml = paras.map((p) => `<p>${escapeHtml(p)}</p>`).join("");

      const meta = item.meta ?? {};
      const link = item.link ?? {};
      const title = pickLocalized(item, "title", lang) ?? item.title ?? "";

      div.innerHTML = `
        <div class="info">
          <h3>${escapeHtml(title)}</h3>
          ${descHtml}
          <p><strong>${escapeHtml(t("libros_pub", lang))}</strong> ${escapeHtml(pickLocalized(meta, "publicationDate", lang) ?? meta.publicationDate ?? "—")}</p>
          <p><strong>${escapeHtml(t("libros_issn", lang))}</strong> ${escapeHtml(pickLocalized(meta, "issn", lang) ?? meta.issn ?? "—")}</p>
          <p><strong>${escapeHtml(t("libros_editorial", lang))}</strong> ${escapeHtml(pickLocalized(meta, "editorial", lang) ?? meta.editorial ?? "—")}</p>
          <p><strong>${escapeHtml(t("libros_status", lang))}</strong> ${escapeHtml(pickLocalized(meta, "status", lang) ?? meta.status ?? "—")}</p>
          ${
        link.href
          ? `<p><strong>${escapeHtml(t("libros_link", lang))}</strong> <a class="link" href="${escapeAttr(
              link.href,
            )}" target="_blank" rel="noreferrer noopener">${escapeHtml(
              pickLocalized(link, "label", lang) ?? link.label ?? "Enlace",
            )}</a></p>`
          : ""
      }
        </div>
      `;

      el.appendChild(div);
    }
  } catch (err) {
    console.error("Error cargando libros:", err);
  }
}

async function renderSoftwarePackages(lang = "es") {
  const el = document.getElementById("software-items");
  if (!el) return;

  clearChildren(el);
  try {
    const items = await loadJson("./info/software.json");

    el.dataset.rendered = "true";

    let borderIdx = 1;
    for (const item of items) {
      const div = document.createElement("div");
      div.className = `box border${borderIdx}`;
      div.dataset.source = "json";
      borderIdx = borderIdx < 6 ? borderIdx + 1 : 1;

      const authors = Array.isArray(item.authors) ? item.authors : [];
      const boldJorge = (a) =>
        /Jorge\s*(?:I\.\s*)?Zuluaga/i.test(a)
          ? `<strong>${escapeHtml(a)}</strong>`
          : escapeHtml(a);
      const authorsHtml = authors.map(boldJorge).join(", ");

      const links = Array.isArray(item.links) ? item.links : [];
      const linksHtml = links
        .map(
          (l) =>
            `<a class="link" href="${escapeAttr(l.href ?? "")}" target="_blank" rel="noreferrer noopener">${escapeHtml(
              l.label ?? "Link",
            )}</a>`,
        )
        .join(" · ");

      const description = pickLocalized(item, "description", lang) ?? item.description ?? "";

      div.innerHTML = `
        <div class="info">
          <h3>${escapeHtml(item.name ?? "")}</h3>
          <p>${escapeHtml(description)}</p>
          <p>
            <strong>${escapeHtml(t("software_authors", lang))}</strong> ${authorsHtml} &middot; <strong>${escapeHtml(t("software_created", lang))}</strong> ${escapeHtml(item.created ?? "—")}
          </p>
          <p><br /></p>
          <p>${linksHtml}</p>
        </div>
      `;

      el.appendChild(div);
    }
  } catch (err) {
    console.error("Error cargando paquetes:", err);
  }
}

async function renderApps(lang = "es") {
  const el = document.getElementById("apps-items");
  if (!el) return;

  clearChildren(el);
  try {
    const items = await loadJson("./info/apps.json");

    let borderIdx = 1;
    for (const item of items) {
      const div = document.createElement("div");
      div.className = `box border${borderIdx}`;
      borderIdx = borderIdx < 6 ? borderIdx + 1 : 1;

      const description = pickLocalized(item, "description", lang) ?? item.description ?? "";

      div.innerHTML = `
        <div class="info">
          <h3>${escapeHtml(item.title ?? item.name ?? "")}</h3>
          <p>${escapeHtml(description)}</p>
          <p><strong>${escapeHtml(t("apps_url", lang))}</strong> <a class="link" href="${escapeAttr(item.url ?? "")}" target="_blank" rel="noreferrer noopener">${escapeHtml(item.url ?? "")}</a></p>
        </div>
      `;

      el.appendChild(div);
    }
  } catch (err) {
    console.error("Error cargando apps:", err);
  }
}

function renderSimpleMarkdown(text) {
  const src = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!src) return "";

  // Minimal Markdown support for easy authoring in aboutme.md.
  // Supported:
  // - blank line => paragraph break
  // - **bold**
  // - *italic*
  const blocks = src
    .split(/\n\s*\n/g)
    .map((b) => b.trim())
    .filter(Boolean);

  function renderInlineMarkdown(blockText) {
    const links = [];
    let raw = blockText;

    // Markdown links: [texto](https://url)
    raw = raw.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, href) => {
      const token = `@@LINK_${links.length}@@`;
      links.push({ token, label, href });
      return token;
    });

    let html = escapeHtml(raw);
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

    for (const link of links) {
      const anchor = `<a class="link" href="${escapeAttr(link.href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(link.label)}</a>`;
      html = html.replace(link.token, anchor);
    }

    return html;
  }

  return blocks
    .map((block) => {
      const oneLine = block.replace(/\n/g, " ");
      const inlineHtml = renderInlineMarkdown(oneLine);
      return `<p>${inlineHtml}</p>`;
    })
    .join("");
}

async function renderAboutMe(profile, lang = "es") {
  const el = document.getElementById("about-me");
  if (!el) return;

  if (lang === "en") {
    const enMd = pickLocalized(profile ?? {}, "aboutMe", lang);
    if (typeof enMd === "string" && enMd.trim()) {
      el.innerHTML = renderSimpleMarkdown(enMd);
      return;
    }
    el.textContent = profile?.aboutMe ?? "";
    return;
  }

  try {
    const res = await fetch("./info/aboutme.md", { cache: "no-store" });
    if (res.ok) {
      const md = await res.text();
      const html = renderSimpleMarkdown(md);
      if (html) {
        el.innerHTML = html;
        return;
      }
    }
  } catch (err) {
    console.warn("No se pudo cargar aboutme.md, usando fallback de profile.json", err);
  }

  if (profile?.aboutMe) {
    el.textContent = profile.aboutMe;
  } else {
    el.textContent = "";
  }
}

async function renderContact(lang = "es") {
  const elAnchors = [
    ...document.querySelectorAll("[data-contact]")
  ];
  if (!elAnchors.length) return;

  try {
    const items = await loadJson("./info/contact.json");
    for (const item of items) {
      const a = document.querySelector(`[data-contact="${item.key}"]`);
      if (!a) continue;

      let href = item.href ?? "#";
      if (item.href && lang === "en") {
        href = withLangQuery(item.href);
      }
      if (href) a.setAttribute("href", href);

      const aria = pickLocalized(item, "ariaLabel", lang) ?? item.ariaLabel;
      if (aria) a.setAttribute("aria-label", aria);

      if (item.target) {
        a.setAttribute("target", item.target);
      } else {
        a.removeAttribute("target");
      }

      const textEl = a.querySelector(".contact-text");
      if (textEl) textEl.textContent = pickLocalized(item, "label", lang) ?? item.label ?? "";
    }
  } catch (err) {
    console.error("Error cargando contacto:", err);
  }
}

async function renderEducation(lang = "es") {
  const el = document.getElementById("education-items");
  if (!el) return;

  clearChildren(el);
  try {
    const items = await loadJson("./info/education.json");

    let borderIdx = 1;
    for (const item of items) {
      const div = document.createElement("div");
      div.className = `box border${borderIdx}`;
      borderIdx = borderIdx < 6 ? borderIdx + 1 : 1;

      const extra = pickLocalizedArray(item, "extraParagraphs", lang);
      const extraHtml = extra.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
      const recognitionRaw = pickLocalized(item, "recognition", lang) ?? item.recognition;
      const recTrimmed =
        recognitionRaw === undefined || recognitionRaw === null
          ? ""
          : String(recognitionRaw).trim();
      const recognitionHtml = recTrimmed
        ? `<p class="education-recognition"><strong>${escapeHtml(t("education_recognition", lang))}</strong> ${escapeHtml(recTrimmed)}</p>`
        : "";
      const linkUrl = item.linkUrl ?? item.programUrl;
      const linkLabel =
        pickLocalized(item, "linkLabel", lang) ??
        pickLocalized(item, "linkText", lang) ??
        item.linkLabel ??
        item.linkText;
      const linkHtml =
        linkUrl && linkLabel
          ? `<p><a href="${escapeAttr(linkUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkLabel)}</a></p>`
          : "";

      const institution = pickLocalized(item, "institution", lang) ?? item.institution ?? "";
      const degree = pickLocalized(item, "degree", lang) ?? item.degree ?? "";
      const years = pickLocalized(item, "years", lang) ?? item.years ?? "";

      div.innerHTML = `
        <div class="info">
          <h3>${escapeHtml(institution)}</h3>
          <h4>${escapeHtml(degree)}</h4>
          <p>${escapeHtml(years)}</p>
          ${recognitionHtml}
          ${extraHtml}
          ${linkHtml}
        </div>
      `;
      el.appendChild(div);
    }
  } catch (err) {
    console.error("Error cargando educación:", err);
  }
}

async function renderResearchStays(lang = "es") {
  const el = document.getElementById("research-items");
  if (!el) return;

  clearChildren(el);
  try {
    const items = await loadJson("./info/research.json");

    let borderIdx = 1;
    for (const item of items) {
      const div = document.createElement("div");
      div.className = `box border${borderIdx}`;
      borderIdx = borderIdx < 6 ? borderIdx + 1 : 1;

      const title = pickLocalized(item, "title", lang) ?? item.title ?? "";
      const subtitle = pickLocalized(item, "subtitle", lang) ?? item.subtitle ?? "";
      const details = pickLocalized(item, "details", lang) ?? item.details ?? "";

      div.innerHTML = `
        <div class="info">
          <h3>${escapeHtml(title)}</h3>
          <h4>${escapeHtml(subtitle)}</h4>
          <p>${escapeHtml(details)}</p>
        </div>
      `;
      el.appendChild(div);
    }
  } catch (err) {
    console.error("Error cargando estancias:", err);
  }
}

async function renderAwardsPage(lang = "es") {
  const el = document.getElementById("awards-items");
  if (!el) return;

  clearChildren(el);
  try {
    const items = await loadJson("./info/awards.json");

    let borderIdx = 1;
    for (const item of items) {
      const div = document.createElement("div");
      div.className = `box border${borderIdx}`;
      borderIdx = borderIdx < 6 ? borderIdx + 1 : 1;

      const title = pickLocalized(item, "title", lang) ?? item.title ?? "";
      const organization =
        pickLocalized(item, "organization", lang) ?? item.organization ?? "";
      const details = pickLocalized(item, "details", lang) ?? item.details ?? "";

      div.innerHTML = `
        <div class="info">
          <h3>${escapeHtml(title)}</h3>
          <h4>${escapeHtml(organization)}</h4>
          <p>${escapeHtml(details)}</p>
        </div>
      `;
      el.appendChild(div);
    }
  } catch (err) {
    console.error("Error cargando premios:", err);
  }
}

async function main() {
  const lang = getPageLang();
  trackPageView("cv_home");
  applyIndexChrome(lang);
  applyThemeAriaFromLang(lang);

  const updated = new Date();
  const dateLocale = lang === "en" ? "en-US" : "es-CO";
  setText(
    "updated",
    updated.toLocaleDateString(dateLocale, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }),
  );

  const profile = await loadProfile().catch(() => null);
  renderTeaching(profile, lang);
  renderExperience(profile, lang);

  await Promise.allSettled([
    renderAboutMe(profile, lang),
    renderContact(lang),
    renderEducation(lang),
    renderResearchStays(lang),
    renderAwardsPage(lang),
    renderLogrosProfesionales(lang),
    renderLibros(lang),
    renderApps(lang),
    renderSoftwarePackages(lang),
  ]);

  const coursesEl = document.getElementById("teaching-courses");
  if (coursesEl) {
    try {
      const res = await fetch("./info/teaching-classroom.json", { cache: "no-store" });
      if (res.ok) {
        const classroomCourses = await res.json();
        const udeCourses = classroomCourses.filter(c =>
          c.section &&
          (c.section.includes("UdeA") || c.section.includes("UdeM")) &&
          c.name !== "Curso Modelo" &&
          c.name !== "Modelo de Curso"
        );

        // Optional course details (from Microcurriculos summary)
        const courseDetailsByName = await loadJson(
          "./info/teaching-course-details.json",
        ).catch(() => ({}));

        // Group by course name
        const groupedCourses = new Map();
        for (const c of udeCourses) {
          if (!groupedCourses.has(c.name)) {
            groupedCourses.set(c.name, []);
          }
          groupedCourses.get(c.name).push(c);
        }

        let borderIdx = 1;
        for (const [name, courses] of groupedCourses.entries()) {
          const div = document.createElement("div");
          div.className = `box border${borderIdx}`;
          borderIdx = borderIdx < 6 ? borderIdx + 1 : 1;

          const details = courseDetailsByName[name];
          const descText =
            details &&
            (pickLocalized(details, "description", lang) ?? details.description);
          const descriptionHtml = descText
            ? `<p><strong>${escapeHtml(t("teaching_desc", lang))}</strong> ${escapeHtml(descText)}</p>`
            : "";
          const topicsHtml = details?.topics
            ? (() => {
              const rawTopics =
                pickLocalized(details, "topics", lang) ?? details.topics ?? "";
              const topicsRaw = String(rawTopics).replace(/\s*[⋅·]\s*/g, "• ");
              return `<p><strong>${escapeHtml(t("teaching_topics", lang))}</strong> ${escapeHtml(topicsRaw)}</p>`;
            })()
            : "";
          const hasDetails = Boolean(descriptionHtml || topicsHtml);
          const detailsSepHtml = hasDetails ? `<p>&nbsp;</p>` : "";

          // Process all occurrences of this course
          const occurrencesHtml = courses.map((c) => {
            const dateObj = new Date(c.creationTime);
            const dateStr = isNaN(dateObj)
              ? (c.creationTime || "")
              : dateObj.toLocaleDateString(dateLocale);
            const students = c.enrollmentCount ?? 0;
            // Extract semester from section (e.g. "Astronomia UdeA - 2026-1" -> "2026-1")
            let semester = escapeHtml(c.section || "");
            const match = semester.match(/20\d{2}-\d/);
            if (match) {
              semester = match[0];
            }
            return `${semester} (${t("teaching_created", lang)} ${escapeHtml(dateStr)}, ${t("teaching_students", lang)}: ${students})`;
          }).join(", ");

          div.innerHTML = `
            <div class="info">
              <h3>${escapeHtml(name)}</h3>
              ${descriptionHtml}
              ${topicsHtml}
              ${detailsSepHtml}
              <p><strong>${escapeHtml(t("teaching_offered", lang))}</strong> ${occurrencesHtml}</p>
            </div>
          `;
          coursesEl.appendChild(div);
        }
      }
    } catch (err) {
      console.error("Error loading classroom courses:", err);
    }
  }

  // Publications (single source of truth).
  const papers = await loadJson("./info/papers.json").catch(() => []);
  const sortByYearDesc = (a, b) => {
    const yearA = Number(a.year ?? 0) || 0;
    const yearB = Number(b.year ?? 0) || 0;
    return yearB - yearA || a.title.localeCompare(b.title);
  };

  // A paper may contain multiple categories in `selection`, comma-separated.
  // We assign each paper to a single visible bucket following this priority.
  const papersSorted = [...papers].sort(sortByYearDesc);
  const bucketOrder = ["recent", "preprint", "top", "best", "multi"];
  const buckets = {
    recent: [],
    preprint: [],
    top: [],
    best: [],
    multi: [],
  };
  const assigned = new Set();

  for (const bucket of bucketOrder) {
    for (const p of papersSorted) {
      if (buckets[bucket].length >= 5) break;
      const key = buildKey(p);
      if (assigned.has(key)) continue;

      const tags = parseSelectionTags(p.selection);
      if (!tags.length || tags.includes("hide")) continue;
      if (!tags.includes(bucket)) continue;

      buckets[bucket].push(p);
      assigned.add(key);
    }
  }

  const latestFinal = buckets.recent;
  const preprintsFinal = buckets.preprint;
  const papersTop = buckets.top;
  const papersBest = buckets.best;
  const papersMulti = buckets.multi;

  const latestEl = document.getElementById("latest");
  if (latestEl) {
    clearChildren(latestEl);
    const fragLatest = document.createDocumentFragment();
    for (const e of latestFinal) {
      fragLatest.appendChild(
        renderPub(
          e,
          { label: "Nuevo", className: "badge--new", selectionClass: "latest" },
          lang,
        ),
      );
    }
    latestEl.appendChild(fragLatest);
  }

  const preprintsEl = document.getElementById("preprints");
  if (preprintsEl) {
    clearChildren(preprintsEl);
    const fragPre = document.createDocumentFragment();
    for (const e of preprintsFinal) {
      fragPre.appendChild(
        renderPub(
          e,
          { label: "Preprint", className: "badge--preprint", selectionClass: "preprint" },
          lang,
        ),
      );
    }
    preprintsEl.appendChild(fragPre);
  }

  const topEl = document.getElementById("top-cited");
  if (topEl) {
    clearChildren(topEl);
    const fragTop = document.createDocumentFragment();
    for (const e of papersTop) {
      fragTop.appendChild(renderPub(e, { selectionClass: "top" }, lang));
    }
    topEl.appendChild(fragTop);
  }

  const bestEl = document.getElementById("best-articles");
  if (bestEl) {
    clearChildren(bestEl);
    const fragBest = document.createDocumentFragment();
    for (const e of papersBest) {
      fragBest.appendChild(renderPub(e, { selectionClass: "best" }, lang));
    }
    bestEl.appendChild(fragBest);
  }

  const multiEl = document.getElementById("multi-articles");
  if (multiEl) {
    clearChildren(multiEl);
    const fragMulti = document.createDocumentFragment();
    for (const e of papersMulti) {
      fragMulti.appendChild(renderPub(e, { selectionClass: "multi" }, lang));
    }
    multiEl.appendChild(fragMulti);
  }

  setText("count", String(latestFinal.length));
  document.getElementById("empty").hidden = latestFinal.length !== 0;

  const printBtn = document.getElementById("btn-print");
  if (printBtn) {
    printBtn.addEventListener("click", () => {
      trackEvent("pdf_print_click", { source: "index_footer" });
    });
  }

  const avatarDownload = document.getElementById("avatar-download");
  if (avatarDownload) {
    avatarDownload.addEventListener("click", () => {
      const fileName = avatarDownload.getAttribute("download") || "profile-photo";
      trackEvent("image_download", {
        source: "profile_avatar",
        fileName,
      });
    });
  }
}

main().catch((err) => {
  console.error(err);
  const lang = getPageLang();
  applyIndexChrome(lang);
  applyThemeAriaFromLang(lang);
  setText("count", "—");
  setText("years", "—");
  setText("updated", "—");
  const empty = document.getElementById("empty");
  if (empty) {
    empty.hidden = false;
    empty.innerHTML = `<p><strong>${escapeHtml(t("error_cv", lang))}</strong></p>`;
  }
});

