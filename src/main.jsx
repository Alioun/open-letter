import { createRoot } from "react-dom/client";
import { Component } from "react";
import App from "./App.jsx";
import AdminApp from "./AdminApp.jsx";
import UnsubscribeApp from "./UnsubscribeApp.jsx";
import "./index.css";

class ErrorBoundary extends Component {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  componentDidCatch(err, info) {
    console.error("[ErrorBoundary]", err, info);
  }
  render() {
    if (this.state.crashed) {
      return (
        <div
          style={{
            padding: "40px 24px",
            fontFamily: "Inter, sans-serif",
            color: "var(--akzent, #6f003c)",
            maxWidth: 480,
            margin: "80px auto",
          }}
        >
          <h1 style={{ fontSize: "1.5rem", marginBottom: 16 }}>
            Seite konnte nicht geladen werden
          </h1>
          <p style={{ marginBottom: 24 }}>
            Ein unerwarteter Fehler ist aufgetreten. Bitte lade die Seite neu.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "12px 24px",
              background: "var(--rot, #ff0000)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "1rem",
            }}
          >
            Seite neu laden
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function getRootComponent() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "abmelden" && parts[1]) return <UnsubscribeApp />;
  if (parts[0] === "verwaltung" && parts.length === 1) return <AdminApp />;
  return <App />;
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>{getRootComponent()}</ErrorBoundary>,
);
