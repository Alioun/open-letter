// Builds the :root CSS-variable overrides for a letter's theme. Used by the
// frontend (src/main.jsx injects it into <head>) and the admin entry point, so
// colours, fonts and style tokens all come from config/letter.config.js. The
// base values live in src/index.css; this only overrides the themeable ones.

// Soft drop shadows (Tailwind md/lg/xl) replacing the hard offset shadows
// in src/index.css, which fall back to their offset value when unset.
const SOFT_SHADOWS = [
  ["--elev-sm", "0 4px 6px -1px #0000001a, 0 2px 4px -2px #0000001a"],
  ["--elev-md", "0 10px 15px -3px #0000001a, 0 4px 6px -4px #0000001a"],
  ["--elev-lg", "0 20px 25px -5px #0000001a, 0 8px 10px -6px #0000001a"],
  // Offset-shadow buttons nudge up-left on hover; with soft shadows they stay put.
  ["--hover-shift", "none"],
];

export function themeCss(theme) {
  const c = theme.colors || {};
  const f = theme.fonts || {};
  const s = theme.style || {};
  const decls = [
    ["--rot", c.rot],
    ["--rot-text", c.rotText],
    ["--akzent", c.akzent],
    ["--weiss", c.weiss],
    ["--fond", c.fond],
    ["--grau", c.grau],
    ["--grau-stark", c.grauStark],
    ["--grau-hell", c.grauHell],
    ["--erfolg", c.erfolg],
    ["--on-akzent", c.onAkzent],
    ["--cta-bg", c.ctaBg],
    ["--cta-fg", c.ctaFg],
    ["--goal-fill", c.goalFill],
    ["--cta-hover-bg", c.ctaHoverBg],
    ["--cta-hover-fg", c.ctaHoverFg],
    ["--hero-bg", c.heroBg],
    ["--stat-bg", c.statBg],
    ["--fehler", c.fehler],
    ["--font-display", f.display],
    ["--font-body", f.body],
    ["--shadow-offset", s.shadowOffset],
    ["--radius", s.radius],
    ["--border-width", s.borderWidth],
    ["--radius-card", s.cardRadius],
    ["--radius-button", s.buttonRadius],
    ["--headline-max-width", s.headlineMaxWidth],
    ["--radius-input", s.inputRadius],
    ["--radius-check", s.checkRadius],
    ["--radius-banner", s.bannerRadius],
    ["--banner-pad-bottom", s.bannerPadBottom],
    ...(s.shadow === "soft" ? SOFT_SHADOWS : []),
  ]
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  return `:root {\n${decls}\n}`;
}

export function injectThemeCss(theme, doc = document) {
  const style = doc.createElement("style");
  style.setAttribute("data-theme", "letter-config");
  style.textContent = themeCss(theme);
  doc.head.appendChild(style);
}
