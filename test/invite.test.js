import { describe, test, expect, beforeEach, beforeAll, afterAll } from "bun:test";
import cfg from "../config/letter.config.js";
import { resetDb, db } from "./helpers.js";
import * as q from "../server/db.js";
import { prepareQueuedEmail } from "../server/queued-email.js";
import { statsDisplay, fillInvite, resolveInvite } from "../config/invite.js";

beforeEach(resetDb);

// The default test letter has invite links off; codes are only issued when on.
const wasOn = cfg.features.inviteLinks;
beforeAll(() => (cfg.features.inviteLinks = true));
afterAll(() => (cfg.features.inviteLinks = wasOn));

const future = () => new Date(Date.now() + 3600_000);

async function signAndConfirm(email, opts = {}) {
  const token = `tok-${email}`;
  await q.insertSigner({
    name: opts.name || "Anna Beispiel",
    email,
    kv: "",
    occupation: "",
    newsletter: false,
    showPublicly: false,
    token,
    expiresAt: future(),
    inviteRef: opts.ref ?? null,
    inviteShowName: opts.showName ?? false,
  });
  if (opts.confirm === false) return null;
  return q.confirmSigner(token);
}

const row = (email) =>
  db
    .query(
      `SELECT invite_code, invite_count, pending_ref, invite_stats_hash, invite_show_name
       FROM signers WHERE email = ?`,
    )
    .get(email);

describe("invite codes", () => {
  test("generated codes are 8 Crockford base32 chars", () => {
    const codes = new Set(Array.from({ length: 500 }, q.generateInviteCode));
    expect(codes.size).toBe(500);
    for (const c of codes) expect(q.isInviteCode(c)).toBe(true);
    expect(q.isInviteCode("abcd")).toBe(false);
    expect(q.isInviteCode("ABCDEFGH")).toBe(false);
    expect(q.isInviteCode("abcdefgi")).toBe(false);
    expect(q.isInviteCode(null)).toBe(false);
  });

  test("only confirmed signers get a code", async () => {
    await signAndConfirm("p@example.org", { confirm: false });
    expect((await row("p@example.org")).invite_code).toBeNull();
    const confirmed = await signAndConfirm("c@example.org");
    expect(q.isInviteCode(confirmed.inviteCode)).toBe(true);
    expect((await row("c@example.org")).invite_code).toBe(confirmed.inviteCode);
  });
});

describe("crediting the inviter", () => {
  test("a confirmed sign-up counts once and leaves no link to the inviter", async () => {
    const inviter = await signAndConfirm("a@example.org");
    await signAndConfirm("b@example.org", { ref: inviter.inviteCode, confirm: false });
    // Pending: not counted yet, ref held only on the unconfirmed row.
    expect((await row("a@example.org")).invite_count).toBe(0);
    expect((await row("b@example.org")).pending_ref).toBe(inviter.inviteCode);

    await q.confirmSigner("tok-b@example.org");
    expect((await row("a@example.org")).invite_count).toBe(1);
    expect((await row("b@example.org")).pending_ref).toBeNull();

    // Confirming again (used token) changes nothing.
    expect(await q.confirmSigner("tok-b@example.org")).toBeNull();
    expect((await row("a@example.org")).invite_count).toBe(1);
  });

  test("an unknown code is ignored", async () => {
    await signAndConfirm("x@example.org", { ref: "zzzzzzzz" });
    expect((await row("x@example.org")).pending_ref).toBeNull();
  });

  test("an unconfirmed inviter isn't credited", async () => {
    await signAndConfirm("u@example.org", { confirm: false });
    await db.query(`UPDATE signers SET invite_code = 'unconf01' WHERE email = ?`).run("u@example.org");
    await signAndConfirm("v@example.org", { ref: "unconf01" });
    expect((await row("u@example.org")).invite_count).toBe(0);
  });
});

describe("invite page and stats", () => {
  test("the first name is shown only with opt-in", async () => {
    const named = await signAndConfirm("n@example.org", { name: "Nora Muster", showName: true });
    const anon = await signAndConfirm("m@example.org", { name: "Max Muster" });
    expect(await q.getInviteByCode(named.inviteCode)).toEqual({ firstName: "Nora" });
    expect(await q.getInviteByCode(anon.inviteCode)).toEqual({ firstName: null });
    expect(await q.getInviteByCode("00000000")).toBeNull();
    expect(await q.getInviteByCode("bad")).toBeNull();
  });

  test("the stats token works only as issued, and a new one replaces it", async () => {
    const s = await signAndConfirm("s@example.org");
    const first = await q.issueInviteStatsToken(s.id);
    expect(first.inviteCode).toBe(s.inviteCode);
    expect((await row("s@example.org")).invite_stats_hash).not.toContain(first.token);
    expect(await q.getInviteStats(s.inviteCode, first.token)).toEqual({ count: 0 });
    expect(await q.getInviteStats(s.inviteCode, "wrong")).toBeNull();

    const second = await q.issueInviteStatsToken(s.id);
    expect(await q.getInviteStats(s.inviteCode, first.token)).toBeNull();
    expect(await q.getInviteStats(s.inviteCode, second.token)).toEqual({ count: 0 });
  });

  test("stats are shown as exact as the letter's statsMode allows", () => {
    const at = (mode, extra = {}) => (n) =>
      statsDisplay(n, { ...resolveInvite({}), statsMode: mode, ...extra });
    const threshold = at("threshold");
    expect(threshold(2)).toEqual({ below: 3 });
    expect(threshold(3)).toEqual({ count: 3 });
    expect(at("exact")(1)).toEqual({ count: 1 });

    const ranges = at("ranges", { statsRanges: [3, 5, 10] });
    expect(ranges(2)).toEqual({ below: 3 });
    expect(ranges(3)).toEqual({ min: 3, max: 4 });
    expect(ranges(9)).toEqual({ min: 5, max: 9 });
    expect(ranges(10)).toEqual({ min: 10 });
    expect(ranges(400)).toEqual({ min: 10 });
    // Defaults to ranges.
    expect(statsDisplay(7, resolveInvite({}))).toEqual({ min: 5, max: 9 });
  });

  test("fillInvite leaves unknown placeholders alone", () => {
    expect(fillInvite("{firstName} lädt zu „{title}“ ein {x}", { firstName: "A", title: "T" })).toBe(
      "A lädt zu „T“ ein {x}",
    );
  });
});

describe("invite mail", () => {
  test("is built with a fresh stats token at send time, only for confirmed signers", async () => {
    const s = await signAndConfirm("mail@example.org");
    const args = await prepareQueuedEmail({ kind: "invite", signerId: s.id, baseUrl: "https://x" });
    expect(args.inviteCode).toBe(s.inviteCode);
    expect(await q.getInviteStats(s.inviteCode, args.statsToken)).toEqual({ count: 0 });

    await signAndConfirm("pend@example.org", { confirm: false });
    const pendingId = await q.getSignerIdByEmail("pend@example.org");
    expect(await prepareQueuedEmail({ kind: "invite", signerId: pendingId, baseUrl: "https://x" })).toBeNull();
  });
});

describe("feature off", () => {
  test("confirming issues no invite code", async () => {
    cfg.features.inviteLinks = false;
    try {
      const s = await signAndConfirm("off@example.org");
      expect(s.inviteCode).toBeNull();
    } finally {
      cfg.features.inviteLinks = true;
    }
  });

  test("the displayed first name is the first word", () => {
    expect(q.inviteDisplayName("  Berger, Anna")).toBe("Berger,");
    expect(q.inviteDisplayName("Nora Muster")).toBe("Nora");
  });
});

describe("withdrawing the name", () => {
  test("the settings update turns the name off and erasure removes everything", async () => {
    const s = await signAndConfirm("w@example.org", { showName: true });
    await q.updateSignerByEmail("w@example.org", {
      name: "Anna Beispiel",
      kreisverband: "",
      occupation: "",
      newsletter: false,
      showPublicly: false,
      inviteShowName: false,
    });
    expect(await q.getInviteByCode(s.inviteCode)).toEqual({ firstName: null });

    // undefined (feature off) leaves the choice as it is.
    await db.query(`UPDATE signers SET invite_show_name = 1 WHERE email = ?`).run("w@example.org");
    await q.updateSignerByEmail("w@example.org", {
      name: "Anna Beispiel",
      kreisverband: "",
      occupation: "",
      newsletter: false,
      showPublicly: false,
    });
    expect((await row("w@example.org")).invite_show_name).toBe(1);

    await q.eraseEmail("w@example.org");
    expect(await q.getInviteByCode(s.inviteCode)).toBeNull();
  });
});
