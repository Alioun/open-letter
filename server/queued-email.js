// Transactional mail queued as Honker jobs. The job payload carries only ids
// ({ kind, signerId | requestId, baseUrl }): name, address and tokens are read
// from the database when the mail is sent. A job that fails for good therefore
// leaves no personal data in the dead-letter table, and erasing someone makes
// their pending mails no-ops.
import {
  getSignerForMail,
  getSignerIdByEmail,
  getDeletionRequestForMail,
  getZoomRegistrationByEmail,
  getZoomPendingForMail,
  getZoomRegistrationForMail,
  issueUnsubscribeToken,
  issueZoomUnsubscribeToken,
} from "./db.js";
import { buildUnsubscribeHeaders } from "./email.js";

const notExpired = (at) => Boolean(at) && at > new Date().toISOString();

// Unsubscribe link for a mail to `signerId` / `email`: the signer's token when
// there is a signature, otherwise the Treffen registration's.
async function unsubscribeArgs(baseUrl, { signerId, email }) {
  let token = null;
  let query = "";
  if (signerId) token = await issueUnsubscribeToken(signerId);
  if (!token && email) {
    const zoom = await getZoomRegistrationByEmail(email);
    if (zoom) {
      token = await issueZoomUnsubscribeToken(zoom.id);
      query = "?from=zoom";
    }
  }
  if (!token) return {};
  const optOut = query
    ? `${baseUrl}/api/zoom-abmelden/${token}/opt-out`
    : `${baseUrl}/api/unsubscribe/${token}/opt-out`;
  return {
    headers: buildUnsubscribeHeaders(optOut),
    unsubscribeUrl: `${baseUrl}/abmelden/${token}${query}`,
  };
}

// Returns the arguments for the mail's send function, or null when the mail
// should no longer go out (row deleted, already confirmed, link expired).
export async function prepareQueuedEmail(payload) {
  // Jobs enqueued before payloads were reduced still carry the full arguments.
  if (payload.to) return payload;

  const { kind, baseUrl } = payload;

  if (kind === "deletion") {
    const req = await getDeletionRequestForMail(payload.requestId);
    if (!req || !notExpired(req.expires_at)) return null;
    return {
      kind,
      to: req.email,
      token: req.token,
      baseUrl,
      ...(await unsubscribeArgs(baseUrl, {
        signerId: await getSignerIdByEmail(req.email),
        email: req.email,
      })),
    };
  }

  if (kind === "treffen-verification") {
    const pending = await getZoomPendingForMail(payload.pendingId);
    if (!pending || !notExpired(pending.expires_at)) return null;
    // No unsubscribe link: nothing is registered yet, and the mail is sent
    // only once per sign-up.
    return {
      kind,
      to: pending.email,
      name: pending.name,
      token: pending.token,
      baseUrl,
    };
  }

  if (kind === "treffen-already-registered") {
    const reg = await getZoomRegistrationForMail(payload.registrationId);
    if (!reg) return null;
    const token = await issueZoomUnsubscribeToken(reg.id);
    return {
      kind,
      to: reg.email,
      name: reg.name,
      baseUrl,
      headers: buildUnsubscribeHeaders(
        `${baseUrl}/api/zoom-abmelden/${token}/opt-out`,
      ),
      unsubscribeUrl: `${baseUrl}/abmelden/${token}?from=zoom`,
    };
  }

  const signer = await getSignerForMail(payload.signerId);
  if (!signer) return null;
  if (kind === "verification") {
    if (signer.verified || !notExpired(signer.token_expires_at)) return null;
  } else if (kind === "already-signed") {
    if (!signer.verified) return null;
  } else {
    throw new Error(`unknown email kind: ${kind}`);
  }

  return {
    kind,
    to: signer.email,
    name: signer.name,
    baseUrl,
    ...(kind === "verification" && { token: signer.verification_token }),
    ...(await unsubscribeArgs(baseUrl, { signerId: signer.id })),
  };
}
