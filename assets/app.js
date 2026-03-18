const SOURCES = [
  { id: "orcid", label: "ORCID", path: "./assets/works-orcid-2026.txt" },
  { id: "scholar", label: "Scholar", path: "./assets/citations-scholar-2026.txt" },
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
  const t = latexToUnicode((s ?? "").toString()).replace(/\s+/g, " ").trim();
  if (!t) return "";
  // ORCID / Scholar use "and" between authors
  const parts = t.split(/\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
  const maxShown = 5;
  if (parts.length <= maxShown) return parts.join(", ");

  // Always show first 5 authors, then "et al."
  return `${parts.slice(0, maxShown).join(", ")}, et al.`;
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

function renderPub(e, extraBadge = null) {
  const title = cleanTitle(e.title) || "(Sin título)";
  const year = parseYear(e);
  const authors = formatAuthors(e.author);
  const venue = pickVenue(e);

  const doiUrl = linkForDOI(e.doi);
  const rawDoi = (e.doi ?? "").toString().trim().replace(/^doi:\s*/i, "");
  const arxivInfo = extractArxiv(e);
  const links = [
    arxivInfo ? { href: arxivInfo.url, label: `arXiv: ${arxivInfo.id}` } : null,
    doiUrl ? { href: doiUrl, label: rawDoi ? `DOI: ${rawDoi}` : "DOI" } : null,
  ].filter(Boolean);

  const li = document.createElement("li");
  li.className = "pub";
  li.dataset.year = year ?? "";
  li.dataset.source = e.source;
  li.dataset.search = normalizeText(
    `${title} ${authors} ${venue} ${year ?? ""} ${e.doi ?? ""} ${e.url ?? ""} ${arxivInfo?.id ?? ""}`,
  );

  li.innerHTML = `
    <div class="pub-head">
      <h3 class="pub-title">${escapeHtml(title)}</h3>
    </div>
    <div class="pub-meta">
      ${year ? `${year}. ` : ""}${authors
      ? `${highlightAuthor(escapeHtml(authors))} · `
      : ""
    }${escapeHtml(venue)}
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
  const res = await fetch("./assets/profile.json", { cache: "no-store" });
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

  // Courses are now loaded from teaching-classroom.json in main()

  const sup = profile.teaching?.supervision ?? [];
  for (const s of sup) {
    const li = document.createElement("li");
    const title = s.title || "";
    const prog = s.program || "";
    const inst = s.institution || "";
    const years = s.years || "";
    li.innerHTML = `<strong>${escapeHtml(title)}</strong>${prog ? ` — ${escapeHtml(prog)}` : ""
      }${inst ? `, ${escapeHtml(inst)}` : ""}${years ? `, ${escapeHtml(years)}` : ""}`;
    supEl.appendChild(li);
  }

  const awards = profile.awards ?? [];
  for (const a of awards) {
    const li = document.createElement("li");
    const title = a.title || "";
    const org = a.organization || "";
    const year = a.year || "";
    li.innerHTML = `<strong>${escapeHtml(title)}</strong>${org ? ` — ${escapeHtml(org)}` : ""
      }${year ? `, ${escapeHtml(year)}` : ""}`;
    awardsEl.appendChild(li);
  }
}

async function main() {
  const updated = new Date();
  setText("updated", updated.toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "2-digit" }));

  const profile = await loadProfile().catch(() => null);
  renderTeaching(profile);

  const coursesEl = document.getElementById("teaching-courses");
  if (coursesEl) {
    try {
      const res = await fetch("./assets/teaching-classroom.json", { cache: "no-store" });
      if (res.ok) {
        const classroomCourses = await res.json();
        const udeACourses = classroomCourses.filter(c =>
          c.section &&
          c.section.includes("UdeA") &&
          c.name !== "Curso Modelo" &&
          c.name !== "Modelo de Curso"
        );

        // Group by course name
        const groupedCourses = new Map();
        for (const c of udeACourses) {
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

          // Process all occurrences of this course
          const occurrencesHtml = courses.map(c => {
            const dateObj = new Date(c.creationTime);
            const dateStr = isNaN(dateObj) ? (c.creationTime || "") : dateObj.toLocaleDateString("es-CO");
            const students = c.enrollmentCount ?? 0;
            // Extract semester from section (e.g. "Astronomia UdeA - 2026-1" -> "2026-1")
            let semester = escapeHtml(c.section || "");
            const match = semester.match(/20\d{2}-\d/);
            if (match) {
              semester = match[0];
            }
            return `${semester} (Creado ${escapeHtml(dateStr)}, Estudiantes: ${students})`;
          }).join(", ");

          div.innerHTML = `
            <div class="info">
              <h3>${escapeHtml(name)}</h3>
              <p>Ofrecido en: ${occurrencesHtml}</p>
            </div>
          `;
          coursesEl.appendChild(div);
        }
      }
    } catch (err) {
      console.error("Error loading classroom courses:", err);
    }
  }

  const entries = await loadAll();
  fillYearsRange(entries);

  const latest = [];
  const seenLatest = new Set();
  const publishedSorted = [...entries]
    .filter((e) => isPublished(e) && hasLink(e))
    .sort((a, b) => {
      if (b.yearNum !== a.yearNum) return b.yearNum - a.yearNum;
      return normalizeText(a.titleClean).localeCompare(normalizeText(b.titleClean));
    });
  for (const e of publishedSorted) {
    const key = normalizeText(e.titleClean);
    if (seenLatest.has(key)) continue;
    seenLatest.add(key);
    latest.push(e);
    if (latest.length >= 5) break;
  }

  const preprints = [];
  const seenPreprints = new Set();
  const preprintsSorted = [...entries]
    .filter((e) => isPreprint(e) && hasLink(e))
    .sort((a, b) => {
      if (b.yearNum !== a.yearNum) return b.yearNum - a.yearNum;
      return normalizeText(a.titleClean).localeCompare(normalizeText(b.titleClean));
    });
  for (const e of preprintsSorted) {
    const key = normalizeText(e.titleClean);
    if (seenPreprints.has(key)) continue;
    seenPreprints.add(key);
    preprints.push(e);
    if (preprints.length >= 5) break;
  }

  const latestEl = document.getElementById("latest");
  if (latestEl) {
    clearChildren(latestEl);
    const fragLatest = document.createDocumentFragment();
    for (const e of latest) {
      fragLatest.appendChild(renderPub(e, { label: "Nuevo", className: "badge--new" }));
    }
    latestEl.appendChild(fragLatest);
  }

  const preprintsEl = document.getElementById("preprints");
  if (preprintsEl) {
    clearChildren(preprintsEl);
    const fragPre = document.createDocumentFragment();
    for (const e of preprints) {
      fragPre.appendChild(renderPub(e, { label: "Preprint", className: "badge--preprint" }));
    }
    preprintsEl.appendChild(fragPre);
  }

  setText("count", String(latest.length));
  document.getElementById("empty").hidden = latest.length !== 0;
}

main().catch((err) => {
  console.error(err);
  setText("count", "—");
  setText("years", "—");
  setText("updated", "—");
  const empty = document.getElementById("empty");
  empty.hidden = false;
  empty.innerHTML =
    "<p><strong>No se pudo cargar el CV.</strong> Revisa la consola del navegador.</p>";
});

