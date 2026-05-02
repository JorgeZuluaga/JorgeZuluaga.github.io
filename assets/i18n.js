/**
 * Bilingual UI: default Spanish; English via ?lang=en on the same HTML files.
 */

export function getPageLang() {
  const v = new URLSearchParams(window.location.search).get("lang");
  if (v === "en") return "en";
  return "es";
}

export function withLangQuery(href) {
  const lang = getPageLang();
  if (lang !== "en") return href;
  try {
    const u = new URL(href, window.location.href);
    if (!/^https?:$/i.test(u.protocol)) return href;
    u.searchParams.set("lang", "en");
    if (u.origin === window.location.origin) {
      return `${u.pathname}${u.search}${u.hash}`;
    }
    return u.toString();
  } catch {
    return href.includes("?") ? `${href}&lang=en` : `${href}?lang=en`;
  }
}

export function pickLocalized(obj, key, lang) {
  if (!obj || typeof obj !== "object") return undefined;
  if (lang !== "en") return obj[key];
  const enVal = obj[`${key}_en`];
  if (enVal !== undefined && enVal !== null && String(enVal).trim() !== "") {
    return enVal;
  }
  return obj[key];
}

export function pickLocalizedArray(obj, key, lang) {
  const enKey = `${key}_en`;
  if (lang === "en" && Array.isArray(obj[enKey]) && obj[enKey].length) {
    return obj[enKey];
  }
  const base = obj[key];
  return Array.isArray(base) ? base : [];
}

const STRINGS = {
  es: {
    skip: "Saltar al contenido",
    gallery: "Galería y Perfil",
    menu_open: "Menú de navegación",
    menu_close: "Cerrar menú de navegación",
    theme_toggle: "Modo de visualización: Claro/Oscuro",
    theme_to_light: "Cambiar a modo claro",
    theme_to_dark: "Cambiar a modo oscuro",
    lang_es: "Español",
    lang_en: "English",
    nav_group_basic: "Información básica",
    nav_group_pub: "Publicaciones",
    nav_group_exp: "Experiencia profesional",
    nav_group_tech: "Experiencia técnica",
    nav_group_other: "Otros",
    nav_contact: "Contacto",
    nav_about: "Sobre mí",
    nav_education: "Educación",
    nav_stays: "Estancias",
    nav_awards: "Premios",
    nav_articles: "Artículos",
    nav_books: "Libros",
    nav_logros: "Logros profesionales",
    nav_work: "Experiencia laboral",
    nav_teaching: "Docencia",
    nav_skills: "Habilidades técnicas",
    nav_apps: "Apps",
    nav_software: "Paquetes de software",
    nav_photos: "Fotos (prensa)",
    nav_library: "Biblioteca personal",
    home_qr: "Léeme en la web",
    home_lang_nav: "Seleccionar idioma",
    home_lang_es: "Versión en español",
    home_lang_en: "Versión en inglés",
    home_qr_aria: "Código QR de la versión en línea",
    avatar_alt: "Foto de perfil",
    section_contact: "Contacto",
    section_about: "Sobre mí",
    section_education: "Educación",
    section_stays: "Estancias de investigación",
    section_awards: "Premios y reconocimientos",
    section_publications: "Publicaciones",
    section_books: "Libros",
    books_intro:
      "Libros publicados y materiales académicos asociados a mis áreas de trabajo.",
    section_logros: "Logros profesionales",
    logros_intro:
      "Algunos de los hitos y contribuciones más importantes a lo largo de mi carrera académica, institucional y divulgativa.",
    section_work: "Experiencia laboral",
    work_intro:
      "Cargo y trayectoria en instituciones académicas y de investigación, con base en la información del CvLAC.",
    exp_role_fallback: "Cargo",
    exp_inst_fallback: "Institución",
    section_teaching: "Docencia",
    teaching_intro:
      "A continuación se detallan los cursos que he ofrecido en la Universidad de Antioquia entre el 2021 y el presente año.",
    section_skills: "Habilidades Técnicas",
    skills_intro:
      "Durante la mayor parte de mi carrera profesional, he utilizado lenguajes y entornos de programación para la investigación, docencia y desarrollo de software científico. No solamente uso estas herramientas para mi trabajo de investigación, sino que también son parte esencial de mi trabajo docente, incluso como divulgador.",
    skills_admin:
      "Soy experto en administración de servidores Linux; tengo experiencia con la configuración y administración de servidores en las nubes de Google y Amazon AWS.",
    section_apps: "Apps educativas y comerciales",
    apps_lead:
      "Como docente, divulgador e investigador he aprovechado los últimos avances en herramientas de desarrollo de apps para la web con el fin de crear herramientas didácticas para mis estudiantes. También he desarrollado apps de interés personal o comercial. Abajo se enumeran las apps desarrolladas.",
    section_software: "Paquetes de software",
    software_lead:
      "A continuación se enumeran todo los paquetes de software que he desarrollado para la investigación y la docencia. Algunos de estos paquetes fueron desarrollados en colaboración con estudiantes de pregrado y posgrado.",
    pub_links_label: "Enlaces de referencia",
    pub_google_scholar: "Google Scholar",
    pub_orcid: "ORCID:",
    pub_table_source: "Fuente",
    pub_table_total: "Total",
    pub_table_since: "Desde 2021",
    pub_stats_citations: "Citations",
    pub_stats_hindex: "h-index",
    pub_stats_i10: "i10-index",
    pub_stats_articles: "Artículos (Google Scholar)",
    pub_h3_latest: "Los 5 artículos más recientes",
    pub_h3_top: "Los 5 artículos más citados (Scholar)",
    pub_h3_best: "Los 5 artículos preferidos",
    pub_h3_multi: "Artículos multidisciplinarios",
    pub_h3_preprints: "Preprints seleccionados",
    pub_citations: "Citaciones",
    pub_no_title: "(Sin título)",
    empty_pub_strong: "No se pudieron cargar publicaciones recientes.",
    empty_pub_rest: "Revisa la consola del navegador.",
    footer_dev: "Desarrollado en Cursor por Jorge I. Zuluaga (2026). Actualizado:",
    footer_pdf: "Guardar como PDF",
    scroll_top: "Volver arriba",
    updated_label: "Actualizado:",
    error_cv:
      "No se pudo cargar el CV. Revisa la consola del navegador.",
    footer_line: "Jorge I. Zuluaga —",
    footer_cv_link: "Currículum en línea",
    libros_pub: "Fecha de publicación:",
    libros_issn: "ISSN:",
    libros_editorial: "Editorial:",
    libros_status: "Estado:",
    libros_link: "Enlace de adquisición o descarga:",
    software_authors: "Autores:",
    software_created: "Fecha de creación:",
    apps_url: "URL:",
    education_recognition: "Reconocimientos:",
    teaching_desc: "Descripción:",
    teaching_topics: "Tópicos importantes:",
    teaching_offered: "Ofrecido en:",
    teaching_created: "Creado",
    teaching_students: "Estudiantes",
    library_back_cv: "← Volver al CV",
    library_title: "Biblioteca personal de Jorge Zuluaga",
    library_intro:
      "Como buen académico, la lectura para mí es más que una pasión: es una actividad intelectual en toda regla que exige dedicación y disciplina. En particular me he propuesto escribir de cada libro que leo (siempre que pueda y valga la pena) una reseña (corta o extensa) para esencialmente intentar conjurar el olvido y recordar lo que sentí cuando leí el libro. Si la reseña además le sirve a alguien para animarse a leer el libro o para compartir sus sentimientos hacia él, ¡excelente!. En esta página enumero los libros leídos y las reseñas escritas sobre ellos. Espero que quién aterrice por aquí, lo encuentre útil.",
    library_goodreads_note:
      "Estas estadísticas y reseñas las llevo registrando y escribiendo en Goodreads. Pero esta plataforma es relativamente restrictiva y por eso creé esta página. Para quienes tienen cuenta en esa red social, abajo encontrarán el enlace a mi perfil en Goodreads.",
    library_profile: "Mi perfil en Goodreads",
    library_source: "Datos cargados desde info/library.json",
    library_books_read: "libros leídos",
    library_read: "Libros leídos",
    library_reviewed: "Libros reseñados",
    library_likes: "Likes totales en Goodreads",
    library_likes_local_total: "Me gusta locales",
    library_by_year: "Estadística de libros leídos por año",
    library_books_per_year: "libros",
    library_latest: "Últimos libros leídos",
    library_show_latest_20: "Mostrar los últimos 20",
    library_show_latest_5: "Mostrar menos",
    library_view_all_books: "Ver todos los libros",
    library_top10: "Mejores reseñas (de acuerdo a la comunidad de Goodreads)",
    library_top50_title: "Los libros preferidos",
    library_show_top_20: "Mostrar las 20 mejores",
    library_show_all: "Ver todos los libros",
    library_show_antilibrary: "Ver antibiblioteca",
    library_no_rating: "Sin calificación",
    library_by_author: "Por:",
    library_date: "Fecha:",
    library_date_added: "Fecha de agregado:",
    library_review_likes: "Likes Goodreads:",
    library_review_likes_local: "Me gusta locales:",
    library_rating_label: "Mi Calificación:",
    library_view_review: "Ver reseña",
    library_view_review_goodreads: "Ver reseña (GoodReads, necesita cuenta)",
    library_view_review_local: "Ver reseña (local)",
    library_review_links: "Enlaces de reseña",
    library_no_review: "(No hay reseña)",
    library_series: "Saga o colección personal:",
    library_series_none: "(Ninguna)",
    library_date_read: "Fecha leído:",
    library_details_missing: "falta registro detallado",
    library_details_present: "registro detallado",
    library_rating_gr_hover: "Calificación de 1 a 5 estrellas asignada por Jorge Zuluaga en Goodreads",
    library_rating_drz: "Mi puntaje:",
    library_rating_drz_hover: "Un puntaje de 0 a 100 usado por Jorge Zuluaga recomendar libros",
    library_drz_pending: "(pendiente)",
    library_likes_gr_hover: "Me gusta de la comunidad De Goodreads",
    library_likes_local_hover: "Me gustas recibidos en esta página (ver final de las reseñas)",
    library_sagas_page_title: "Sagas y colecciones personales",
    library_sagas_page_intro: "Listado completo de todas las colecciones agrupadas.",
    library_show_sagas: "Ver sagas y colecciones",
    library_no_data: "Sin datos disponibles.",
    library_stats_error:
      "No se pudieron cargar las estadísticas de lectura. Compruebe que exista <code>info/library.json</code>.",
    library_all_title: "Todos los libros leídos",
    library_all_intro:
      "Listado completo ordenado del más reciente al más antiguo.",
    antilibrary_title: "Antibiblioteca personal",
    antilibrary_intro:
      "Toda persona lectora conserva en su biblioteca un cierto número de libros, muchos o solo unos pocos, que no ha leído y posiblemente no leerá jamás. El escritor Nassim Nicholas Taleb llamó a este conjunto de libros deseados la <i>antibiblioteca</i> (ver cita abajo). En esta página comparto el listado de libros en mi biblioteca personal que no he leído, mi antibiblioteca, y que por la misma razón no he registrado en Goodreads, ordenado por fecha de incorporación.",
    antilibrary_back: "← Volver a Biblioteca",
    antilibrary_quote:
      "«El escritor Umberto Eco pertenece a esa pequeña clase de eruditos enciclopédicos, perspicaces y aburridos. Poseedor de una gran biblioteca personal (con treinta mil libros), divide a los visitantes en dos categorías: los que reaccionan con un «¡Vaya! Signore professore dottore Eco, ¡qué biblioteca tiene usted! ¿Cuántos de estos libros ha leído?» y los otros -una minoría muy pequeña- que entienden que una biblioteca privada no es un apéndice para aumentar el ego, sino una herramienta de investigación. Los libros leídos tienen mucho menos valor que los no leídos. La biblioteca debería contener tanto de lo que no sabes como te permitan tus medios económicos, los tipos de interés de las hipotecas y el ajustado mercado inmobiliario actual. Acumularás más conocimientos y más libros a medida que envejezcas, y el creciente número de libros sin leer en las estanterías te mirará amenazadoramente. En efecto, cuanto más sepas, mayores serán las filas de libros sin leer. Llamemos a esta colección de libros sin leer antilibrería.»",
    antilibrary_source_original: "Fuente original:",
    antilibrary_source_translation: "Traducción:",
    antilibrary_stats_total: "Total de libros",
    antilibrary_stats_unread: "Libros no leídos",
    antilibrary_stats_read: "Libros leídos",
    library_back: "← Volver a Biblioteca",
    library_list_error:
      "No se pudieron cargar los libros. Compruebe que exista <code>info/library.json</code>.",
    library_book_title_fallback: "Libro sin título",
    photos_back_cv: "← Volver al CV",
    photos_title: "Fotografías para conferencias y prensa",
    photos_intro:
      "Imágenes de Jorge I. Zuluaga en alta resolución para programas, credenciales y comunicación. Pulse «Vista previa» (o la miniatura) para ver la foto grande antes de descargarla.",
    photos_profile_title: "Perfil breve",
    photos_profile_text:
      "Físico y Doctor en Física, profesor titular e investigador en la Universidad de Antioquia. Su trabajo integra investigación en ciencias planetarias y astrobiología, computación científica de alto desempeño y formación avanzada en física y astronomía. Ha liderado grupos y programas académicos, y cuenta con una trayectoria de publicaciones en exoplanetas, exolunas, campos magnéticos planetarios, dinámica orbital y meteoroides, junto con una labor sostenida de divulgación científica en escenarios académicos y públicos.",
    photos_preview: "Vista previa",
    photos_preview_close: "Cerrar vista previa",
    photos_preview_title: "Vista previa",
    photos_preview_aria: "Vista previa:",
    photos_download: "Descargar",
    photos_download_file: "Descargar archivo",
    photos_photo_fallback: "Fotografía",
    photos_error:
      "No se pudieron cargar las fotos. Compruebe que exista <code>info/photos/photos.json</code> y la consola del navegador.",
    aria_home: "Inicio",
    aria_publication_links: "Enlaces de referencia",
    meta_description: "Currículum vitae académico.",
  },
  en: {
    skip: "Skip to content",
    gallery: "Gallery and Profile",
    menu_open: "Navigation menu",
    menu_close: "Close navigation menu",
    theme_toggle: "Display mode: Light/Dark",
    theme_to_light: "Switch to light mode",
    theme_to_dark: "Switch to dark mode",
    lang_es: "Español",
    lang_en: "English",
    nav_group_basic: "Basic information",
    nav_group_pub: "Publications",
    nav_group_exp: "Professional experience",
    nav_group_tech: "Technical experience",
    nav_group_other: "Other",
    nav_contact: "Contact",
    nav_about: "About me",
    nav_education: "Education",
    nav_stays: "Research stays",
    nav_awards: "Awards",
    nav_articles: "Articles",
    nav_books: "Books",
    nav_logros: "Professional highlights",
    nav_work: "Work experience",
    nav_teaching: "Teaching",
    nav_skills: "Technical skills",
    nav_apps: "Apps",
    nav_software: "Software packages",
    nav_photos: "Photos (press)",
    nav_library: "Personal library",
    home_qr: "Read me online",
    home_lang_nav: "Choose language",
    home_lang_es: "Spanish version",
    home_lang_en: "English version",
    home_qr_aria: "QR code for the online version",
    avatar_alt: "Profile photo",
    section_contact: "Contact",
    section_about: "About me",
    section_education: "Education",
    section_stays: "Research stays",
    section_awards: "Awards and recognitions",
    section_publications: "Publications",
    section_books: "Books",
    books_intro:
      "Published books and academic materials related to my areas of work.",
    section_logros: "Professional highlights",
    logros_intro:
      "Some of the most important milestones and contributions across my academic, institutional, and outreach career.",
    section_work: "Work experience",
    work_intro:
      "Roles and trajectory at academic and research institutions, based on CvLAC information.",
    exp_role_fallback: "Role",
    exp_inst_fallback: "Institution",
    section_teaching: "Teaching",
    teaching_intro:
      "Below are the courses I have offered at Universidad de Antioquia (since 2021 through the present year).",
    section_skills: "Technical skills",
    skills_intro:
      "Throughout most of my career I have used programming languages and environments for research, teaching, and scientific software development. I rely on these tools not only for research but also as an essential part of my teaching and outreach work.",
    skills_admin:
      "I am experienced in Linux server administration and have configured and managed servers on Google Cloud and Amazon AWS.",
    section_apps: "Educational and commercial apps",
    apps_lead:
      "As a teacher, educator, and researcher I have used modern web app tooling to build interactive learning tools for my students. I have also built personal and commercial apps. The apps are listed below.",
    section_software: "Software packages",
    software_lead:
      "Below are the software packages I have developed for research and teaching. Some were developed in collaboration with undergraduate and graduate students.",
    pub_links_label: "Reference links",
    pub_google_scholar: "Google Scholar",
    pub_orcid: "ORCID:",
    pub_table_source: "Source",
    pub_table_total: "Total",
    pub_table_since: "Since 2021",
    pub_stats_citations: "Citations",
    pub_stats_hindex: "h-index",
    pub_stats_i10: "i10-index",
    pub_stats_articles: "Articles (Google Scholar)",
    pub_h3_latest: "Five most recent articles",
    pub_h3_top: "Five most cited articles (Scholar)",
    pub_h3_best: "Five favorite articles",
    pub_h3_multi: "Multidisciplinary articles",
    pub_h3_preprints: "Selected preprints",
    pub_citations: "Citations",
    pub_no_title: "(Untitled)",
    empty_pub_strong: "Could not load recent publications.",
    empty_pub_rest: "Check the browser console.",
    footer_dev: "Built in Cursor by Jorge I. Zuluaga (2026). Updated:",
    footer_pdf: "Save as PDF",
    scroll_top: "Back to top",
    updated_label: "Updated:",
    error_cv: "Could not load the CV. Check the browser console.",
    footer_line: "Jorge I. Zuluaga —",
    footer_cv_link: "Online CV",
    libros_pub: "Publication date:",
    libros_issn: "ISSN:",
    libros_editorial: "Publisher:",
    libros_status: "Status:",
    libros_link: "Purchase or download link:",
    software_authors: "Authors:",
    software_created: "Created:",
    apps_url: "URL:",
    education_recognition: "Recognition:",
    teaching_desc: "Description:",
    teaching_topics: "Key topics:",
    teaching_offered: "Offered in:",
    teaching_created: "Created",
    teaching_students: "Students",
    library_back_cv: "← Back to CV",
    library_title: "Jorge Zuluaga's personal library",
    library_intro:
      "As a good academic, reading for me is more than a passion: it is a fully intellectual activity that demands dedication and discipline. In particular, I have set myself the goal of writing, for every book I read (whenever I can and whenever it is worth it), a review (short or long), essentially to ward off forgetting and remember what I felt when I read the book. If the review also helps someone feel encouraged to read the book or to share their own feelings about it, excellent! On this page I list the books I have read and the reviews I have written about them. I hope whoever lands here finds it useful.",
    library_goodreads_note:
      "I have been tracking these statistics and writing these reviews on Goodreads. But that platform is relatively restrictive, so I created this page. For those who have an account on that social network, below you will find the link to my Goodreads profile.",
    library_profile: "My Goodreads profile",
    library_source: "Data loaded from info/library.json",
    library_books_read: "books read",
    library_read: "Books read",
    library_reviewed: "Books reviewed",
    library_likes: "Total likes on Goodreads",
    library_likes_local_total: "Total local likes",
    library_by_year: "Statistics of books read per year",
    library_books_per_year: "books",
    library_latest: "Latest books read",
    library_show_latest_20: "Show latest 20",
    library_show_latest_5: "Show less",
    library_view_all_books: "View all books",
    library_top10: "Best reviews (according to the Goodreads community)",
    library_top50_title: "Favorite books",
    library_show_top_20: "Show the top 20",
    library_show_all: "View all books",
    library_show_antilibrary: "View anti-library",
    library_no_rating: "No rating",
    library_by_author: "By:",
    library_date: "Date:",
    library_date_added: "Date added:",
    library_review_likes: "Goodreads likes:",
    library_review_likes_local: "Local claps:",
    library_rating_label: "My Rating:",
    library_view_review: "View review",
    library_view_review_goodreads: "View review on GoodReads (account required)",
    library_view_review_local: "View local review",
    library_review_links: "Review links",
    library_no_review: "(No review)",
    library_series: "Personal series or collection:",
    library_series_none: "(None)",
    library_date_read: "Date read:",
    library_details_missing: "missing detailed record",
    library_details_present: "detailed record",
    library_rating_gr_hover: "1 to 5 star rating assigned by Jorge Zuluaga on Goodreads",
    library_rating_drz: "My score:",
    library_rating_drz_hover: "A score from 0 to 100 used by Jorge Zuluaga to recommend books",
    library_drz_pending: "(pending)",
    library_likes_gr_hover: "Likes from the Goodreads community",
    library_likes_local_hover: "Likes received on this page (see end of reviews)",
    library_sagas_page_title: "Personal sagas and collections",
    library_sagas_page_intro: "Complete list of all collections grouped.",
    library_show_sagas: "View sagas and collections",
    library_no_data: "No data available.",
    library_stats_error:
      "Could not load reading statistics. <code>info/library.json</code> must exist.",
    library_all_title: "All books read",
    library_all_intro:
      "Full list sorted from most recent to oldest.",
    antilibrary_title: "Personal anti-library",
    antilibrary_intro:
      "Every reader keeps in their library a certain number of books — many or just a few — that they have not read and may never read. Writer Nassim Nicholas Taleb called this set of desired books the <i>antilibrary</i> (see quote below). On this page I share the list of books in my personal library that I have not read — my antilibrary — and which, for the same reason, I have not logged in Goodreads, sorted by date added.",
    antilibrary_back: "← Back to library",
    antilibrary_quote:
      "The writer Umberto Eco belongs to that small class of scholars who are encyclopedic, insightful, and nondull. He is the owner of a large personal library (containing thirty thousand books), and separates visitors into two categories: those who react with “Wow! Signore professore dottore Eco, what a library you have! How many of these books have you read?” and the others — a very small minority — who get the point that a private library is not an ego-boosting appendage but a research tool. Read books are far less valuable than unread ones. The library should contain as much of what you do not know as your financial means, mortgage rates, and the currently tight real-estate market allows you to put there. You will accumulate more knowledge and more books as you grow older, and the growing number of unread books on the shelves will look at you menacingly. Indeed, the more you know, the larger the rows of unread books. Let us call this collection of unread books an antilibrary.",
    antilibrary_source_original: "Original source:",
    antilibrary_source_translation: "Translation:",
    antilibrary_stats_total: "Total books",
    antilibrary_stats_unread: "Unread books",
    antilibrary_stats_read: "Read books",
    library_back: "← Back to library",
    library_list_error:
      "Could not load books. <code>info/library.json</code> must exist.",
    library_book_title_fallback: "Untitled book",
    photos_back_cv: "← Back to CV",
    photos_title: "Photos for talks and press",
    photos_intro:
      "High-resolution images of Jorge I. Zuluaga for programs, credentials, and media use. Click “Preview” (or the thumbnail) to inspect the large image before downloading it.",
    photos_profile_title: "Brief profile",
    photos_profile_text:
      "Physicist and PhD in Physics, full professor and researcher at the University of Antioquia. His work integrates research in planetary science and astrobiology, high-performance scientific computing, and advanced training in physics and astronomy. He has led research groups and academic programs, and has published extensively on exoplanets, exomoons, planetary magnetic fields, orbital dynamics, and meteoroids, alongside sustained science communication in academic and public settings.",
    photos_preview: "Preview",
    photos_preview_close: "Close preview",
    photos_preview_title: "Preview",
    photos_preview_aria: "Preview:",
    photos_download: "Download",
    photos_download_file: "Download file",
    photos_photo_fallback: "Photo",
    photos_error:
      "Could not load the photos. Make sure <code>info/photos/photos.json</code> exists and check the browser console.",
    aria_home: "Home",
    aria_publication_links: "Reference links",
    meta_description: "Academic curriculum vitae.",
  },
};

export function t(key, lang = getPageLang()) {
  const table = STRINGS[lang] ?? STRINGS.es;
  return table[key] ?? STRINGS.es[key] ?? key;
}

export function applyThemeAriaFromLang(lang = getPageLang()) {
  const isDark = document.body.classList.contains("dark-theme");
  const label = isDark ? t("theme_to_light", lang) : t("theme_to_dark", lang);
  document.querySelectorAll(".theme-button").forEach((btn) => {
    btn.setAttribute("aria-label", label);
  });
}
