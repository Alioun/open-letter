import { ValidationError } from "../config/validation.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import satori from "satori";

export function assetPath(hash) {
  return `/assets/${hash}.png`;
}

export function publicationAssetPaths(document) {
  const paths = new Set(document.assets);
  function visit(value) {
    if (typeof value === "string") {
      for (const match of value.matchAll(/\/assets\/[a-f0-9]{64}\.png/g))
        paths.add(match[0]);
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) visit(item);
    }
  }
  visit(document.archive);
  return [...paths];
}

export async function normalizeImage(bytes) {
  if (bytes.length > 8 * 1024 * 1024)
    throw new ValidationError("Images must be at most 8 MB");
  const image = sharp(bytes, { limitInputPixels: 16000000, animated: false });
  let meta;
  try {
    meta = await image.metadata();
  } catch {
    throw new ValidationError("Use a valid PNG, JPEG or WebP image");
  }
  if (
    !["png", "jpeg", "webp"].includes(meta.format) ||
    meta.pages > 1 ||
    meta.width < 16 ||
    meta.height < 16 ||
    meta.width > 8000 ||
    meta.height > 8000
  )
    throw new ValidationError(
      "Use a PNG, JPEG or WebP between 16 and 8000 pixels (16 megapixels maximum)",
    );
  const result = await image
    .rotate()
    .resize({
      width: 2400,
      height: 2400,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    hash: createHash("sha256").update(result.data).digest("hex"),
    mime: "image/png",
    bytes: result.data,
    width: result.info.width,
    height: result.info.height,
  };
}

let font;
export async function generateOg(config, text) {
  font ??= readFileSync(
    new URL(
      "../node_modules/@fontsource/work-sans/files/work-sans-latin-700-normal.woff",
      import.meta.url,
    ),
  );
  const title = text || config.hero.headlineLines.map((l) => l.text).join(" ");
  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: 64,
          background: config.theme.colors.fond,
          color: config.theme.colors.akzent,
          fontFamily: "Campaign",
          fontWeight: 700,
        },
        children: [
          {
            type: "div",
            props: { style: { fontSize: 32 }, children: config.brand.wordmark },
          },
          {
            type: "div",
            props: {
              style: {
                fontSize: title.length > 90 ? 54 : 76,
                lineHeight: 1.15,
                color: config.theme.colors.rot,
              },
              children: title.slice(0, 240),
            },
          },
          {
            type: "div",
            props: {
              style: { fontSize: 28 },
              children: config.hero.ctaPrimary,
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: [{ name: "Campaign", data: font, weight: 700 }],
    },
  );
  return normalizeImage(await sharp(Buffer.from(svg)).png().toBuffer());
}

export async function storeAsset(connection, asset) {
  await connection
    .query(
      "INSERT INTO publication_assets /* public-neutral */ (hash,mime,bytes,width,height) VALUES (?,?,?,?,?) ON CONFLICT(hash) DO NOTHING",
    )
    .run(asset.hash, asset.mime, asset.bytes, asset.width, asset.height);
  return assetPath(asset.hash);
}
