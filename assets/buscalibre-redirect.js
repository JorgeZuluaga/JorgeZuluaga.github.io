const BUSCALIBRE_JSON = "./info/buscalibre.json";

function bookIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get("bookId") || params.get("b") || "").trim();
}

async function main() {
  const status = document.getElementById("buscalibre-redirect-status");
  const bookId = bookIdFromQuery();
  if (!bookId) {
    if (status) status.textContent = "Falta bookId en la URL.";
    return;
  }
  try {
    const response = await fetch(BUSCALIBRE_JSON, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const books = data?.books && typeof data.books === "object" ? data.books : {};
    const entry = books[bookId];
    const url = String(entry?.url || "").trim();
    if (!url) {
      if (status) status.textContent = "Enlace Buscalibre no encontrado para este libro.";
      return;
    }
    window.location.replace(url);
  } catch {
    if (status) status.textContent = "No se pudo cargar el enlace de Buscalibre.";
  }
}

main();
