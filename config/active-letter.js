// Resolves which letter is active, safely on both the server and the browser.
//
// IMPORTANT: Bun's dev server does NOT inline `process.env.*` into the client
// bundle (only `bun build` does), so the browser must not touch `process`. On
// the client we read the letter name from a <meta name="x-letter"> tag that the
// server injects into the generated HTML; on the server we read the env var.

export function activeLetterName() {
  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="x-letter"]');
    if (meta?.content) return meta.content;
  }
  if (typeof process !== "undefined" && process.env && process.env.LETTER_CONFIG) {
    return process.env.LETTER_CONFIG;
  }
  return "gehaltsdeckel";
}

// The page language in the browser (the server renders it into <html lang>).
// On the server there is no page, so this returns null.
export function activePageLang() {
  if (typeof document !== "undefined") {
    return document.documentElement.lang || null;
  }
  return null;
}
