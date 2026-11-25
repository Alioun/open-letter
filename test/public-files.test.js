import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicFile } from "../server/public-files.js";

const root = mkdtempSync(join(tmpdir(), "open-letter-public-"));
const dir = join(root, "public");
mkdirSync(join(dir, "nested"), { recursive: true });
writeFileSync(join(dir, "poster.JPG"), "jpeg bytes");
writeFileSync(join(dir, "og.png"), "png bytes");
writeFileSync(join(dir, ".hidden.png"), "hidden");
writeFileSync(join(dir, "notes.txt"), "text");
writeFileSync(join(dir, "drawing.svg"), "<svg/>");
writeFileSync(join(dir, "nested", "inner.png"), "inner");
writeFileSync(join(root, "outside.png"), "outside");
symlinkSync(join(root, "outside.png"), join(dir, "link.png"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("images in public/", () => {
  test("an image directly in the folder is served with its type and cached", async () => {
    const response = await publicFile("/poster.JPG", dir);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("jpeg bytes");
    expect((await publicFile("/og.png", dir)).headers.get("content-type")).toBe(
      "image/png",
    );
  });

  test("nothing else in or near the folder is served", async () => {
    for (const path of [
      "/missing.png",
      "/.hidden.png",
      "/notes.txt",
      "/drawing.svg",
      "/nested/inner.png",
      "/nested",
      "/../outside.png",
      "/..%2Foutside.png",
      "/%2e%2e/outside.png",
      "/link.png",
      "/png",
      "/",
    ])
      expect([path, await publicFile(path, dir)]).toEqual([path, null]);
  });
});
