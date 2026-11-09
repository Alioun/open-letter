import { ValidationError } from "../config/validation.js";
import { Resolver } from "node:dns/promises";
import { randomBytes } from "node:crypto";

export const MAILBOX_DKIM_SELECTORS = [
  "MBO0001",
  "MBO0002",
  "MBO0003",
  "MBO0004",
];
export function dnsInstructions(domain, token) {
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain))
    throw new ValidationError("Gib einen gültigen Domainnamen ein.");
  return {
    domain,
    records: [
      {
        type: "TXT",
        name: `_campaign.${domain}`,
        value: `campaign-verification=${token}`,
      },
      {
        type: "TXT",
        name: domain,
        value: "v=spf1 include:mailbox.org ~all",
        note: "Ergänze include:mailbox.org im bestehenden SPF-Eintrag. Behalte einen einzigen SPF-Eintrag und seine bisherige Richtlinie.",
      },
      ...MAILBOX_DKIM_SELECTORS.map((s, i) => ({
        type: "CNAME",
        name: `${s}._domainkey.${domain}`,
        value: `${s.toLowerCase()}._domainkey.mailbox.org.`,
        note: "Prüfe vor der Veröffentlichung die Zieladresse in deinem mailbox.org-Konto.",
      })),
      {
        type: "TXT",
        name: `_dmarc.${domain}`,
        value: "v=DMARC1; p=none",
        note: "Behalte eine bestehende DMARC-Richtlinie bei. Lege Adressen für Berichte separat fest.",
      },
    ],
    notice:
      "Die Prüfung zeigt, ob die DNS-Einträge veröffentlicht sind. Sie bestätigt weder die Signierung noch den Empfang von Nachrichten. Ändere keine MX-Einträge für den ausgehenden Versand. Bestätige die Domain in deinem mailbox.org-Konto und registriere den Absender-Alias. Testkonten können externe Zustellung einschränken. Prüfe den Empfang einer Testnachricht außerhalb von mailbox.org.",
  };
}

export function ownershipToken() {
  return randomBytes(24).toString("hex");
}

export async function checkMailboxDns(
  domain,
  token,
  resolver = new Resolver({ timeout: 3000, tries: 1 }),
) {
  const instructions = dnsInstructions(domain, token);
  async function lookup(type, name) {
    try {
      return type === "TXT"
        ? (await resolver.resolveTxt(name)).map((v) => v.join(""))
        : await resolver.resolveCname(name);
    } catch (e) {
      if (["ENODATA", "ENOTFOUND"].includes(e.code)) return [];
      return ["lookup-unavailable"];
    }
  }
  const results = await Promise.all(
    instructions.records.map(async (record) => {
      const values = await lookup(record.type, record.name);
      const legacy =
        record.type === "CNAME" && !values.length
          ? await lookup("TXT", record.name)
          : [];
      const published = record.name.startsWith("_campaign.")
        ? values.includes(record.value)
        : record.type === "CNAME"
          ? values.some(
              (v) =>
                v.toLowerCase().replace(/\.$/, "") ===
                record.value.replace(/\.$/, ""),
            ) || legacy.some((v) => /^v=DKIM1;.*\bp=/i.test(v))
          : record.name.startsWith("_dmarc.")
            ? values.some((v) => /^v=DMARC1;/i.test(v))
            : values.filter((v) => /^v=spf1\b/i.test(v)).length === 1 &&
              values.some((v) => /\binclude:mailbox\.org\b/.test(v));
      return { ...record, values, legacy, published };
    }),
  );
  return { ...instructions, results };
}
