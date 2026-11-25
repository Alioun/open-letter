#!/usr/bin/env bun
/**
 * Draw the example letter's placeholder hero artwork in its theme colours.
 *
 * Usage:
 *   bun scripts/generate-artwork.js
 *
 * Output: public/example-artwork.webp (800x1000), used by hero.artwork in
 * config/letters/example/index.js. Replace it with your own image for a real
 * letter; public/ refuses SVG, so the drawing is rasterised here.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import example from "../config/letters/example/index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/example-artwork.webp");
const W = 800;
const H = 1000;
const c = example.theme.colors;

const grid = [];
for (let x = 40; x < W; x += 40)
  grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`);
for (let y = 40; y < H; y += 40)
  grid.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`);

// Crop marks in the corners, as on a layout proof.
const m = 48;
const l = 56;
const marks = [
  [m, m, 1, 1],
  [W - m, m, -1, 1],
  [m, H - m, 1, -1],
  [W - m, H - m, -1, -1],
]
  .map(
    ([x, y, dx, dy]) =>
      `<path d="M${x} ${y + dy * l}V${y}H${x + dx * l}"/>`,
  )
  .join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${c.fond}"/>
  <g stroke="${c.grauHell}" stroke-width="2">${grid.join("")}</g>
  <g stroke="${c.akzent}" stroke-opacity="0.18" stroke-width="3">
    <line x1="0" y1="0" x2="${W}" y2="${H}"/>
    <line x1="${W}" y1="0" x2="0" y2="${H}"/>
  </g>
  <circle cx="520" cy="330" r="190" fill="${c.rot}"/>
  <rect x="150" y="430" width="300" height="300" rx="24" fill="${c.akzent}" transform="rotate(8 300 580)"/>
  <rect x="456" y="626" width="220" height="140" rx="16" fill="${c.rot}"/>
  <rect x="440" y="610" width="220" height="140" rx="16" fill="${c.weiss}" stroke="${c.akzent}" stroke-width="4"/>
  <circle cx="230" cy="260" r="44" fill="none" stroke="${c.rotText}" stroke-width="12"/>
  <g stroke="${c.akzent}" stroke-width="6" fill="none">${marks}</g>
</svg>`;

const info = await sharp(Buffer.from(svg))
  .webp({ quality: 90, effort: 6 })
  .toFile(OUT);
console.log(`Wrote ${OUT} (${info.width}x${info.height}, ${info.size} bytes)`);
