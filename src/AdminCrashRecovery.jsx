import { Button } from "@base-ui/react/button";

export default function AdminCrashRecovery() {
  return (
    <main className="admin-shell login-shell">
      <section className="admin-card admin-crash-recovery" role="alert">
        <h1>Verwaltung konnte nicht geladen werden</h1>
        <p>
          Die Verwaltung konnte wegen eines Fehlers nicht starten. Lade sie neu.
          Entwürfe, die der Browser bereits gespeichert hat, bleiben erhalten.
        </p>
        <Button
          className="cta"
          onClick={() => window.location.reload()}
          autoFocus
        >
          Verwaltung neu laden
        </Button>
      </section>
    </main>
  );
}
