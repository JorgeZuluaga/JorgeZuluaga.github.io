const LOCATION_JSON = "./info/booklocation.json";

function normalizedIsbn(value) {
  const isbn = String(value ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{13}$/.test(isbn)) return isbn;
  if (!/^\d{9}[\dX]$/.test(isbn)) return "";
  const core = "978" + isbn.slice(0, 9);
  const sum = [...core].reduce((total, digit, i) => total + Number(digit) * (i % 2 ? 3 : 1), 0);
  return core + ((10 - sum % 10) % 10);
}

function alternateValues(record) {
  return [record?.isbn2, record?.ISBN2]
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function identifiers(record) {
  return [record?.isbn, record?.ISBN, ...alternateValues(record)]
    .map(normalizedIsbn)
    .filter(Boolean);
}

export function alternateIsbns(...records) {
  const primary = new Set(records.flatMap((record) => [record?.isbn, record?.ISBN].map(normalizedIsbn)).filter(Boolean));
  const seen = new Set(primary);
  return records.flatMap(alternateValues).filter((value) => {
    const key = normalizedIsbn(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function indexDetails(rows) {
  const byId = new Map();
  const byIsbn = new Map();
  for (const row of rows) {
    const id = String(row?.bookId ?? "").trim();
    if (id && !byId.has(id)) byId.set(id, row);
    for (const isbn of identifiers(row)) {
      if (!byIsbn.has(isbn)) byIsbn.set(isbn, row);
    }
  }
  return (book) => {
    const id = String(book?.bookId ?? "").trim();
    if (id && byId.has(id)) return byId.get(id);
    for (const isbn of identifiers(book)) {
      if (byIsbn.has(isbn)) return byIsbn.get(isbn);
    }
    return null;
  };
}

export async function loadBookLocations() {
  try {
    const response = await fetch(LOCATION_JSON, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data || !data.books || !data.locations || typeof data.books !== "object" || typeof data.locations !== "object") {
      throw new Error("Formato de ubicaciones inválido");
    }
    return data;
  } catch (error) {
    console.error(`No se pudo cargar ${LOCATION_JSON}:`, error);
    return null;
  }
}

function formatLocation(data, code, fallback, showKeys) {
  const location = data.locations[code];
  const name = location?.name || fallback;
  const key = String(location?.key || "").trim();
  return showKeys && location?.name && key ? `${name} [${key}]` : name;
}

function resolveBookLocation(data, lang, records, showKeys) {
  if (!data) return { text: lang === "en" ? "(Location unavailable)" : "(Ubicación no disponible)", located: false };
  const names = new Set();
  let located = false;
  for (const isbn of new Set(records.flatMap(identifiers))) {
    const book = data.books[isbn];
    const code = book?.location;
    if (!code) continue;
    if (data.locations[code]?.name) located = true;
    const fallback = lang === "en" ? `(Unknown location: ${code})` : `(Ubicación desconocida: ${code})`;
    const primary = formatLocation(data, code, fallback, showKeys);
    const secondaryCode = book.secondaryLocation;
    if (!secondaryCode) {
      names.add(primary);
      continue;
    }
    const secondary = formatLocation(data, secondaryCode, secondaryCode, showKeys);
    const label = lang === "en" ? "Secondary location" : "Ubicación secundaria";
    names.add(`${primary} (${label}: ${secondary})`);
  }
  const text = names.size ? [...names].join(" · ") : lang === "en" ? "(Not located yet)" : "(No localizado aún)";
  return { text, located };
}

export function bookLocation(data, lang, ...records) {
  return resolveBookLocation(data, lang, records, false).text;
}

export function bookLocationWithKeys(data, lang, ...records) {
  return resolveBookLocation(data, lang, records, true);
}
