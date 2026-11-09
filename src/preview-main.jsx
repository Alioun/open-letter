import { createRoot } from "react-dom/client";
import cfg from "../config/letter.config.js";
import App from "./App.jsx";
import { fixtureBoot, fixtureFetch } from "./preview-fixtures.js";
import "./index.css";

const data = JSON.parse(
  document.getElementById("publication-data").textContent,
);
Object.assign(cfg, data.config);
// Even components outside App's request wrapper cannot reach the live service.
window.fetch = fixtureFetch;
document.addEventListener("submit", (e) => e.preventDefault());
document.addEventListener("click", (e) => {
  const link = e.target.closest("a");
  if (link && !link.getAttribute("href")?.startsWith("#")) e.preventDefault();
});
if (data.pageState === "success") cfg.features.successMode = true;
createRoot(document.getElementById("root")).render(
  <App boot={fixtureBoot} preview previewState={data.pageState} />,
);
