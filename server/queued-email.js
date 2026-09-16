// Transactional mail queued as Honker jobs. The job payload carries only
// { kind, signerId, baseUrl }: name, address and tokens are read from the
// signers row when the mail is sent. A job that fails for good therefore leaves
// no personal data in the dead-letter table, and erasing a signer makes their
// pending mails no-ops.
import {
  getSignerForMail,
  issueUnsubscribeToken,
} from "./db.js";
import { buildUnsubscribeHeaders } from "./email.js";

const notExpired = (at) => Boolean(at) && at > new Date().toISOString();

// Returns the arguments for the mail's send function, or null when the mail
// should no longer go out (row deleted, already confirmed, link expired).
export async function prepareQueuedEmail(payload) {
  // Jobs enqueued before payloads were reduced still carry the full arguments.
  if (payload.to) return payload;

  const signer = await getSignerForMail(payload.signerId);
  if (!signer) return null;

  const { kind, baseUrl } = payload;
  if (kind === "verification") {
    if (signer.verified || !notExpired(signer.token_expires_at)) return null;
  } else if (kind === "already-signed") {
    if (!signer.verified) return null;
  } else if (kind === "deletion") {
    if (!notExpired(signer.deletion_token_expires_at)) return null;
  } else {
    throw new Error(`unknown email kind: ${kind}`);
  }

  const unsub = await issueUnsubscribeToken(signer.id);
  const args = {
    kind,
    to: signer.email,
    name: signer.name,
    baseUrl,
    headers: unsub
      ? buildUnsubscribeHeaders(`${baseUrl}/api/unsubscribe/${unsub}/opt-out`)
      : undefined,
    unsubscribeUrl: unsub ? `${baseUrl}/abmelden/${unsub}` : undefined,
  };
  if (kind === "verification") args.token = signer.verification_token;
  if (kind === "deletion") args.token = signer.deletion_token;
  return args;
}
