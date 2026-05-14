import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import AdminApp from "./AdminApp.jsx";
import UnsubscribeApp from "./UnsubscribeApp.jsx";
import "./index.css";

function getRootComponent() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "abmelden" && parts[1]) return <UnsubscribeApp />;
  if (parts[0] === "verwaltung" && parts.length === 1) return <AdminApp />;
  return <App />;
}

createRoot(document.getElementById("root")).render(getRootComponent());
