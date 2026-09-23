// The optional region field is stored as `kreisverband` in the code and the
// database. A letter can rename it (e.g. "Bezirk") and restrict it to fixed
// options via sign.fields.kreisverband; every UI reads its wording from here.

// Group name the server uses for signers who left the field empty.
export const KV_NONE = "Ohne Kreisverband";

export function regionLabels(cfg) {
  const f = cfg.sign?.fields?.kreisverband ?? {};
  const options =
    Array.isArray(f.options) && f.options.length ? f.options : null;
  // A custom label only renames the field once it is a fixed list; free-text
  // letters keep "Kreisverband" (their label may be a UI hint like "Region").
  const renamed = Boolean(options && f.label);
  return {
    options,
    name: renamed ? f.label : "Kreisverband",
    plural: f.pluralLabel ?? "Kreisverbände",
    none: f.noneLabel ?? KV_NONE,
    rowPrefix: f.rowPrefix ?? "KV ",
    selectPlaceholder: f.selectPlaceholder ?? "Bitte wählen",
  };
}
