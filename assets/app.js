const SOURCES = [
  { id: "orcid", label: "ORCID", path: "./sources/works-orcid-2026.txt" },
  { id: "scholar", label: "Scholar", path: "./sources/citations-scholar-2026.txt" },
];

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
  const t = (s ?? "").toString().replace(/\s+/g, " ").trim();
  if (!t) return "";
  // ORCID uses "and" sometimes; Scholar BibTeX uses "and"
  const parts = t.split(/\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 2) return parts.join(", ");
  return `${parts.slice(0, 2).join(", ")} et al.`;
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
  return (t ?? "")
    .toString()
    .replace(/\s+/g, " ")
    .replace(/[{}]/g, "")
    .trim();
}

function pickVenue(e) {
  return (
    e.journal ||
    e.booktitle ||
    e.publisher ||
    e.school ||
    e.institution ||
    ""
  ).toString();
}

function renderPub(e, extraBadge = null) {
  const title = cleanTitle(e.title) || "(Sin título)";
  const year = parseYear(e);
  const authors = formatAuthors(e.author);
  const venue = pickVenue(e);

  const doiUrl = linkForDOI(e.doi);
  const url = e.url && /^https?:\/\//i.test(e.url) ? e.url : null;
  const links = [
    doiUrl ? { href: doiUrl, label: "DOI" } : null,
    url && url !== doiUrl ? { href: url, label: "URL" } : null,
  ].filter(Boolean);

  const li = document.createElement("li");
  li.className = "pub";
  li.dataset.year = year ?? "";
  li.dataset.source = e.source;
  li.dataset.search = normalizeText(
    `${title} ${authors} ${venue} ${year ?? ""} ${e.doi ?? ""} ${e.url ?? ""}`,
  );

  const sourceBadgeClass =
    e.source === "orcid" ? "badge--orcid" : "badge--scholar";

  const extra =
    extraBadge && extraBadge.label
      ? `<span class="badge ${escapeAttr(extraBadge.className || "")}">${escapeHtml(
          extraBadge.label,
        )}</span>`
      : "";

  li.innerHTML = `
    <div class="pub-head">
      <h3 class="pub-title">${escapeHtml(title)}</h3>
      <div class="badges" aria-label="Metadatos">
        ${year ? `<span class="badge">${year}</span>` : ""}
        ${extra}
        <span class="badge ${sourceBadgeClass}">${escapeHtml(
          e.sourceLabel,
        )}</span>
      </div>
    </div>
    <div class="pub-meta">
      ${authors ? `${escapeHtml(authors)} · ` : ""}${escapeHtml(venue)}
    </div>
    ${
      links.length
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

async function loadProfile() {
  const res = await fetch("./sources/profile.json", { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

function renderTeaching(profile) {
  if (!profile) return;
  const name = profile.name || "Jorge I. Zuluaga";
  const headline =
    profile.headline || "Producción académica, docencia y reconocimientos.";
  const summary = profile.summary || "";

  setText("name", name);
  setText("headline", headline);
  if (summary) {
    const kicker = document.getElementById("kicker");
    if (kicker) kicker.textContent = summary;
  }
  if (profile.avatar) {
    setAttr("avatar", "src", profile.avatar);
  }

  const coursesEl = document.getElementById("teaching-courses");
  const supEl = document.getElementById("teaching-supervision");
  const awardsEl = document.getElementById("awards");
  if (!coursesEl || !supEl || !awardsEl) return;

  clearChildren(coursesEl);
  clearChildren(supEl);
  clearChildren(awardsEl);

  const courses = profile.teaching?.courses ?? [];
  for (const c of courses) {
    const li = document.createElement("li");
    const title = c.title || "";
    const inst = c.institution || "";
    const level = c.level || "";
    const years = c.years || "";
    li.innerHTML = `<strong>${escapeHtml(title)}</strong>${
      inst ? ` — ${escapeHtml(inst)}` : ""
    }${level ? `, ${escapeHtml(level)}` : ""}${years ? `, ${escapeHtml(years)}` : ""}`;
    coursesEl.appendChild(li);
  }

  const sup = profile.teaching?.supervision ?? [];
  for (const s of sup) {
    const li = document.createElement("li");
    const title = s.title || "";
    const prog = s.program || "";
    const inst = s.institution || "";
    const years = s.years || "";
    li.innerHTML = `<strong>${escapeHtml(title)}</strong>${
      prog ? ` — ${escapeHtml(prog)}` : ""
    }${inst ? `, ${escapeHtml(inst)}` : ""}${years ? `, ${escapeHtml(years)}` : ""}`;
    supEl.appendChild(li);
  }

  const awards = profile.awards ?? [];
  for (const a of awards) {
    const li = document.createElement("li");
    const title = a.title || "";
    const org = a.organization || "";
    const year = a.year || "";
    li.innerHTML = `<strong>${escapeHtml(title)}</strong>${
      org ? ` — ${escapeHtml(org)}` : ""
    }${year ? `, ${escapeHtml(year)}` : ""}`;
    awardsEl.appendChild(li);
  }
}

async function main() {
  const updated = new Date();
  setText("updated", updated.toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "2-digit" }));

  const profile = await loadProfile().catch(() => null);
  renderTeaching(profile);

  const entries = await loadAll();
  fillYearsRange(entries);

  const topCited = entries
    .filter((e) => e.scholarOrder !== null && e.scholarOrder !== undefined)
    .sort((a, b) => (a.scholarOrder ?? 1e9) - (b.scholarOrder ?? 1e9))
    .slice(0, 10);

  const latest = [...entries]
    .sort((a, b) => {
      if (b.yearNum !== a.yearNum) return b.yearNum - a.yearNum;
      return normalizeText(a.titleClean).localeCompare(normalizeText(b.titleClean));
    })
    .slice(0, 10);

  const topEl = document.getElementById("top-cited");
  const latestEl = document.getElementById("latest");
  clearChildren(topEl);
  clearChildren(latestEl);

  const fragTop = document.createDocumentFragment();
  for (const e of topCited) {
    fragTop.appendChild(renderPub(e, { label: "Top", className: "badge--top" }));
  }
  topEl.appendChild(fragTop);

  const fragLatest = document.createDocumentFragment();
  for (const e of latest) {
    fragLatest.appendChild(renderPub(e, { label: "Nuevo", className: "badge--new" }));
  }
  latestEl.appendChild(fragLatest);

  setText("count", String(topCited.length + latest.length));
  document.getElementById("empty").hidden = topCited.length + latest.length !== 0;
}

main().catch((err) => {
  console.error(err);
  setText("count", "—");
  setText("years", "—");
  setText("updated", "—");
  const empty = document.getElementById("empty");
  empty.hidden = false;
  empty.innerHTML =
    "<p><strong>No se pudo cargar el CV.</strong> Revisa la consola del navegador y confirma que los archivos existen en <code>sources/</code>.</p>";
});

