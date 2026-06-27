import { getPageLang, t } from "./i18n.js";

function workerEndpoint() {
  const meta = document.querySelector('meta[name="review-notify-endpoint"]');
  return (meta?.getAttribute("content") || "").trim().replace(/\/$/, "");
}

function qsParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function subscribeButtonLabel(count, lang = getPageLang()) {
  const base = t("library_subscribe_open", lang);
  if (!Number.isFinite(count) || count < 0) return base;
  if (count === 1) return t("library_subscribe_open_count_one", lang);
  return t("library_subscribe_open_count_many", lang).replace("{count}", String(count));
}

function updateSubscribeButtonLabel(count) {
  const btn = document.getElementById("review-subscribe-open");
  if (!btn) return;
  btn.textContent = subscribeButtonLabel(count);
}

async function fetchSubscriberCount() {
  const endpoint = workerEndpoint();
  if (!endpoint) return null;
  try {
    const res = await fetch(`${endpoint}/subscriber-count`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok || !Number.isFinite(Number(data.count))) return null;
    return Math.max(0, Number(data.count));
  } catch {
    return null;
  }
}

async function refreshSubscribeButtonLabel() {
  const count = await fetchSubscriberCount();
  if (count !== null) updateSubscribeButtonLabel(count);
}

function showToast(message, isError = false) {
  const el = document.getElementById("review-subscribe-toast");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.classList.toggle("review-subscribe-toast--error", isError);
  window.setTimeout(() => {
    el.hidden = true;
  }, 6000);
}

function openModal() {
  const overlay = document.getElementById("review-subscribe-overlay");
  if (!overlay) return;
  overlay.classList.add("active");
  overlay.setAttribute("aria-hidden", "false");
  const input = document.getElementById("review-subscribe-email");
  input?.focus();
}

function closeModal() {
  const overlay = document.getElementById("review-subscribe-overlay");
  if (!overlay) return;
  overlay.classList.remove("active");
  overlay.setAttribute("aria-hidden", "true");
}

async function handleSubmit(event) {
  event.preventDefault();
  const endpoint = workerEndpoint();
  const emailInput = document.getElementById("review-subscribe-email");
  const submitBtn = document.getElementById("review-subscribe-submit");
  const status = document.getElementById("review-subscribe-status");
  const email = String(emailInput?.value || "").trim();
  if (!endpoint) {
    showToast(t("library_subscribe_error_config"), true);
    return;
  }
  if (!email) return;

  submitBtn?.setAttribute("disabled", "disabled");
  if (status) {
    status.textContent = t("library_subscribe_sending");
    status.hidden = false;
  }

  try {
    const res = await fetch(`${endpoint}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, lang: getPageLang() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "subscribe_failed");
    }
    if (status) status.textContent = t("library_subscribe_success");
    emailInput.value = "";
    showToast(t("library_subscribe_success"));
    if (data.status === "subscribed") {
      await refreshSubscribeButtonLabel();
    }
    window.setTimeout(closeModal, 1800);
  } catch {
    if (status) status.textContent = t("library_subscribe_error");
    showToast(t("library_subscribe_error"), true);
  } finally {
    submitBtn?.removeAttribute("disabled");
  }
}

function applySubscribeQueryFeedback() {
  const sub = qsParam("subscribe");
  if (sub === "unsubscribed") {
    showToast(t("library_subscribe_unsubscribed_ok"));
    refreshSubscribeButtonLabel().catch(() => {});
  } else if (sub === "open") {
    openModal();
  }
}

function bindSubscribeUi() {
  document.getElementById("review-subscribe-open")?.addEventListener("click", openModal);
  document.getElementById("review-subscribe-close")?.addEventListener("click", closeModal);
  document.getElementById("review-subscribe-cancel")?.addEventListener("click", closeModal);
  document.getElementById("review-subscribe-overlay")?.addEventListener("click", (ev) => {
    if (ev.target?.id === "review-subscribe-overlay") closeModal();
  });
  document.getElementById("review-subscribe-form")?.addEventListener("submit", handleSubmit);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeModal();
  });
  applySubscribeQueryFeedback();
  refreshSubscribeButtonLabel().catch(() => {});
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindSubscribeUi);
} else {
  bindSubscribeUi();
}

export { bindSubscribeUi, refreshSubscribeButtonLabel, subscribeButtonLabel };
