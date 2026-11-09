export function validRichLink(value, targets = []) {
  if (!value || /[\s\\]/.test(value)) return false;
  if (targets.some(([target]) => value === target)) return true;
  if (/^(#|\/(?!\/))/.test(value)) return true;
  try {
    const url = new URL(value);
    if (/^https?:\/\//.test(value)) return Boolean(url.hostname);
    return /^(mailto:|tel:).+/.test(value) && Boolean(url.pathname);
  } catch {
    return false;
  }
}
