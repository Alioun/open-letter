// Images in public/ at the site root, such as /og.png or a letter's
// hero.artwork.src. Only files directly in the folder: the name may not
// contain a slash or start with a dot, and a symlink is not followed.
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

// SVG is left out on purpose: opened on its own, it can run script on the
// site's origin.
const IMAGE_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
  ["gif", "image/gif"],
]);

export async function publicFile(pathname, dir = PUBLIC_DIR) {
  const match = /^\/([A-Za-z0-9][\w.-]*\.([A-Za-z0-9]+))$/.exec(pathname);
  const type = match && IMAGE_TYPES.get(match[2].toLowerCase());
  if (!type) return null;
  const path = join(dir, match[1]);
  const stat = await lstat(path).catch(() => null);
  if (!stat?.isFile()) return null;
  return new Response(Bun.file(path), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
