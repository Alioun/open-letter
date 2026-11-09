import { resolvePrivacy } from "./privacy.js";
const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function renderPrivacy(config) {
  const facts = resolvePrivacy(config);
  const labels = config.ui.privacy;
  const email = labels.emailProcessing
    .replace("{processor}", config.email.processor || config.email.provider)
    .replace("{region}", config.email.region || labels.unknownRegion);
  const analytics =
    config.publication?.analytics === "builtin"
      ? labels.builtinProcessing
      : config.meta.analytics?.src
        ? labels.externalProcessing
        : labels.analyticsDisabled;
  const values = {
    ...facts,
    controllerName: config.legal.entityName,
    controllerContact: config.legal.contactName,
    controllerAddress: config.legal.addressInline,
    controllerEmail: config.legal.contactEmail,
    emailProcessing: email,
    analyticsProcessing: analytics,
  };
  return String(config.legal.privacyHtml || "").replace(
    /\{\{(\w+)\}\}/g,
    (all, key) => (key in values ? esc(values[key]) : all),
  );
}
