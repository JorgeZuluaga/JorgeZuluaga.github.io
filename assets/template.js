// Template behavior adapted from sources/curriculum-vitae-web/js/main.js

////////// DOM ELEMENTS //////////
const imageHeader = document.querySelector(".image");
const mainSection = document.querySelector("main");
const footerSection = document.querySelector("footer");
const openMenuButton = document.querySelector(".open-menu-button");
const closeMenuButton = document.querySelector(".close-menu-button");
const navbar = document.querySelector(".navbar");
const navLinks = document.querySelectorAll(".nav-link");
const overlay = document.querySelector(".overlay");
const sections = document.querySelectorAll("section");
const scrollToTopLink = document.querySelector(".scroll-to-top-link");

// Normalize the "back to library" label on review pages.
(() => {
  const back = document.querySelector("a.photos-back");
  if (!back) return;
  // Keep the arrow; shorten the label for mobile readability.
  back.textContent = "← Biblioteca Jorge Zuluaga";
})();

if (
  imageHeader &&
  mainSection &&
  footerSection &&
  openMenuButton &&
  closeMenuButton &&
  navbar &&
  overlay
) {
  ////////// MENU //////////
  let cleanupTrapFocus;
  let isMenuOpen = false;

  function disableScroll() {
    const scrollBarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    document.body.style.paddingRight = `${scrollBarWidth}px`;
  }

  function enableScroll() {
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  }

  function trapFocus(element) {
    const focusableElements = element.querySelectorAll("a, button");
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    function handleKeydown(event) {
      if (event.key !== "Tab") return;
      if (event.shiftKey && document.activeElement === firstElement) {
        lastElement.focus();
        event.preventDefault();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        firstElement.focus();
        event.preventDefault();
      }
    }

    element.addEventListener("keydown", handleKeydown);
    return () => element.removeEventListener("keydown", handleKeydown);
  }

  function closeMenu() {
    if (!isMenuOpen) return;
    navbar.classList.remove("active");
    overlay.classList.remove("active");
    openMenuButton.setAttribute("aria-expanded", "false");
    openMenuButton.setAttribute("aria-hidden", "false");
    imageHeader.setAttribute("aria-hidden", "false");
    mainSection.setAttribute("aria-hidden", "false");
    footerSection.setAttribute("aria-hidden", "false");
    navbar.setAttribute("aria-hidden", "true");

    enableScroll();
    cleanupTrapFocus?.();
    isMenuOpen = false;

    document.body.removeEventListener("keydown", handleEscapeKey);
    setTimeout(() => openMenuButton.focus(), 250);
  }

  function handleEscapeKey(event) {
    if (event.key === "Escape") closeMenu();
  }

  function openMenu() {
    if (isMenuOpen) return;

    navbar.classList.add("active");
    overlay.classList.add("active");
    openMenuButton.setAttribute("aria-expanded", "true");
    openMenuButton.setAttribute("aria-hidden", "true");
    imageHeader.setAttribute("aria-hidden", "true");
    mainSection.setAttribute("aria-hidden", "true");
    footerSection.setAttribute("aria-hidden", "true");
    navbar.setAttribute("aria-hidden", "false");

    disableScroll();
    cleanupTrapFocus = trapFocus(navbar);
    isMenuOpen = true;

    document.body.addEventListener("keydown", handleEscapeKey);

    const firstNavLink = navLinks?.[0];
    setTimeout(() => firstNavLink?.focus(), 250);
  }

  function navigateToSection(event, sectionId) {
    event.preventDefault();
    const targetSection = document.querySelector(sectionId);
    targetSection?.scrollIntoView({ behavior: "smooth" });
    closeMenu();
  }

  openMenuButton.addEventListener("click", openMenu);
  closeMenuButton.addEventListener("click", closeMenu);
  overlay.addEventListener("click", closeMenu);

  navLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href");
      if (href && href.startsWith("#")) {
        navigateToSection(event, href);
      } else {
        closeMenu();
      }
    });
  });

  ////////// ACTIVE LINK WITH SCROLL //////////
  function activeNavLinks() {
    let len = sections.length;
    while (--len && window.scrollY + 97 < sections[len].offsetTop) { }
    navLinks.forEach((link) => link.classList.remove("active"));
    if (navLinks[len]) navLinks[len].classList.add("active");
  }

  activeNavLinks();
  window.addEventListener("scroll", activeNavLinks);
}

////////// SCROLL TO TOP LINK //////////
if (scrollToTopLink) {
  window.addEventListener("scroll", () => {
    scrollToTopLink.classList.toggle("active", window.scrollY > 500);
  });

  scrollToTopLink.addEventListener("click", (event) => {
    event.preventDefault();
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  });
}

//////// THEME //////////
const themeButton = document.querySelector(".theme-button");
const body = document.body;
const darkThemeClass = "dark-theme";
const moonIcon = document.querySelector(".moon-icon");
const sunIcon = document.querySelector(".sun-icon");

const getCurrentTheme = () =>
  body.classList.contains(darkThemeClass) ? "dark" : "light";

function themeAriaLabel(theme) {
  const en = new URLSearchParams(window.location.search).get("lang") === "en";
  if (theme === "dark") {
    return en ? "Switch to light mode" : "Cambiar a modo claro";
  }
  return en ? "Switch to dark mode" : "Cambiar a modo oscuro";
}

const updateIconsAndAriaLabel = (theme) => {
  document.querySelectorAll(".theme-button").forEach((btn) => {
    const moon = btn.querySelector(".moon-icon");
    const sun = btn.querySelector(".sun-icon");
    if (!moon || !sun) return;
    if (theme === "dark") {
      moon.style.display = "block";
      sun.style.display = "none";
    } else {
      moon.style.display = "none";
      sun.style.display = "block";
    }
    btn.setAttribute("aria-label", themeAriaLabel(theme));
  });
};

if (themeButton) {
  const selectedTheme = localStorage.getItem("selected-theme");
  if (selectedTheme) {
    body.classList[selectedTheme === "dark" ? "add" : "remove"](darkThemeClass);
    updateIconsAndAriaLabel(selectedTheme);
  } else {
    // Verificamos si es móvil (< 768px) o si el sistema operativo (como iOS) tiene activado explícitamente el modo oscuro para usar dark por defecto
    const isMobile = window.matchMedia("(max-width: 48em)").matches;
    const isDarkOS = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const defaultTheme = (isMobile || isDarkOS) ? "dark" : "light";
    body.classList[defaultTheme === "dark" ? "add" : "remove"](darkThemeClass);
    updateIconsAndAriaLabel(defaultTheme);
  }

  document.querySelectorAll(".theme-button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const currentTheme = getCurrentTheme();
      const newTheme = currentTheme === "dark" ? "light" : "dark";
      body.classList.toggle(darkThemeClass);
      updateIconsAndAriaLabel(newTheme);
      localStorage.setItem("selected-theme", newTheme);
    });
  });
}

