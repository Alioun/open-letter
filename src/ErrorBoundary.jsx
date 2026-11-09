import { Component } from "react";

export class ErrorBoundary extends Component {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  componentDidCatch(err, info) {
    console.error("[ErrorBoundary]", err, info);
  }
  render() {
    if (this.state.crashed) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          style={{
            padding: "40px 24px",
            fontFamily: "Inter, sans-serif",
            color: "var(--akzent)",
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
              background: "var(--rot)",
              color: "#fff",
              border: "none",
              borderRadius: "var(--radius-button)",
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
