class PreviewError extends Error {
  constructor(message, detail) {
    super(message);
    this.detail = detail;
  }
}

export async function readPublicationPreview(api, body) {
  let response;
  try {
    response = await api("/api/admin/publication/preview", {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new PreviewError(
      "Die Vorschau konnte nicht geladen werden. Dein lokaler Entwurf bleibt erhalten. Prüfe die Verbindung und versuche es erneut.",
      error.message,
    );
  }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new PreviewError(
      response.status === 401
        ? "Deine Sitzung ist abgelaufen. Melde dich erneut an und öffne die Vorschau noch einmal. Dein Entwurf bleibt im Browser erhalten."
        : response.status === 400
          ? "Die Vorschau wurde abgelehnt. Dein lokaler Entwurf bleibt erhalten. Prüfe die markierten Inhalte und versuche es erneut."
          : "Die Vorschau ist gerade nicht verfügbar. Dein lokaler Entwurf bleibt erhalten. Versuche es erneut.",
      result.error || `HTTP ${response.status}`,
    );
  }
  try {
    return await response.text();
  } catch (error) {
    throw new PreviewError(
      "Die Vorschau ist unvollständig. Dein Entwurf bleibt im Browser erhalten. Prüfe die Verbindung und öffne die Vorschau erneut.",
      error.message,
    );
  }
}
