import { beforeEach, afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { openEncrypted, DB_PATH } from "../db/connection.js";
import { resetDb } from "./helpers.js";
import {
  createPublicationStore,
  initialDocument,
  configFromDocument,
} from "../server/publications.js";
import { createAssetLifecycle } from "../server/asset-lifecycle.js";
import { generateOg, assetPath, storeAsset } from "../server/assets.js";
import { LANGUAGES, LETTER_NAME } from "../config/letter.config.js";

let connection;
beforeEach(async () => {
  await resetDb();
  connection = await openEncrypted(DB_PATH);
  await connection.run(
    readFileSync(new URL("../db/publishing.sql", import.meta.url), "utf8"),
  );
  await connection.run(
    "DELETE FROM publications; DELETE FROM publication_assets;",
  );
});
afterEach(async () => {
  await connection.close();
});

function productionPrepare() {
  const source = readFileSync(
    new URL("../server/index.js", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async prepare(document, { mode }) {");
  const end = source.indexOf("\n  onSwap(snapshot) {", start);
  if (start < 0 || end < 0)
    throw new Error("Production preparation callback missing");
  const method = source.slice(start, end).trim().replace(/,$/, "");
  const dependencies = {
    LANGUAGES,
    LETTER_NAME,
    configFromDocument,
    generateOg,
    assetPath,
    emailManager: { facts: {} },
    BASE_URL: "https://publication.invalid",
    documentHtml: () => "<!doctype html><html></html>",
    frontend: { entries: {} },
  };
  return new Function(
    ...Object.keys(dependencies),
    `return ({${method}}).prepare;`,
  )(...Object.values(dependencies));
}

function asset(label, length = 64) {
  const bytes = Buffer.alloc(length, label);
  return {
    hash: createHash("sha256").update(bytes).digest("hex"),
    bytes,
    mime: "image/png",
    width: 16,
    height: 16,
  };
}

function newsletter(id, slug) {
  return {
    id,
    slug,
    name: slug,
    subject: "Update",
    html_body: "<p>{{unsubscribeUrl}}</p>",
  };
}

test("production previews keep generated images inline and add no persistent asset rows", async () => {
  const store = await createPublicationStore(connection, {
    prepare: productionPrepare(),
  });
  await store.load(initialDocument());
  const before = await connection
    .query(
      "SELECT COUNT(*) AS count,SUM(length(bytes)) AS bytes FROM publication_assets",
    )
    .get();
  for (let index = 0; index < 6; index++) {
    const draft = structuredClone(store.current.document);
    draft.metadata[LANGUAGES[0]].imageText = `Unpublished image ${index}`;
    const preview = await store.preview(draft);
    expect(preview.configs[LANGUAGES[0]].meta.ogImage).toStartWith(
      "data:image/png;base64,",
    );
  }
  expect(
    await connection
      .query(
        "SELECT COUNT(*) AS count,SUM(length(bytes)) AS bytes FROM publication_assets",
      )
      .get(),
  ).toEqual(before);
  expect(store.current.revision).toBe(1);
  const next = structuredClone(store.current.document);
  next.metadata[LANGUAGES[0]].imageText = "Failed publication image";
  await connection.run(
    "CREATE TRIGGER reject_image_publication BEFORE INSERT ON publications BEGIN SELECT RAISE(ABORT,'publication rejected'); END;",
  );
  try {
    await expect(store.publish(next, 1)).rejects.toThrow(
      "publication rejected",
    );
  } finally {
    await connection.run("DROP TRIGGER reject_image_publication");
  }
  expect(
    await connection
      .query(
        "SELECT COUNT(*) AS count,SUM(length(bytes)) AS bytes FROM publication_assets",
      )
      .get(),
  ).toEqual(before);
});

test("retired catalog templates keep completed campaigns and cannot have their identities reused", async () => {
  const store = await createPublicationStore(connection);
  await store.load(initialDocument([newsletter(1, "newsletter-first")]));
  const next = structuredClone(store.current.document);
  next.templates.push(newsletter(2, "newsletter-historic"));
  await store.publish(next, 1);
  await connection
    .query(
      "INSERT INTO campaigns(template_id,subject,scheduled_at,sent_at,status) VALUES (2,'History',?,?, 'sent')",
    )
    .run("2026-01-01", "2026-01-01");
  await store.publish(await store.previous(), 2);
  expect(
    store.current.document.templates.map((template) => template.id),
  ).toEqual([1]);
  expect(
    await connection
      .query(
        "SELECT t.slug,c.status FROM campaigns c JOIN email_templates t ON t.id=c.template_id",
      )
      .get(),
  ).toEqual({ slug: "newsletter-historic", status: "sent" });
  expect(await store.nextTemplateId()).toBe(3);
  const reused = structuredClone(store.current.document);
  reused.templates.push(newsletter(2, "newsletter-reused"));
  await expect(store.publish(reused, 3)).rejects.toThrow(
    "including retired templates",
  );
  reused.templates.at(-1).id = 3;
  reused.templates.at(-1).slug = "newsletter-historic";
  await expect(store.publish(reused, 3)).rejects.toThrow(
    "including retired templates",
  );
  const restarted = await createPublicationStore(connection);
  await restarted.load(initialDocument());
  expect(restarted.current.document.templates).toHaveLength(1);
  expect(await restarted.nextTemplateId()).toBe(3);
});

test("assets retain current and previous references, expire draft uploads and bound cache and draft storage", async () => {
  let now = 10000;
  const lifecycle = await createAssetLifecycle(connection, {
    clock: () => now,
    draftGraceMs: 1000,
    draftEntries: 2,
    draftBytes: 128,
    cacheEntries: 1,
    cacheBytes: 80,
  });
  const first = asset(1);
  const second = asset(2);
  const third = asset(3);
  const store = await createPublicationStore(connection, { assets: lifecycle });
  const doc = initialDocument();
  doc.assets.push(await lifecycle.upload(first));
  await store.load(doc);
  const next = structuredClone(store.current.document);
  next.assets = [await lifecycle.upload(second)];
  await store.publish(next, 1);
  now += 1100;
  await lifecycle.sweep();
  expect(await lifecycle.get(assetPath(first.hash))).not.toBeNull();
  expect(await lifecycle.get(assetPath(second.hash))).not.toBeNull();
  expect(lifecycle.cacheUsage).toEqual({ entries: 1, bytes: 64 });
  const last = structuredClone(store.current.document);
  last.assets = [await lifecycle.upload(third)];
  await store.publish(last, 2);
  expect(await lifecycle.get(assetPath(first.hash))).toBeNull();
  expect(await lifecycle.get(assetPath(second.hash))).not.toBeNull();
  expect(await lifecycle.get(assetPath(third.hash))).not.toBeNull();
  for (let index = 4; index < 9; index++) {
    now++;
    await lifecycle.upload(asset(index));
  }
  expect(
    (
      await connection
        .query("SELECT COUNT(*) AS count FROM publication_assets")
        .get()
    ).count,
  ).toBe(4);
  expect(await lifecycle.get(assetPath(asset(4).hash))).toBeNull();
  expect(await lifecycle.get(assetPath(asset(8).hash))).not.toBeNull();
  now += 1100;
  expect(await lifecycle.get(assetPath(asset(8).hash))).toBeNull();
  await lifecycle.sweep();
  expect(
    (
      await connection
        .query("SELECT COUNT(*) AS count FROM publication_assets")
        .get()
    ).count,
  ).toBe(2);
});

test("concurrent sweeps see only committed generated images while publication prepares", async () => {
  let release;
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let wait = false;
  const image = asset(20);
  const lifecycle = await createAssetLifecycle(connection);
  const store = await createPublicationStore(connection, {
    assets: lifecycle,
    prepare: async () => {
      if (wait) {
        entered();
        await held;
      }
      return { generatedAssets: [wait ? asset(22) : image] };
    },
  });
  await store.load(initialDocument());
  const upload = asset(21);
  const draft = structuredClone(store.current.document);
  draft.assets.push(await lifecycle.upload(upload));
  wait = true;
  const pending = store.publish(draft, 1);
  await started;
  await lifecycle.sweep();
  expect(await lifecycle.get(assetPath(image.hash))).not.toBeNull();
  expect(await lifecycle.get(assetPath(asset(22).hash))).toBeNull();
  release();
  await pending;
  expect(await lifecycle.get(assetPath(upload.hash))).not.toBeNull();
  expect(await lifecycle.get(assetPath(asset(22).hash))).not.toBeNull();
});

test("reference-write failure rolls generated bytes back with the publication", async () => {
  const store = await createPublicationStore(connection, {
    prepare: async (doc) => ({
      generatedAssets: [asset(doc.metadata[LANGUAGES[0]].imageText ? 31 : 30)],
    }),
  });
  await store.load(initialDocument());
  const next = structuredClone(store.current.document);
  next.metadata[LANGUAGES[0]].imageText = "Second image";
  await connection.run(
    "CREATE TRIGGER reject_asset_reference BEFORE INSERT ON publication_asset_references WHEN NEW.revision=2 BEGIN SELECT RAISE(ABORT,'reference rejected'); END;",
  );
  try {
    await expect(store.publish(next, 1)).rejects.toThrow("reference rejected");
  } finally {
    await connection.run("DROP TRIGGER reject_asset_reference");
  }
  expect(store.current.revision).toBe(1);
  expect(
    await connection
      .query("SELECT hash FROM publication_assets WHERE hash=?")
      .get(asset(31).hash),
  ).toBeUndefined();
  expect(await store.assets.get(assetPath(asset(30).hash))).not.toBeNull();
});

test("archived editorial image references survive active catalog removal and upload expiry", async () => {
  let now = 1000;
  const lifecycle = await createAssetLifecycle(connection, {
    clock: () => now,
    draftGraceMs: 100,
  });
  const path = await lifecycle.upload(asset(40));
  const store = await createPublicationStore(connection, { assets: lifecycle });
  const doc = initialDocument();
  doc.assets = [];
  doc.archive = {
    locales: {
      fr: { copy: {}, blocks: { picture: { src: path } }, metadata: {} },
    },
    fields: {},
  };
  await store.load(doc);
  now += 200;
  await lifecycle.sweep();
  expect(await lifecycle.get(path)).not.toBeNull();
  const restarted = await createPublicationStore(connection, {
    assets: lifecycle,
  });
  await restarted.load(initialDocument());
  expect(restarted.current.document.archive.locales.fr.blocks.picture.src).toBe(
    path,
  );
  expect(await lifecycle.get(path)).not.toBeNull();
});

test("draft and serving cache byte limits apply before their entry limits", async () => {
  let now = 1000;
  const lifecycle = await createAssetLifecycle(connection, {
    clock: () => ++now,
    cacheEntries: 10,
    cacheBytes: 100,
    draftEntries: 10,
    draftBytes: 200,
  });
  const first = await lifecycle.upload(asset(50, 80));
  const second = await lifecycle.upload(asset(51, 80));
  expect(await lifecycle.get(first)).not.toBeNull();
  expect(await lifecycle.get(second)).not.toBeNull();
  expect(lifecycle.cacheUsage).toEqual({ entries: 1, bytes: 80 });
  const large = await lifecycle.upload(asset(52, 160));
  expect(await lifecycle.get(first)).toBeNull();
  expect(await lifecycle.get(second)).toBeNull();
  expect((await lifecycle.get(large)).bytes.length).toBe(160);
  expect(lifecycle.cacheUsage).toEqual({ entries: 0, bytes: 0 });
  expect(
    (
      await connection
        .query("SELECT COUNT(*) AS count FROM publication_assets")
        .get()
    ).count,
  ).toBe(1);
});

test("legacy uploads receive a bounded grace period on upgrade", async () => {
  await connection.run("DROP TABLE IF EXISTS publication_asset_lifetimes");
  const legacy = asset(61);
  await storeAsset(connection, legacy);
  let now = 5000;
  const lifecycle = await createAssetLifecycle(connection, {
    clock: () => now,
    draftGraceMs: 1000,
  });
  await lifecycle.sweep();
  expect(await lifecycle.get(assetPath(legacy.hash))).not.toBeNull();
  now += 1001;
  await lifecycle.sweep();
  expect(await lifecycle.get(assetPath(legacy.hash))).toBeNull();
});

test("a warm image cache cannot extend an unpublished upload's lifetime", async () => {
  let now = 5000;
  const lifecycle = await createAssetLifecycle(connection, {
    clock: () => now,
    draftGraceMs: 1000,
  });
  const path = await lifecycle.upload(asset(62));
  expect(await lifecycle.get(path)).not.toBeNull();
  expect(await lifecycle.get(path)).not.toBeNull();
  now += 1001;
  expect(await lifecycle.get(path)).toBeNull();
});
