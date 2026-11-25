import { beforeEach, describe, expect, test } from "bun:test";
import { db, resetDb, addVerifiedSigner, isoAgoDays } from "./helpers.js";
import * as q from "../server/db.js";

beforeEach(resetDb);

describe("merging spelling variants", () => {
  const signerWith = async (kreisverband, state, extra = {}) =>
    addVerifiedSigner({ kreisverband, state, ...extra });
  const row = (id) =>
    db
      .query("SELECT kreisverband, state, occupation FROM signers WHERE id = ?")
      .get(id);

  test("a Kreisverband merge can be taken back, each signature getting its own state again", async () => {
    const bavarian = await signerWith("Muenchen", "Bayern");
    const unresolved = await signerWith("Muenchen", "");
    const edited = await signerWith("Muenchen", "Bayern");
    const target = await signerWith("München", "Bayern");

    const merged = await q.mergeKreisverband("Muenchen", "München");
    expect(merged).toMatchObject({ updated: 3 });
    expect(await row(bavarian.id)).toMatchObject({
      kreisverband: "München",
      state: "",
    });
    // Someone corrects their own entry in the meantime.
    await db
      .query("UPDATE signers SET kreisverband = 'Augsburg' WHERE id = ?")
      .run(edited.id);

    expect(await q.undoMerge(merged.undoId)).toEqual({
      kind: "kreisverband",
      restored: 2,
    });
    expect(await row(bavarian.id)).toMatchObject({
      kreisverband: "Muenchen",
      state: "Bayern",
    });
    expect(await row(unresolved.id)).toMatchObject({
      kreisverband: "Muenchen",
      state: "",
    });
    expect((await row(edited.id)).kreisverband).toBe("Augsburg");
    expect(await row(target.id)).toMatchObject({
      kreisverband: "München",
      state: "Bayern",
    });
    expect(await q.undoMerge(merged.undoId)).toBe("undone");
    expect(await q.undoMerge(merged.undoId + 100)).toBeNull();
  });

  test("taking a Kreisverband merge back keeps a state set since", async () => {
    const signer = await signerWith("Muenchen", "Bayern");
    const merged = await q.mergeKreisverband("Muenchen", "München");
    await db
      .query("UPDATE signers SET state = 'Berlin' WHERE id = ?")
      .run(signer.id);

    await q.undoMerge(merged.undoId);
    expect(await row(signer.id)).toMatchObject({
      kreisverband: "Muenchen",
      state: "Berlin",
    });
  });

  test("taking an older state assignment back keeps a newer one", async () => {
    const first = await signerWith("Musterkreis", "");
    const sachsen = await q.assignKvState("Musterkreis", "Sachsen");
    const second = await signerWith("Musterkreis", "");
    await q.assignKvState("Musterkreis", "Hessen");

    await q.undoMerge(sachsen.undoId);
    expect((await row(first.id)).state).toBe("");
    expect((await row(second.id)).state).toBe("Hessen");
    expect(
      await db
        .query(
          "SELECT state, source FROM kv_state_cache WHERE kreisverband = 'Musterkreis'",
        )
        .get(),
    ).toEqual({ state: "Hessen", source: "manual" });
  });

  test("an occupation merge that changes nothing leaves nothing to take back", async () => {
    expect(await q.mergeOccupation("Nobody", "Somebody")).toEqual({
      updated: 0,
      undoId: null,
    });
  });

  test("assigning a state can be taken back, including what later sign-ups would get", async () => {
    const open = await signerWith("Musterkreis", "");
    const resolved = await signerWith("Musterkreis", "Hessen");
    const cache = async () =>
      (await db
        .query(
          "SELECT state, source FROM kv_state_cache WHERE kreisverband = 'Musterkreis'",
        )
        .get()) ?? null;

    const first = await q.assignKvState("Musterkreis", "Sachsen");
    expect(first.updated).toBe(1);
    expect((await row(open.id)).state).toBe("Sachsen");
    expect((await row(resolved.id)).state).toBe("Hessen");
    expect(await cache()).toEqual({ state: "Sachsen", source: "manual" });

    expect(await q.undoMerge(first.undoId)).toEqual({
      kind: "state",
      restored: 1,
    });
    expect((await row(open.id)).state).toBe("");
    expect(await cache()).toBeNull();

    // With an earlier answer in the cache, that answer comes back.
    await q.upsertKvStateCache("Musterkreis", "Hessen", "nominatim");
    const second = await q.assignKvState("Musterkreis", "Sachsen");
    await q.undoMerge(second.undoId);
    expect(await cache()).toEqual({ state: "Hessen", source: "nominatim" });
  });

  test("merge records are dropped once the undo period is over", async () => {
    await signerWith("", "", { occupation: "Lehrerin" });
    const { undoId } = await q.mergeOccupation("Lehrerin", "Lehrer*in");
    expect(await q.deleteExpiredMerges()).toBe(0);
    await db
      .query("UPDATE admin_merges SET created_at = ? WHERE id = ?")
      .run(isoAgoDays(31), undoId);
    expect(await q.deleteExpiredMerges()).toBe(1);
    expect(await q.undoMerge(undoId)).toBeNull();
  });
});
