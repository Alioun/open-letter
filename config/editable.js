// Which config values the admin panel may change at runtime ("Texte & Modus"),
// and how an override reaches them. Overrides are stored per path in
// app_settings (`copy:<path>`), applied to the config object on the server at
// boot and after each save, and sent to the browser in /api/boot, which applies
// them to its copy of the config before the first render.
//
// Only plain text, lists, numbers and two presentation toggles are listed.
// Everything the server wires up at boot (features that add routes or
// workers, retention, email transport, head/meta, theme) stays in the config.
import { UI_DEFAULTS } from "./ui.js";
import { resolveInvite } from "./invite.js";

export const GROUPS = {
  mode: "Modus",
  hero: "Kopfbereich",
  success: "Erfolgs-Ankündigung",
  nav: "Navigation",
  sign: "Unterschreiben",
  list: "Unterschriftenliste",
  footer: "Fußzeile & Impressum",
  zoom: "Treffen",
  invite: "Einladungslinks",
  pages: "Link-Seiten (Bestätigen, Löschen, …)",
  ui: "Weitere Oberflächentexte",
  settings: "E-Mail-Einstellungsseite",
  errors: "Fehlermeldungen",
};

export const SECTION_IDS = ["brief", "unterzeichnen", "liste", "faq"];

// [path, type, group]. Paths missing from the letter's config are skipped,
// except ui.* (always present via config/ui.js).
const BASE_FIELDS = [
  ["features.successMode", "bool", "mode"],
  ["features.collapsedSections", "sections", "mode"],

  ["hero.headlineLines", "lines", "hero"],
  ["hero.counterLabel", "text", "hero"],
  ["hero.goalLabelPrefix", "text", "hero"],
  ["hero.goalMetaLabel", "text", "hero"],
  ["hero.ctaPrimary", "text", "hero"],
  ["hero.ctaSecondary", "text", "hero"],
  ["navCta", "text", "nav"],

  ["success.kicker", "text", "success"],
  ["success.headline", "text", "success"],
  ["success.headlineLines", "lines", "success"],
  ["success.body", "textarea", "success"],
  ["success.antragUrl", "url", "success"],
  ["success.antragLabel", "text", "success"],
  ["success.ctaZoom", "text", "success"],
  ["success.countLabel", "text", "success"],

  ["sign.sectionNum", "text", "sign"],
  ["sign.headingHtml", "html", "sign"],
  ["sign.criteria", "list", "sign"],
  ["sign.privacyNote", "textarea", "sign"],
  ["sign.formTitle", "text", "sign"],
  ["sign.formSubtitle", "text", "sign"],
  ["sign.fields.kreisverband.label", "text", "sign"],
  ["sign.fields.kreisverband.optionalLabel", "text", "sign"],
  ["sign.fields.kreisverband.placeholder", "text", "sign"],
  ["sign.fields.occupation.label", "text", "sign"],
  ["sign.fields.occupation.optionalLabel", "text", "sign"],
  ["sign.fields.occupation.placeholder", "text", "sign"],

  ["list.sectionNum", "text", "list"],
  ["list.headingHtml", "html", "list"],

  ["footer.heading", "text", "footer"],
  ["footer.blurb", "textarea", "footer"],
  ["footer.contactEmail", "text", "footer"],
  ["legal.disclaimer", "textarea", "footer"],

  ["zoom.section.sectionNum", "text", "zoom"],
  ["zoom.section.headingHtml", "html", "zoom"],
  ["zoom.section.whenText", "text", "zoom"],
  ["zoom.section.bullets", "list", "zoom"],
  ["zoom.section.privacy", "textarea", "zoom"],
  ["zoom.form.badge", "text", "zoom"],
  ["zoom.form.title", "text", "zoom"],
  ["zoom.form.subtitle", "text", "zoom"],
  ["zoom.form.submitLabel", "text", "zoom"],
  ["zoom.form.submittingLabel", "text", "zoom"],
  ["zoom.form.legal", "textarea", "zoom"],
  ["zoom.form.delegierterLabel", "text", "zoom"],
  ["zoom.form.doneBadge", "text", "zoom"],
  ["zoom.form.doneTitle", "text", "zoom"],
  ["zoom.form.doneText", "textarea", "zoom"],
];

// Invite texts; the stats precision keys stay in the config (the privacy
// notice describes them).
const INVITE_TEXT_KEYS = [
  "title",
  "optInLabel",
  "modalText",
  "modalTextAnonymous",
  "modalButton",
  "successHeading",
  "successNote",
  "shareMessage",
  "copyLabel",
  "copiedLabel",
  "moreLabel",
  "statsHeading",
  "statsCount",
  "statsBelow",
  "statsRange",
  "statsAtLeast",
  "statsInvalid",
];

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

export function getPath(obj, path) {
  return path
    .split(".")
    .reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// Sets obj.a.b.c, creating plain objects on the way (numeric keys index
// existing arrays, e.g. nav.0.label).
export function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== "object") o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

function textType(value) {
  return String(value ?? "").length > 90 ? "textarea" : "text";
}

function uiFields(node, prefix, out) {
  for (const [k, v] of Object.entries(node)) {
    const path = `${prefix}.${k}`;
    if (isPlainObject(v)) uiFields(v, path, out);
    else {
      const group = path.startsWith("ui.settings.")
        ? "settings"
        : path.startsWith("ui.errors.")
          ? "errors"
          : "ui";
      out.push([path, typeof v === "number" ? "number" : textType(v), group]);
    }
  }
}

// The editable fields for this letter: [{ path, type, group, default }].
// `pristine` is the config as deployed (before overrides); `pageDefaults` the
// merged link-page copy (server/pages.js), passed in by the server.
export function editableFields(pristine, pageDefaults = null) {
  const fields = [];
  const add = (path, type, group, def) =>
    fields.push({ path, type, group, default: def });

  for (const [path, type, group] of BASE_FIELDS) {
    if (group === "zoom" && !pristine.features?.zoomEvent) continue;
    const def = getPath(pristine, path);
    if (def === undefined && !path.startsWith("features.")) continue;
    add(path, type, group, def ?? (type === "sections" ? [] : false));
  }

  (pristine.nav || []).forEach((n, i) =>
    add(`nav.${i}.label`, "text", "nav", n.label),
  );

  if (pristine.features?.inviteLinks) {
    const invite = resolveInvite(pristine);
    for (const k of INVITE_TEXT_KEYS) {
      add(`invite.${k}`, textType(invite[k]), "invite", invite[k]);
    }
  }

  if (pageDefaults) {
    for (const [page, copy] of Object.entries(pageDefaults)) {
      if (!isPlainObject(copy)) {
        add(`pages.${page}`, textType(copy), "pages", copy);
        continue;
      }
      for (const [k, v] of Object.entries(copy)) {
        if (typeof v === "string") {
          add(`pages.${page}.${k}`, textType(v), "pages", v);
        }
      }
    }
  }

  const ui = [];
  uiFields(UI_DEFAULTS, "ui", ui);
  for (const [path, type, group] of ui) {
    if (group === "ui" && path.startsWith("ui.zoomForm.") && !pristine.features?.zoomEvent) continue;
    if (path.startsWith("ui.stoerer.") && !pristine.features?.zoomEvent) continue;
    add(path, type, group, getPath(pristine, path));
  }
  return fields;
}

const MAX_TEXT = 5000;

// Check one submitted value against its field type. Returns the cleaned value
// or throws with a message for the admin.
export function cleanValue(field, value) {
  const fail = (msg) => {
    throw new Error(`${field.path}: ${msg}`);
  };
  switch (field.type) {
    case "bool":
      if (typeof value !== "boolean") fail("ja/nein erwartet");
      return value;
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) fail("Zahl ≥ 0 erwartet");
      return Math.round(n);
    }
    case "sections":
      if (!Array.isArray(value) || value.some((v) => !SECTION_IDS.includes(v)))
        fail(`nur ${SECTION_IDS.join(", ")}`);
      return [...new Set(value)];
    case "list":
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
        fail("Liste von Texten erwartet");
      return value.map((v) => v.trim()).filter(Boolean).slice(0, 50);
    case "lines":
      if (
        !Array.isArray(value) ||
        !value.length ||
        value.some(
          (l) =>
            !isPlainObject(l) ||
            typeof l.text !== "string" ||
            !/^[a-z-]*$/.test(l.style || ""),
        )
      )
        fail("Zeilen mit Text und Stil erwartet");
      return value.slice(0, 10).map((l) => ({ text: l.text, style: l.style || "" }));
    case "url": {
      const s = String(value ?? "").trim();
      if (s && !/^https?:\/\//i.test(s)) fail("muss mit http:// oder https:// beginnen");
      return s.slice(0, 2000);
    }
    default:
      if (typeof value !== "string") fail("Text erwartet");
      if (value.length > MAX_TEXT) fail(`höchstens ${MAX_TEXT} Zeichen`);
      return value;
  }
}

// Apply overrides ({ path: value }) onto `target`, resetting every editable
// path without an override to its pristine value, so removing an override
// takes effect without a restart.
export function applyOverrides(target, fields, overrides) {
  for (const f of fields) {
    const has = overrides && Object.prototype.hasOwnProperty.call(overrides, f.path);
    const value = has ? overrides[f.path] : f.default;
    if (value === undefined) continue;
    setPath(target, f.path, structuredClone(value));
  }
}
