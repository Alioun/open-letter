import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import UnsubscribeApp from "./UnsubscribeApp.jsx";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
import cfg from "../config/letter.config.js";
import { injectThemeCss } from "../config/theme-css.js";
import "./index.css";

// Apply the active letter's colour/font/style tokens as :root overrides on top
// of the base values in index.css.
injectThemeCss(cfg.theme);

// The admin dashboard has its own entrypoint (admin.html → src/admin-main.jsx),
// served at the secret /${ADMIN_PATH} route, so AdminApp is bundled separately
// and never ships in this public bundle.
function render(root) {
  createRoot(document.getElementById("root")).render(
    <ErrorBoundary>{root}</ErrorBoundary>,
  );
}

// Wait for the live initial state (preloaded in <head>) so the first render
// already has the real counter and Treffen date. Capped, so a slow or failed
// request falls back to rendering with placeholders instead of a blank page.
const BOOT_TIMEOUT_MS = 1500;

function loadBoot() {
  const request = fetch("/api/boot")
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  const timeout = new Promise((resolve) =>
    setTimeout(() => resolve(null), BOOT_TIMEOUT_MS),
  );
  return Promise.race([request, timeout]);
}

const parts = window.location.pathname.split("/").filter(Boolean);
if (parts[0] === "abmelden" && parts[1]) {
  render(<UnsubscribeApp />);
} else {
  loadBoot().then((boot) => render(<App boot={boot} />));
}
