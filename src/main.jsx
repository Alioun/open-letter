import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import AdminApp from "./AdminApp.jsx";
import UnsubscribeApp from "./UnsubscribeApp.jsx";
import "./index.css";

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function getRootComponent() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "abmelden" && parts[1]) return <UnsubscribeApp />;

  const expectedHash = process.env.PUBLIC_ADMIN_PATH_HASH || "";
  const currentHash = await sha256Hex(parts[0] || "");
  if (expectedHash && currentHash === expectedHash && parts.length === 1) {
    return <AdminApp />;
  }

  return <App />;
}

createRoot(document.getElementById("root")).render(await getRootComponent());
