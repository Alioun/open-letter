import { ValidationError } from "./validation.js";
// This schema belongs to the application. Puck upgrades require an explicit migration.
export const PUBLICATION_VERSION = 2;
export const PUCK_VERSION = "0.24.0";
export const SECTION_TYPES = [
  "Header",
  "Hero",
  "Letter",
  "Sign",
  "Signers",
  "Faq",
  "Meeting",
  "Text",
  "Image",
  "CallToAction",
  "Footer",
];
export const FIXED = {
  Header: "header",
  Hero: "hero",
  Letter: "brief",
  Sign: "unterzeichnen",
  Signers: "liste",
  Faq: "faq",
  Meeting: "zoom",
  Footer: "footer",
};
export const THEME_VARIABLES = [
  "--rot",
  "--rot-text",
  "--akzent",
  "--weiss",
  "--fond",
  "--grau",
  "--grau-stark",
  "--grau-hell",
  "--erfolg",
  "--fehler",
  "--font-display",
  "--font-body",
  "--border-width",
  "--radius",
  "--on-akzent",
  "--cta-bg",
  "--cta-fg",
  "--goal-fill",
  "--cta-hover-bg",
  "--cta-hover-fg",
  "--hero-bg",
  "--stat-bg",
  "--shadow-offset",
  "--radius-card",
  "--radius-button",
  "--headline-max-width",
  "--radius-input",
  "--radius-check",
  "--radius-banner",
  "--banner-pad-bottom",
];
export const SECTION_SELECTORS = Object.values(FIXED).map(
  (id) => `[data-section="${id}"]`,
);
export const BLOCK_DEFAULTS = {
  arrangement: "stacked",
  spacing: 0,
  width: "wide",
  align: "left",
  background: "",
  color: "",
  font: "body",
  fontSize: 18,
};

export function defaultLayout(config) {
  const types = [
    "Header",
    "Hero",
    "Letter",
    "Sign",
    "Signers",
    "Faq",
    ...(config.features?.zoomEvent ? ["Meeting"] : []),
    "Footer",
  ];
  return {
    root: { props: {} },
    content: types.map((type) => ({
      type,
      props: {
        ...BLOCK_DEFAULTS,
        arrangement: ["Sign", "Meeting"].includes(type) ? "split" : "stacked",
        id: FIXED[type],
      },
    })),
  };
}

export function migrateLayout(layout, version = 1) {
  if (version !== 1)
    throw new ValidationError(`Unsupported layout version ${version}`);
  return structuredClone(layout);
}

export function validateLayout(layout, config) {
  if (
    !layout ||
    !Array.isArray(layout.content) ||
    layout.content.length > 80 ||
    Object.keys(layout.zones || {}).length
  )
    throw new ValidationError("Invalid layout");
  const expected = defaultLayout(config).content;
  const ids = new Set();
  for (const block of layout.content) {
    if (!SECTION_TYPES.includes(block.type))
      throw new ValidationError("Unapproved section");
    const p = block.props;
    if (!p || !/^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/.test(p.id) || ids.has(p.id))
      throw new ValidationError("Section IDs must be stable and unique");
    ids.add(p.id);
    if (FIXED[block.type] && p.id !== FIXED[block.type])
      throw new ValidationError(
        "Functional sections cannot be duplicated or renamed",
      );
    if (
      !["stacked", "split"].includes(p.arrangement) ||
      !["narrow", "wide", "full"].includes(p.width) ||
      !["left", "center", "right"].includes(p.align) ||
      !["body", "display"].includes(p.font)
    )
      throw new ValidationError("Unsupported section arrangement");
    if (
      !Number.isFinite(p.spacing) ||
      p.spacing < 0 ||
      p.spacing > 160 ||
      !Number.isFinite(p.fontSize) ||
      p.fontSize < 12 ||
      p.fontSize > 96
    )
      throw new ValidationError("Unsupported section dimensions");
    for (const key of ["background", "color"])
      if (
        p[key] &&
        !/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(p[key])
      )
        throw new ValidationError("Use a hex section color");
    if (
      Object.keys(p).some(
        (key) => !["id", ...Object.keys(BLOCK_DEFAULTS)].includes(key),
      )
    )
      throw new ValidationError("Unknown section property");
  }
  for (const b of expected)
    if (layout.content.filter((s) => s.type === b.type).length !== 1)
      throw new ValidationError(`${b.type} is required exactly once`);
  if (
    !config.features?.zoomEvent &&
    layout.content.some((b) => b.type === "Meeting")
  )
    throw new ValidationError("Meeting feature is disabled");
  if (
    layout.content[0]?.type !== "Header" ||
    layout.content[1]?.type !== "Hero" ||
    layout.content.at(-1)?.type !== "Footer"
  )
    throw new ValidationError(
      "Header, primary hero and legal footer are anchored",
    );
  return {
    root: { props: {} },
    content: layout.content.map(({ type, props }) => ({
      type,
      props: { ...props },
    })),
  };
}

export function resolvedMetadata(config, overrides = {}) {
  const headline = (
    config.features?.successMode
      ? config.success?.headlineLines
      : config.hero?.headlineLines
  )
    ?.map((l) => l.text)
    .join(" ");
  const automatic = {
    title: `${headline || config.brand.name} | ${config.brand.name}`,
    description: config.footer.blurb || config.meta.description,
    siteName: config.brand.name,
    ogLocale: (config.brand.locale || config.brand.lang).replace("-", "_"),
    ogDescription: config.footer.blurb || config.meta.description,
  };
  return {
    ...config.meta,
    ...automatic,
    ...Object.fromEntries(
      Object.entries(overrides).filter(
        ([, value]) => value !== "" && value != null,
      ),
    ),
  };
}

export function escapeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function anchorLayout(layout) {
  const content = layout.content || [];
  return {
    root: { props: {} },
    content: [
      content.find((b) => b.type === "Header"),
      content.find((b) => b.type === "Hero"),
      ...content.filter((b) => !["Header", "Hero", "Footer"].includes(b.type)),
      content.find((b) => b.type === "Footer"),
    ].filter(Boolean),
  };
}
