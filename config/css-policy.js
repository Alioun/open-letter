import { ValidationError } from "./validation.js";
import { parse, walk, lexer } from "css-tree";
import { THEME_VARIABLES, SECTION_SELECTORS } from "./publication.js";
export { THEME_VARIABLES, SECTION_SELECTORS };

export function cssDiagnostics(source, approvedAssets = []) {
  const diagnostics = [];
  const fail = (node, message) =>
    diagnostics.push({
      from: node.loc?.start.offset || 0,
      to: node.loc?.end.offset || source.length,
      severity: "error",
      message,
    });
  if (typeof source !== "string" || source.length > 100000)
    return [
      { from: 0, to: 0, severity: "error", message: "CSS exceeds 100 KB" },
    ];
  if (source.includes("\\"))
    return [
      {
        from: 0,
        to: source.length,
        severity: "error",
        message: "Use literal CSS tokens instead of escapes",
      },
    ];
  // Escaped tokens must be interpreted by the parser, never a URL regex.
  try {
    const ast = parse(source, {
      positions: true,
      onParseError(error) {
        fail(
          {
            loc: {
              start: { offset: error.offset },
              end: { offset: error.offset + 1 },
            },
          },
          error.message,
        );
      },
    });
    walk(ast, (node) => {
      if (node.type === "Raw") fail(node, "Unsupported or malformed CSS");
      if (
        node.type === "Atrule" &&
        ![
          "media",
          "supports",
          "layer",
          "container",
          "keyframes",
          "font-face",
          "property",
        ].includes(node.name.toLowerCase())
      )
        fail(node, "This at-rule is not allowed (including remote imports)");
      if (node.type === "Url" && !approvedAssets.includes(node.value))
        fail(node, "Resources must be approved public assets");
      if (
        node.type === "Function" &&
        [
          "image-set",
          "-webkit-image-set",
          "image",
          "src",
          "expression",
          "paint",
        ].includes(node.name.toLowerCase())
      )
        fail(node, "Unsupported resource or executable function");
      if (
        node.type === "Declaration" &&
        ["behavior", "-moz-binding"].includes(node.property.toLowerCase())
      )
        fail(node, "Unsupported property");
      if (node.type === "Declaration" && !node.property.startsWith("--")) {
        const result = lexer.matchProperty(node.property, node.value);
        if (result.error && !result.error.message.includes("var("))
          diagnostics.push({
            from: node.loc.start.offset,
            to: node.loc.end.offset,
            severity: "warning",
            message: result.error.message.split("\n")[0],
          });
      }
    });
  } catch (error) {
    diagnostics.push({
      from: error.offset || 0,
      to: Math.min(source.length, (error.offset || 0) + 1),
      severity: "error",
      message: error.message,
    });
  }
  // HTML style boundaries are meaningful even when CSS considers them a comment/string.
  if (/<\/style/i.test(source))
    diagnostics.push({
      from: 0,
      to: source.length,
      severity: "error",
      message: "HTML boundaries are not CSS",
    });
  return diagnostics;
}

export function validateCss(source, assets) {
  const errors = cssDiagnostics(source, assets).filter(
    (d) => d.severity === "error",
  );
  if (errors.length)
    throw new ValidationError(errors.map((d) => d.message).join("; "));
  return source;
}
