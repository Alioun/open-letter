import { assetPath, publicationAssetPaths, storeAsset } from "./assets.js";

const MiB = 1024 * 1024;
const HASH_PATH = /^\/assets\/([a-f0-9]{64})\.png$/;

export async function createAssetLifecycle(
  connection,
  {
    clock = Date.now,
    cacheEntries = 64,
    cacheBytes = 16 * MiB,
    draftGraceMs = 24 * 60 * 60 * 1000,
    draftEntries = 64,
    draftBytes = 32 * MiB,
  } = {},
) {
  await connection.run(`
    CREATE TABLE IF NOT EXISTS publication_asset_lifetimes (
      hash TEXT PRIMARY KEY REFERENCES publication_assets(hash) ON DELETE CASCADE,
      uploaded_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS publication_asset_references (
      revision INTEGER NOT NULL REFERENCES publications(revision) ON DELETE CASCADE,
      hash TEXT NOT NULL REFERENCES publication_assets(hash) ON DELETE CASCADE,
      PRIMARY KEY (revision, hash)
    );
  `);
  await connection
    .query(
      `
    INSERT INTO publication_asset_lifetimes /* public-neutral */ (hash,uploaded_at)
    SELECT hash,? FROM publication_assets WHERE true ON CONFLICT(hash) DO NOTHING
  `,
    )
    .run(clock());
  const cache = new Map();
  let cachedBytes = 0;

  function forget(path) {
    const previous = cache.get(path);
    if (!previous) return;
    cachedBytes -= previous.bytes.length;
    cache.delete(path);
  }

  function remember(path, asset) {
    forget(path);
    if (asset.bytes.length > cacheBytes || cacheEntries < 1) return;
    cache.set(path, asset);
    cachedBytes += asset.bytes.length;
    while (cache.size > cacheEntries || cachedBytes > cacheBytes)
      forget(cache.keys().next().value);
  }

  const reachable = `
    EXISTS (SELECT 1 FROM publication_asset_references r
      JOIN publications p ON p.revision=r.revision
      WHERE r.hash=a.hash AND p.revision IN
        (SELECT revision FROM publications ORDER BY revision DESC LIMIT 2))
    OR EXISTS (SELECT 1 FROM publication_asset_lifetimes l
      WHERE l.hash=a.hash AND l.uploaded_at >= ?)`;

  async function retain(writer, revision, document, generatedAssets = []) {
    for (const asset of generatedAssets) {
      await storeAsset(writer, asset);
      await writer
        .query(
          `
        INSERT INTO publication_asset_lifetimes /* public-neutral */ (hash,uploaded_at)
        VALUES (?,NULL) ON CONFLICT(hash) DO NOTHING
      `,
        )
        .run(asset.hash);
    }
    await writer
      .query(
        "DELETE FROM publication_asset_references /* public-neutral */ WHERE revision=?",
      )
      .run(revision);
    const paths = new Set([
      ...publicationAssetPaths(document),
      ...generatedAssets.map((asset) => assetPath(asset.hash)),
    ]);
    for (const path of paths) {
      const hash = HASH_PATH.exec(path)?.[1];
      if (!hash) throw new Error("Invalid publication asset reference");
      await writer
        .query(
          "INSERT INTO publication_asset_references /* public-neutral */ (revision,hash) VALUES (?,?)",
        )
        .run(revision, hash);
    }
  }

  async function collect(writer = connection) {
    await writer
      .query(
        `
      DELETE FROM publication_asset_references /* public-neutral */
      WHERE revision NOT IN (SELECT revision FROM publications ORDER BY revision DESC LIMIT 2)
    `,
      )
      .run();
    const drafts = await writer
      .query(
        `
      SELECT a.hash,length(a.bytes) AS size,l.uploaded_at
      FROM publication_assets a
      LEFT JOIN publication_asset_lifetimes l ON l.hash=a.hash
      WHERE NOT EXISTS (SELECT 1 FROM publication_asset_references r WHERE r.hash=a.hash)
      ORDER BY l.uploaded_at DESC,a.hash
    `,
      )
      .all();
    let kept = 0;
    let bytes = 0;
    for (const asset of drafts) {
      if (
        asset.uploaded_at != null &&
        asset.uploaded_at >= clock() - draftGraceMs &&
        kept < draftEntries &&
        bytes + asset.size <= draftBytes
      ) {
        kept++;
        bytes += asset.size;
        continue;
      }
      await writer
        .query(
          "DELETE FROM publication_assets /* public-neutral */ WHERE hash=?",
        )
        .run(asset.hash);
    }
    cache.clear();
    cachedBytes = 0;
  }

  return {
    retain,
    collect,
    async sweep() {
      await connection.transaction(() => collect(), { immediate: true });
    },
    async upload(asset) {
      const path = await connection.transaction(
        async () => {
          await storeAsset(connection, asset);
          await connection
            .query(
              `
          INSERT INTO publication_asset_lifetimes /* public-neutral */ (hash,uploaded_at) VALUES (?,?)
          ON CONFLICT(hash) DO UPDATE SET uploaded_at=excluded.uploaded_at
        `,
            )
            .run(asset.hash, clock());
          await collect();
          return assetPath(asset.hash);
        },
        { immediate: true },
      );
      return path;
    },
    async get(path) {
      const hash = HASH_PATH.exec(path)?.[1];
      if (!hash) return null;
      const row = await connection
        .query(
          `
        SELECT a.hash FROM publication_assets a WHERE a.hash=? AND (${reachable})
      `,
        )
        .get(hash, clock() - draftGraceMs);
      if (!row) {
        forget(path);
        return null;
      }
      const hit = cache.get(path);
      if (hit) {
        remember(path, hit);
        return hit;
      }
      const asset = await connection
        .query("SELECT * FROM publication_assets WHERE hash=?")
        .get(hash);
      if (!asset) return null;
      remember(path, asset);
      return asset;
    },
    get cacheUsage() {
      return { entries: cache.size, bytes: cachedBytes };
    },
  };
}
