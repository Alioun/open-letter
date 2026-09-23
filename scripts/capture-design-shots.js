#!/usr/bin/env bun
/**
 * Capture full-section screenshots of the live site for the design deck.
 *
 * Usage:
 *   bun scripts/capture-design-shots.js                              # production
 *   bun scripts/capture-design-shots.js http://localhost:3002        # local dev
 *
 * Requires `puppeteer` (a devDependency). Output: design-export/shots/*.png
 */
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, "design-export/shots");

const SCALE = 2;
const VIEWPORT_W = 1440;
const TARGET = process.argv[2] || "https://gehaltsdeckel.jetzt";

// Sections to capture: selector -> output name. `maxH` clips very tall
// sections to a representative top region so the slide image stays legible.
const TARGETS = [
  { sel: ".hero", name: "hero" },
  { sel: "#brief", name: "brief", maxH: 1400 },
  { sel: "#unterzeichnen", name: "unterzeichnen" },
  { sel: "#liste", name: "liste", maxH: 1400 },
  { sel: "#zoom", name: "zoom" },
];

mkdirSync(OUT_DIR, { recursive: true });

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

console.log(`Capturing design shots from ${TARGET}`);

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

  await page.goto(TARGET, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".hero", { timeout: 10_000 });

  // Let fonts load and the counter animate.
  await new Promise((r) => setTimeout(r, 1800));

  for (const { sel, name, maxH } of TARGETS) {
    const el = await page.$(sel);
    if (!el) {
      console.warn(`  ! skipped ${name}: selector not found: ${sel}`);
      continue;
    }
    await el.scrollIntoView();
    await new Promise((r) => setTimeout(r, 400));

    const out = resolve(OUT_DIR, `${name}.png`);
    let opts = { type: "png" };

    if (maxH) {
      const box = await el.boundingBox();
      if (box && box.height > maxH) {
        opts = {
          type: "png",
          clip: { x: box.x, y: box.y, width: box.width, height: maxH },
        };
      }
    }

    const shot =
      opts.clip != null
        ? await page.screenshot(opts)
        : await el.screenshot(opts);
    writeFileSync(out, shot);
    const kb = (statSync(out).size / 1024).toFixed(1);
    console.log(`  ✓ ${name}.png (${kb} KB)`);
  }
} finally {
  await browser.close();
}

console.log(`Done → ${OUT_DIR}`);
