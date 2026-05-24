#!/usr/bin/env bun
/**
 * Screenshot the hero section and fit it into a 1200x630 OG image.
 *
 * Usage:
 *   bun scripts/generate-og.js                                 # dev server
 *   bun scripts/generate-og.js https://gehaltsdeckel.jetzt     # production
 *
 * Requires `puppeteer` (installed automatically on first run).
 * Output: public/og.png
 */
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = resolve(ROOT, "public/og.png");

const OG_W = 1200;
const OG_H = 630;
const SCALE = 2;
// Wider viewport → hero-row grid fits side-by-side at a shorter height
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

mkdirSync(dirname(OUT), { recursive: true });

console.log(`Capturing hero from ${TARGET}`);

const browser = await puppeteer.default.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const page = await browser.newPage();

  await page.setViewport({
    width: VIEWPORT_W,
    height: 1200,
    deviceScaleFactor: SCALE,
  });

  await page.goto(TARGET, { waitUntil: "networkidle2", timeout: 15_000 });
  await page.waitForSelector(".hero", { timeout: 10_000 });

  // Let fonts load and counter animate
  await new Promise((r) => setTimeout(r, 1500));

  // Hide the border-bottom so it doesn't show in the screenshot
  await page.evaluate(() => {
    const hero = document.querySelector(".hero");
    if (hero) hero.style.borderBottom = "none";
  });

  // Screenshot the full hero element
  const hero = await page.$(".hero");
  if (!hero) {
    console.error("Could not find .hero element");
    process.exit(1);
  }

  const heroShot = await hero.screenshot({ type: "png" });

  // Composite: scale hero to fill OG canvas, preserving aspect ratio
  const result = await page.evaluate(
    async (imgBase64, ogW, ogH, scale) => {
      const canvas = document.createElement("canvas");
      canvas.width = ogW * scale;
      canvas.height = ogH * scale;
      const ctx = canvas.getContext("2d");

      // Fill with site background
      const bg =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--fond")
          .trim() || "#f4f1ec";
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Load hero screenshot
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = `data:image/png;base64,${imgBase64}`;
      });

      // Scale to fill width, crop height if needed (cover mode)
      const srcW = img.naturalWidth;
      const srcH = img.naturalHeight;
      const fitScale = canvas.width / srcW;
      const dstW = canvas.width;
      const dstH = Math.round(srcH * fitScale);

      // Align to top
      ctx.drawImage(img, 0, 0, dstW, dstH);

      return canvas.toDataURL("image/png").split(",")[1];
    },
    Buffer.from(heroShot).toString("base64"),
    OG_W,
    OG_H,
    SCALE,
  );

  writeFileSync(OUT, Buffer.from(result, "base64"));

  const size = statSync(OUT).size;
  console.log(`Wrote ${OUT} (${(size / 1024).toFixed(1)} KB)`);
} finally {
  await browser.close();
}
