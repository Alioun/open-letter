// First signers in the admin. A signature has two separate first-signer
// attributes: the mark (signers.first_signer, the public "Erstunterzeichnet"
// label) and a position (first_signer_pins, its place at the top of the
// public list's default view). The team can also add a first signer who
// never signed through the form: a signature without an address, which
// counts like any other and can never be mailed.
//
// The ordered list is replaced as a whole and carries a revision, the hash of
// its order, so two people reordering at once cannot silently overwrite each
// other.
import { createHash, createHmac } from "node:crypto";
import { db, nowIso } from "../db/connection.js";
import {
  forgetDeletedSigners,
  recordAdminAction,
} from "../db/admin-actions.js";
import { emailHmac, erasureSubject } from "../db/email-identity.js";
import { ERASE, HIDE_PUBLICLY, recordErasure } from "../db/erasure-log.js";
import { SIGNER_DETAIL_LIMIT } from "../config/signer-details.js";
import { csvRows } from "./csv.js";
import {
  adminSignersByIds,
  possibleDuplicatesOf,
  isSigningBlocked,
} from "./db.js";

const failure = (status, message, extra = {}) =>
  Object.assign(new Error(message), { status, ...extra });

async function orderedIds() {
  return (
    await db
      .query(
        "SELECT signer_id FROM first_signer_pins ORDER BY position, signer_id",
      )
      .all()
  ).map((row) => row.signer_id);
}

const revisionOf = (ids) =>
  createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 16);

async function writeOrder(ids) {
  await db.query("DELETE FROM first_signer_pins").run();
  const insert = db.query(
    "INSERT INTO first_signer_pins (signer_id, position) VALUES (?, ?)",
  );
  for (const [index, id] of ids.entries()) await insert.run(id, index + 1);
}

async function confirmedSigner(id) {
  return db
    .query(
      `SELECT s.id, s.name, s.email, s.first_signer, p.position
       FROM signers s LEFT JOIN first_signer_pins p ON p.signer_id = s.id
       WHERE s.id = ? AND s.verified = 1`,
    )
    .get(id);
}

// Everyone with a position, in order, and the marked ones without a position
// (oldest first), as the default public view shows them.
export async function listFirstSigners() {
  const ordered = await orderedIds();
  const marked = (
    await db
      .query(
        `SELECT s.id FROM signers s
         WHERE s.verified = 1 AND s.first_signer = 1
           AND s.id NOT IN (SELECT signer_id FROM first_signer_pins)
         ORDER BY s.created_at, s.id`,
      )
      .all()
  ).map((row) => row.id);
  return {
    revision: revisionOf(ordered),
    ordered: await adminSignersByIds(ordered),
    marked: await adminSignersByIds(marked),
  };
}

const ORDER_LIMIT = 500;

// "Reihenfolge speichern": `ids` is the whole new order. Anyone left out
// loses their position (not their mark).
export async function replaceOrder(ids, revision) {
  if (
    !Array.isArray(ids) ||
    ids.length > ORDER_LIMIT ||
    ids.some((id) => !Number.isInteger(id) || id < 1) ||
    new Set(ids).size !== ids.length
  )
    throw failure(400, "Die Reihenfolge ist ungültig.");
  return db.transaction(
    async () => {
      const current = await orderedIds();
      if (revisionOf(current) !== revision)
        throw failure(
          409,
          "Die Reihenfolge wurde inzwischen an anderer Stelle geändert. Lade sie neu und ordne dann noch einmal.",
          { revision: revisionOf(current) },
        );
      if (ids.length) {
        const { found } = await db
          .query(
            `SELECT COUNT(*) AS found FROM signers
             WHERE verified = 1 AND id IN (${ids.map(() => "?").join(",")})`,
          )
          .get(...ids);
        if (found !== ids.length)
          throw failure(
            400,
            "Eine der Unterschriften gibt es nicht mehr. Lade die Reihenfolge neu.",
          );
      }
      await writeOrder(ids);
      await recordAdminAction(db, "first-signers.order", { count: ids.length });
      return revisionOf(ids);
    },
    { immediate: true },
  );
}

// The "Position" field and "Nach oben anheften": puts the signature at
// `position` (1 = top; past the end = last), moving the ones from there down
// by one; null takes its position away. Returns null for an unknown id,
// otherwise the position it now has.
export async function setPosition(id, position) {
  return db.transaction(
    async () => {
      const signer = await confirmedSigner(id);
      if (!signer) return null;
      const ids = (await orderedIds()).filter((other) => other !== id);
      let now = null;
      if (position !== null) {
        if (ids.length >= ORDER_LIMIT)
          throw failure(
            400,
            `Es können höchstens ${ORDER_LIMIT} Unterschriften eine Position haben.`,
          );
        const index = Math.min(Math.max(position, 1), ids.length + 1) - 1;
        ids.splice(index, 0, id);
        now = index + 1;
      }
      await writeOrder(ids);
      if (now !== signer.position)
        await recordAdminAction(db, "signer.position", {
          targetId: id,
          detail: { changes: { position: [signer.position, now] } },
        });
      return { position: now };
    },
    { immediate: true },
  );
}

export async function setMark(id, marked) {
  return db.transaction(
    async () => {
      const signer = await confirmedSigner(id);
      if (!signer) return null;
      if (Boolean(signer.first_signer) !== marked) {
        await db
          .query("UPDATE signers SET first_signer = ? WHERE id = ?")
          .run(marked ? 1 : 0, id);
        await recordAdminAction(db, "signer.first-signer", {
          targetId: id,
          detail: { changes: { firstSigner: [!marked, marked] } },
        });
      }
      return { firstSigner: marked };
    },
    { immediate: true },
  );
}

// `entry`: name, organisation, signerFunction, kreisverband (already cleaned
// like a sign-up), showSignerDetails, consentNote, pin. The person agreed to
// be named (the admin ticked "Zustimmung liegt vor"); their public date is
// today.
async function insertByHand(entry, consentAt) {
  const { id } = await db
    .query(
      `INSERT INTO signers
         (name, email, kreisverband, occupation, signer_function, verified,
          newsletter, show_publicly, show_signer_details, first_signer,
          admin_consent_at, admin_consent_note, created_at)
       VALUES (?, NULL, ?, ?, ?, 1, 0, 1, ?, 1, ?, ?, ?) RETURNING id`,
    )
    .get(
      entry.name,
      entry.kreisverband || "",
      entry.organisation || "",
      entry.signerFunction || "",
      entry.showSignerDetails ? 1 : 0,
      consentAt,
      entry.consentNote || null,
      consentAt,
    );
  return id;
}

export async function addByHand(entry) {
  return db.transaction(
    async () => {
      const id = await insertByHand(entry, nowIso());
      if (entry.pin) await writeOrder([...(await orderedIds()), id]);
      await recordAdminAction(db, "signer.add-by-hand", {
        targetId: id,
        detail: entry.consentNote ? { consentNote: entry.consentNote } : null,
      });
      return (await adminSignersByIds([id]))[0];
    },
    { immediate: true },
  );
}

export async function duplicatesOf(id) {
  const [signer] = await adminSignersByIds([id]);
  return signer ? possibleDuplicatesOf(signer) : null;
}

// "Verknüpfen": the person signed through the form after the team had added
// them by hand. The signature takes over the mark and the hand entry's
// position (or keeps its own if the entry had none), and the hand entry goes,
// so the person is counted once. The signature keeps its own choices about
// what is public.
export async function linkDuplicate(handId, signerId) {
  return db.transaction(
    async () => {
      const hand = await confirmedSigner(handId);
      const signer = await confirmedSigner(signerId);
      if (!hand || hand.email !== null || !signer || signer.email === null)
        throw failure(
          400,
          "Verknüpfen geht nur zwischen einem Eintrag von Hand und einer bestätigten Unterschrift.",
        );
      const takesPlaceOf = hand.position !== null ? handId : signerId;
      const ids = [];
      for (const id of await orderedIds())
        if (id === takesPlaceOf) ids.push(signerId);
        else if (id !== handId && id !== signerId) ids.push(id);
      await db.query("DELETE FROM signers WHERE id = ?").run(handId);
      await recordErasure(db, erasureSubject(hand), ERASE);
      await forgetDeletedSigners(db);
      await writeOrder(ids);
      if (hand.first_signer)
        await db
          .query("UPDATE signers SET first_signer = 1 WHERE id = ?")
          .run(signerId);
      await recordAdminAction(db, "signer.link-duplicate", {
        targetId: signerId,
      });
      return (await adminSignersByIds([signerId]))[0];
    },
    { immediate: true },
  );
}

// ---- CSV import ------------------------------------------------------------

const IMPORT_LIMIT = 2000;
const VALID_EMAIL = /^[^\s\p{Cc}<>@]+@[^\s\p{Cc}<>@]+\.[^\s\p{Cc}<>@]+$/u;

// The sign-up spreadsheet export ("Vorname, Name …", "E-Mail-Adresse") or a
// plain CSV with name and optional email, organisation, funktion. Returns
// [{ line, name, email, organisation, signerFunction }] or throws a 400 with
// what is wrong with the file as a whole.
export function readImportFile(text) {
  let records;
  try {
    records = csvRows(String(text ?? ""));
  } catch {
    throw failure(
      400,
      "Die Datei ist keine gültige CSV-Datei (Anführungszeichen stimmen nicht).",
    );
  }
  const [header, ...rows] = records;
  const columns = header?.map((name) => name.trim().toLowerCase()) ?? [];
  const sheet = columns.includes("e-mail-adresse");
  const nameColumn = sheet
    ? columns.find((name) => /^vorname,\s*name\b/.test(name))
    : "name";
  const plain = ["name", "email", "organisation", "funktion"];
  if (
    !columns.includes(nameColumn) ||
    new Set(columns).size !== columns.length ||
    (!sheet && columns.some((name) => !plain.includes(name)))
  )
    throw failure(
      400,
      "Erwartet wird die Tabelle der Anmeldungen oder eine CSV-Datei mit den Spalten name, email (freiwillig), organisation (freiwillig) und funktion (freiwillig).",
    );
  if (!rows.length || rows.length > IMPORT_LIMIT)
    throw failure(
      400,
      `Die Datei muss 1 bis ${IMPORT_LIMIT} Einträge enthalten.`,
    );
  return rows.map((cells, index) => {
    const cell = (name) =>
      String(cells[columns.indexOf(name)] ?? "")
        .replace(/\s+/g, " ")
        .trim();
    const email = (
      cell(sheet ? "e-mail-adresse" : "email") ||
      (sheet ? cell("e-mail-adresse 2") : "")
    ).toLowerCase();
    return {
      line: index + 2,
      cells: cells.length === columns.length,
      name: cell(nameColumn),
      email,
      organisation: cell("organisation"),
      signerFunction: cell("funktion"),
    };
  });
}

function rowProblem(row) {
  if (!row.cells)
    return "Die Zeile hat nicht so viele Felder wie die Kopfzeile.";
  if (row.name.length < 2 || row.name.length > 100)
    return "Der Name fehlt oder ist zu kurz oder zu lang.";
  if (
    row.organisation.length > SIGNER_DETAIL_LIMIT ||
    row.signerFunction.length > SIGNER_DETAIL_LIMIT
  )
    return `Organisation oder Funktion ist länger als ${SIGNER_DETAIL_LIMIT} Zeichen.`;
  if (/[\p{Cc}<>]/u.test(row.name + row.organisation + row.signerFunction))
    return "Der Eintrag enthält Zeichen, die nicht erlaubt sind (< oder >).";
  if (row.email && (!VALID_EMAIL.test(row.email) || row.email.length > 254))
    return "Die E-Mail-Adresse ist ungültig.";
  return null;
}

const personKey = (name) =>
  name.normalize("NFKC").toLocaleLowerCase("de-DE").replace(/\s+/g, " ");

// What importing `rows` would do, without changing anything. Each row is
//   mark     a confirmed public signature with that address gets the mark
//   already  that person is a first signer already (nothing to do)
//   add      added by hand: no address given, or no signature has it
//   skip     with `reason`
// The address only finds the signature; it is never stored for an entry
// added by hand. `plan` is a hash of the outcome and of the current order,
// which applying checks again.
export async function planImport(rows, { order = true } = {}) {
  const handNames = new Map(
    (
      await db
        .query(
          `SELECT id, name, first_signer FROM signers WHERE email IS NULL AND verified = 1`,
        )
        .all()
    ).map((row) => [personKey(row.name), row]),
  );
  const byEmail = db.query(
    `SELECT s.id, s.name, s.verified, s.show_publicly, s.first_signer
     FROM signers s WHERE s.email = ?`,
  );
  const withdrawn = db.query(
    `SELECT kind FROM erasure_log WHERE email_hmac = ? AND kind IN (?, ?)`,
  );
  const seenEmails = new Set();
  const seenNames = new Set();
  const planned = [];
  for (const row of rows) {
    const out = {
      line: row.line,
      name: row.name,
      email: row.email,
      organisation: row.organisation,
      signerFunction: row.signerFunction,
    };
    const skip = (reason) => planned.push({ ...out, outcome: "skip", reason });
    const problem = rowProblem(row);
    if (problem) {
      skip(problem);
      continue;
    }
    const key = row.email || `name:${personKey(row.name)}`;
    if (seenEmails.has(key)) {
      skip("Steht weiter oben schon in der Datei.");
      continue;
    }
    seenEmails.add(key);
    if (row.email) {
      const gone = await withdrawn.get(
        emailHmac(row.email),
        ERASE,
        HIDE_PUBLICLY,
      );
      if (gone) {
        skip(
          gone.kind === ERASE
            ? "Zu dieser Adresse wurde die Löschung der Daten verlangt. Ohne neue Zustimmung wird sie nicht eingetragen."
            : "Diese Person hat die öffentliche Anzeige zurückgenommen. Ohne neue Zustimmung wird sie nicht eingetragen.",
        );
        continue;
      }
      if (await isSigningBlocked(row.email)) {
        skip("Diese Adresse ist gesperrt.");
        continue;
      }
      const signer = await byEmail.get(row.email);
      if (signer && !signer.verified) {
        skip(
          "Die Unterschrift mit dieser Adresse ist noch nicht bestätigt. Erst nach der Bestätigung markieren.",
        );
        continue;
      }
      if (signer && !signer.show_publicly) {
        skip(
          "Die Unterschrift mit dieser Adresse wird nicht öffentlich gezeigt. Öffentlich zeigen geht nur mit Zustimmung der Person, über „Bearbeiten“.",
        );
        continue;
      }
      if (signer) {
        planned.push({
          ...out,
          outcome: signer.first_signer ? "already" : "mark",
          signerId: signer.id,
          signerName: signer.name,
        });
        continue;
      }
    }
    const nameKey = personKey(row.name);
    const hand = handNames.get(nameKey);
    if (hand) {
      planned.push({
        ...out,
        outcome: hand.first_signer ? "already" : "mark",
        signerId: hand.id,
        reason: "Ist schon von Hand eingetragen.",
      });
      continue;
    }
    if (seenNames.has(nameKey)) {
      skip("Dieser Name wird weiter oben schon von Hand eingetragen.");
      continue;
    }
    seenNames.add(nameKey);
    planned.push({ ...out, outcome: "add" });
  }
  const current = await orderedIds();
  const positioned = new Set(current);
  const placed = order
    ? planned.filter(
        (row) =>
          row.outcome === "add" ||
          (row.signerId &&
            row.outcome !== "skip" &&
            !positioned.has(row.signerId)),
      ).length
    : 0;
  const plan = createHmac("sha256", emailHmac("first-signers-import"))
    .update(
      JSON.stringify([
        // Everything applying stores, so a file changed after the preview
        // needs a new preview.
        planned.map(
          ({ line, outcome, signerId, name, organisation, signerFunction }) => [
            line,
            outcome,
            signerId ?? null,
            name,
            organisation ?? "",
            signerFunction ?? "",
          ],
        ),
        current,
        order,
      ]),
    )
    .digest("hex")
    .slice(0, 32);
  // The preview shows addresses only for the team's own check; they are not
  // kept anywhere.
  return {
    plan,
    rows: planned,
    counts: {
      ...Object.fromEntries(
        ["mark", "already", "add", "skip"].map((outcome) => [
          outcome,
          planned.filter((row) => row.outcome === outcome).length,
        ]),
      ),
      placed,
    },
  };
}

// Applies a previewed import, all or nothing, if nothing changed since the
// preview. `backup` runs first and must succeed. New entries get the mark and
// their details are public only with `showSignerDetails`. With `order`, every
// row that is not skipped and has no position yet is put at the end of the
// order, in file order.
export async function applyImport(
  rows,
  { plan, order = true, showSignerDetails = false, consentNote = "" },
  backup,
) {
  if ((await planImport(rows, { order })).plan !== plan)
    throw failure(
      409,
      "Seit der Vorschau hat sich etwas geändert. Lade die Datei noch einmal und prüfe die neue Vorschau.",
    );
  await backup();
  return db.transaction(
    async () => {
      const current = await planImport(rows, { order });
      if (current.plan !== plan)
        throw failure(
          409,
          "Seit der Vorschau hat sich etwas geändert. Lade die Datei noch einmal und prüfe die neue Vorschau.",
        );
      const at = nowIso();
      const ids = await orderedIds();
      const counts = { marked: 0, added: 0 };
      for (const row of current.rows) {
        if (row.outcome === "skip") continue;
        let id = row.signerId;
        if (row.outcome === "add") {
          id = await insertByHand(
            { ...row, showSignerDetails, consentNote },
            at,
          );
          counts.added++;
        } else if (row.outcome === "mark") {
          await db
            .query("UPDATE signers SET first_signer = 1 WHERE id = ?")
            .run(id);
          counts.marked++;
        }
        if (order && !ids.includes(id)) ids.push(id);
      }
      if (ids.length > ORDER_LIMIT)
        throw failure(
          400,
          `Es können höchstens ${ORDER_LIMIT} Unterschriften eine Position haben.`,
        );
      if (order) await writeOrder(ids);
      await recordAdminAction(db, "first-signers.import", {
        count: counts.marked + counts.added,
        detail: consentNote ? { consentNote } : null,
      });
      return counts;
    },
    { immediate: true },
  );
}
