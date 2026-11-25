import { createHmac } from "node:crypto";

export function emailHmac(email) {
  const key = process.env.DATABASE_ENCRYPTION_KEY || "";
  if (!key)
    throw new Error("DATABASE_ENCRYPTION_KEY is required for the erasure log");
  const hmacKey = createHmac("sha256", key).update("erasure-log").digest();
  return createHmac("sha256", hmacKey)
    .update(String(email).trim().toLowerCase())
    .digest("hex");
}

// What the erasure log keys a signature by: its address, or for an entry the
// team added by hand (which has none) its id. Ids are never reused, so a
// restored backup's row with that id is the same entry.
export function erasureSubject(signer) {
  return signer.email ?? `hand-entry:${signer.id}`;
}

const DOTLESS_DOMAINS = new Map([
  ["gmail.com", "gmail.com"],
  ["googlemail.com", "gmail.com"],
]);

// One mailbox, however it is spelled: `Name+tag@x.org` reaches `name@x.org`,
// and Gmail ignores dots and treats googlemail.com as gmail.com. Signing
// blocks are keyed by this, so a variant of a blocked address stays blocked.
export function canonicalMailbox(email) {
  const address = String(email).trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at < 1) return address;
  let local = address.slice(0, at).split("+")[0];
  let domain = address.slice(at + 1);
  if (DOTLESS_DOMAINS.has(domain)) {
    domain = DOTLESS_DOMAINS.get(domain);
    local = local.replaceAll(".", "");
  }
  return `${local || address.slice(0, at)}@${domain}`;
}

// Every domain spelling canonicalMailbox folds onto the domain of `mailbox`.
export function mailboxDomains(mailbox) {
  const domain = mailbox.slice(mailbox.lastIndexOf("@") + 1);
  const spellings = [...DOTLESS_DOMAINS]
    .filter(([, canonical]) => canonical === domain)
    .map(([spelling]) => spelling);
  return spellings.length ? spellings : [domain];
}
