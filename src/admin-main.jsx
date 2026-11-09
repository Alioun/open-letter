import { createRoot } from "react-dom/client";
import AdminApp from "./AdminApp.jsx";
import AdminCrashRecovery from "./AdminCrashRecovery.jsx";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
import cfg, { LANGUAGES } from "../config/letter.config.js";
import { injectThemeCss } from "../config/theme-css.js";
import "./index.css";
import "./admin.css";

const embedded = document.getElementById("admin-config");
if (embedded) {
  const data = JSON.parse(embedded.textContent);
  Object.assign(cfg.features, data.features);
  LANGUAGES.splice(0, LANGUAGES.length, ...data.languages);
}
injectThemeCss(cfg.theme);

// Admin dashboard entrypoint. Served only at the secret /${ADMIN_PATH} route
// (see server/index.js) via admin.html, so AdminApp is bundled separately and
// never ships in the public homepage bundle. Access is gated server-side, so
// this renders AdminApp unconditionally.
createRoot(document.getElementById("root")).render(
  <ErrorBoundary fallback={<AdminCrashRecovery />}>
    <AdminApp />
  </ErrorBoundary>,
);
