export const THEME_STYLE_FIELDS = [
  "shadowOffset",
  "radius",
  "borderWidth",
  "cardRadius",
  "buttonRadius",
  "headlineMaxWidth",
  "inputRadius",
  "checkRadius",
  "bannerRadius",
  "bannerPadBottom",
];

export function themeIssues(theme) {
  const issues = [];
  for (const [key, value] of Object.entries(theme?.colors || {})) {
    if (
      !/^[a-zA-Z]+$/.test(key) ||
      typeof value !== "string" ||
      !/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
    )
      issues.push({
        group: "colors",
        key,
        message:
          "Gib einen Farbcode mit 3, 4, 6 oder 8 Zeichen ein, zum Beispiel #123456. Erlaubt sind die Ziffern 0 bis 9 und die Buchstaben A bis F.",
      });
  }
  for (const [key, value] of Object.entries(theme?.fonts || {})) {
    if (
      !["body", "display"].includes(key) ||
      typeof value !== "string" ||
      !/^[\w\s,'"-]{1,160}$/.test(value)
    )
      issues.push({
        group: "fonts",
        key,
        message:
          "Gib einen Schriftnamen mit höchstens 160 Zeichen ein. Erlaubt sind Buchstaben, Zahlen, Leerzeichen, Kommas, Anführungszeichen und Bindestriche.",
      });
  }
  for (const [key, value] of Object.entries(theme?.style || {})) {
    const valid =
      key === "shadow"
        ? ["soft", "hard"].includes(value)
        : key === "shadowOffset" && value === "none"
          ? true
          : THEME_STYLE_FIELDS.includes(key) &&
            typeof value === "string" &&
            value.split(/\s+/).length <= 4 &&
            value
              .split(/\s+/)
              .every((v) =>
                /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%)?$/.test(v),
              );
    if (!valid)
      issues.push({
        group: "style",
        key,
        message:
          key === "shadow"
            ? "Wähle einen der angebotenen Schattenstile."
            : `Verwende bis zu vier Zahlen mit px, rem, em oder %, z. B. 8px.${key === "shadowOffset" ? ' Mit "none" entfernst du den Versatz.' : ""} Ein leeres Feld verwendet den Standardwert.`,
      });
  }
  return issues;
}
