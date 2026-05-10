import { t, withLangQuery } from "./i18n.js";

/** Banderas CO / GB junto al tema: enlaces de idioma por página (misma URL base que la página actual). */
export function applyHeaderLangChrome(
  lang,
  { esId, enId, hrefEs, hrefEn },
) {
  const nav = document.getElementById("header-lang-flags");
  if (nav) {
    nav.setAttribute("aria-label", t("home_lang_nav", lang));
  }
  const es = document.getElementById(esId);
  const en = document.getElementById(enId);
  if (es) {
    es.href = hrefEs;
    es.setAttribute("title", t("lang_es", lang));
    es.setAttribute("aria-label", t("home_lang_es", lang));
    if (lang === "en") {
      es.removeAttribute("aria-current");
    } else {
      es.setAttribute("aria-current", "true");
    }
  }
  if (en) {
    en.href = hrefEn;
    en.setAttribute("title", t("lang_en", lang));
    en.setAttribute("aria-label", t("home_lang_en", lang));
    if (lang === "en") {
      en.setAttribute("aria-current", "true");
    } else {
      en.removeAttribute("aria-current");
    }
  }
}

/**
 * @param {"read" | "anti" | "series" | "todos" | null} current - página activa en la subnavegación (opcional).
 */
export function applyLibrarySectionNav(lang, current = null) {
  const nav = document.getElementById("library-section-nav");
  if (!nav) return;
  nav.setAttribute("aria-label", t("library_nav_aria", lang));

  const read = document.getElementById("nav-lib-read");
  const anti = document.getElementById("nav-lib-anti");
  const series = document.getElementById("nav-lib-series");
  const todos = document.getElementById("nav-lib-todos");

  if (read) {
    read.textContent = t("library_nav_read", lang);
    read.href = withLangQuery("./biblioteca-leidos.html");
    read.removeAttribute("aria-current");
    if (current === "read") read.setAttribute("aria-current", "page");
  }
  if (anti) {
    anti.textContent = t("library_nav_antilibrary", lang);
    anti.href = withLangQuery("./biblioteca-noleidos.html");
    anti.removeAttribute("aria-current");
    if (current === "anti") anti.setAttribute("aria-current", "page");
  }
  if (series) {
    series.textContent = t("library_nav_series", lang);
    series.href = withLangQuery("./biblioteca-series.html");
    series.removeAttribute("aria-current");
    if (current === "series") series.setAttribute("aria-current", "page");
  }
  if (todos) {
    todos.textContent = t("library_nav_todos", lang);
    todos.href = withLangQuery("./biblioteca-todos.html");
    todos.removeAttribute("aria-current");
    if (current === "todos") todos.setAttribute("aria-current", "page");
  }
}
