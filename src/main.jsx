import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import UnsubscribeApp from "./UnsubscribeApp.jsx";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
import cfg from "../config/letter.config.js";
import { injectThemeCss } from "../config/theme-css.js";
import { setPath } from "../config/editable.js";
import "./index.css";

// Apply the active letter's colour/font/style tokens as :root overrides on top
// of the base values in index.css.
injectThemeCss(cfg.theme);

// The admin dashboard has its own entrypoint (admin.html → src/admin-main.jsx),
// served at the secret /${ADMIN_PATH} route, so AdminApp is bundled separately
// and never ships in this public bundle.
let reactRoot = null;
function render(root, key = "boot") {
  reactRoot ??= createRoot(document.getElementById("root"));
  reactRoot.render(<ErrorBoundary key={key}>{root}</ErrorBoundary>);
}

// Texts and mode edited in the admin panel ("Texte & Modus"), written onto
// the bundled config before rendering. Components read cfg while rendering,
// so a re-render picks them up.
function applyCopy(boot) {
  for (const [path, value] of Object.entries(boot?.copy || {})) {
    setPath(cfg, path, value);
  }
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
  return { request, first: Promise.race([request, timeout]) };
}

// Renders with whatever arrived in time; a late boot payload still applies
// the admin's texts and re-renders, instead of leaving the defaults up.
function start(view) {
  const { request, first } = loadBoot();
  first.then((boot) => {
    applyCopy(boot);
    render(view(boot));
    if (!boot) {
      request.then((late) => {
        if (!late) return;
        applyCopy(late);
        // A new key remounts, so memoized parts re-read the texts too.
        render(view(late), "late");
      });
    }
  });
}

const parts = window.location.pathname.split("/").filter(Boolean);
if (parts[0] === "abmelden" && parts[1]) {
  start(() => <UnsubscribeApp />);
} else {
  start((boot) => <App boot={boot} />);
}
