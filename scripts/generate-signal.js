#!/usr/bin/env bun
/**
 * Screenshot the hero headline and fit it into square Signal group avatars.
 *
 * Produces three 1024x1024 variants in public/:
 *   - signal-beige.png  full logo on the site beige background
 *   - signal-white.png  full logo on white
 *   - signal-red.png    red fill, white "Gehalt deckeln." + light "Jetzt."
 *
 * Usage:
 *   bun scripts/generate-signal.js                              # dev server (port 3002)
 *   bun scripts/generate-signal.js https://gehaltsdeckel.jetzt  # production
 *
 * Requires `puppeteer` (installed automatically on first run).
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PUBLIC = resolve(ROOT, "public");

const SIZE = 1024; // square output, px
const SCALE = 2; // render at 2x for crispness
const VIEWPORT_W = 1440;

const TARGET = process.argv[2] || "http://localhost:3002";

// ---- Ensure puppeteer is available ----
let puppeteer;
try {
  puppeteer = await import("puppeteer");
} catch {
  console.log("Installing puppeteer...");
  const proc = Bun.spawn(["bun", "add", "--dev", "puppeteer"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
  puppeteer = await import("puppeteer");
}

mkdirSync(PUBLIC, { recursive: true });

console.log(`Capturing headline from ${TARGET}`);

const browser = await puppeteer.default.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

// Composite a headline screenshot onto a centered square canvas.
// fillRatio = fraction of the canvas the logo's longest side should span.
async function compose(page, shotBase64, bg, fillRatio) {
  return page.evaluate(
    async (imgBase64, size, scale, bgColor, ratio) => {
      const canvas = document.createElement("canvas");
      canvas.width = size * scale;
      canvas.height = size * scale;
      const ctx = canvas.getContext("2d");

      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = `data:image/png;base64,${imgBase64}`;
      });

      // Scale so the logo's largest dimension hits ratio * canvas, centered.
      const maxSide = canvas.width * ratio;
      const fit = Math.min(maxSide / img.naturalWidth, maxSide / img.naturalHeight);
      const dstW = Math.round(img.naturalWidth * fit);
      const dstH = Math.round(img.naturalHeight * fit);
      const dx = Math.round((canvas.width - dstW) / 2);
      const dy = Math.round((canvas.height - dstH) / 2);
      ctx.drawImage(img, dx, dy, dstW, dstH);

      return canvas.toDataURL("image/png").split(",")[1];
    },
    shotBase64,
    SIZE,
    SCALE,
    bg,
    fillRatio,
  );
}

function write(name, base64) {
  const out = resolve(PUBLIC, name);
  writeFileSync(out, Buffer.from(base64, "base64"));
  const kb = (statSync(out).size / 1024).toFixed(1);
  console.log(`Wrote ${out} (${kb} KB)`);
}

try {
  const page = await browser.newPage();
  await page.setViewport({
    width: VIEWPORT_W,
    height: 1200,
    deviceScaleFactor: SCALE,
  });

  await page.goto(TARGET, { waitUntil: "networkidle2", timeout: 15_000 });
  await page.waitForSelector(".headline", { timeout: 10_000 });
  // Let Work Sans (900 + 300) load
  await new Promise((r) => setTimeout(r, 1500));

  if (!(await page.$(".headline"))) {
    console.error("Could not find .headline element");
    process.exit(1);
  }

  // Shrink the headline box to its content (drop the max-width:14ch trailing
  // whitespace) so it crops tight and centers correctly.
  await page.evaluate(() => {
    const h = document.querySelector(".headline");
    h.style.maxWidth = "none";
    h.style.width = "max-content";
    h.style.margin = "0";
    h.style.padding = "0.08em 0.05em"; // breathing room around glyphs
  });
  await new Promise((r) => setTimeout(r, 150));

  // Capture the headline with a given background painted on the element itself
  // (omitBackground can't strip the page's explicit beige fill).
  async function capture(bg) {
    await page.evaluate((color) => {
      document.querySelector(".headline").style.background = color;
    }, bg);
    await new Promise((r) => setTimeout(r, 80));
    const el = await page.$(".headline");
    return Buffer.from(await el.screenshot({ type: "png" })).toString("base64");
  }

  // ---- Variants with default styling (red banners) ----
  write("signal-beige.png", await compose(page, await capture("#f4f1ec"), "#f4f1ec", 0.78));
  write("signal-white.png", await compose(page, await capture("#ffffff"), "#ffffff", 0.78));

  // ---- Red variant: red fill, transparent banners, all-white text ----
  await page.evaluate(() => {
    const h = document.querySelector(".headline");
    h.style.color = "#ffffff";
    h.querySelectorAll(".banner").forEach((b) => {
      b.style.background = "transparent";
      b.style.color = "#ffffff";
      b.style.padding = "0";
    });
  });
  await new Promise((r) => setTimeout(r, 150));

  write("signal-red.png", await compose(page, await capture("#ff0000"), "#ff0000", 0.82));
} finally {
  await browser.close();
}
