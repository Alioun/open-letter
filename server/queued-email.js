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
import { buildUnsubscribeHeaders, pageUrl } from "./email.js";

const notExpired = (at) => Boolean(at) && at > new Date().toISOString();

const legacySubjects = {
  verification: ["signers", "signerId"],
  "already-signed": ["signers", "signerId"],
  invite: ["signers", "signerId"],
  deletion: ["deletion_requests", "requestId"],
  "treffen-verification": ["zoom_pending", "pendingId"],
  "treffen-already-registered": ["zoom_registrations", "registrationId"],
};

export async function normalizeQueuedEmailPayload(connection, payload) {
  if (!payload.to) return payload;
  const subject = legacySubjects[payload.kind];
  if (!subject || typeof payload.to !== "string")
    throw new Error("Unsupported legacy email payload");
  const [table, field] = subject;
  const row = await connection
    .query(
      `SELECT id FROM ${table} WHERE email=?${payload[field] ? " AND id=?" : ""}`,
    )
    .get(payload.to, ...(payload[field] ? [payload[field]] : []));
  if (!row) return null;
  const normalized = {
    kind: payload.kind,
    [field]: row.id,
    baseUrl: payload.baseUrl,
  };
  for (const key of ["messageId", "token", "statsToken", "inviteCode"])
    if (payload[key]) normalized[key] = payload[key];
  return normalized;
}

// Unsubscribe link for a mail to `signerId` / `email`: the signer's token when
// there is a signature, otherwise the Treffen registration's. The settings page
// opens in the mail's language (`lang`).
async function unsubscribeArgs(baseUrl, { signerId, email, lang }) {
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
    unsubscribeUrl: pageUrl(baseUrl, `/abmelden/${token}${query}`, lang),
  };
}

// Returns the arguments for the mail's send function, or null when the mail
// should no longer go out (row deleted, already confirmed, link expired).
export async function prepareQueuedEmail(payload) {
  const { kind, baseUrl } = payload;

  if (kind === "deletion") {
    const req = await getDeletionRequestForMail(payload.requestId);
    if (
      !req ||
      !notExpired(req.expires_at) ||
      (payload.token && payload.token !== req.token)
    )
      return null;
    return {
      kind,
      to: req.email,
      token: req.token,
      baseUrl,
      lang: req.lang,
      ...(await unsubscribeArgs(baseUrl, {
        signerId: await getSignerIdByEmail(req.email),
        email: req.email,
        lang: req.lang,
      })),
    };
  }

  if (kind === "treffen-verification") {
    const pending = await getZoomPendingForMail(payload.pendingId);
    if (
      !pending ||
      !notExpired(pending.expires_at) ||
      (payload.token && payload.token !== pending.token)
    )
      return null;
    // No unsubscribe link: nothing is registered yet, and the mail is sent
    // only once per sign-up.
    return {
      kind,
      to: pending.email,
      name: pending.name,
      token: pending.token,
      baseUrl,
      lang: pending.lang,
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
      lang: reg.lang,
      headers: buildUnsubscribeHeaders(
        `${baseUrl}/api/zoom-abmelden/${token}/opt-out`,
      ),
      unsubscribeUrl: pageUrl(
        baseUrl,
        `/abmelden/${token}?from=zoom`,
        reg.lang,
      ),
    };
  }

  const signer = await getSignerForMail(payload.signerId);
  if (!signer) return null;
  if (kind === "verification") {
    if (
      signer.verified ||
      !notExpired(signer.token_expires_at) ||
      (payload.token && payload.token !== signer.verification_token)
    )
      return null;
  } else if (kind === "already-signed") {
    if (!signer.verified) return null;
  } else if (kind === "invite") {
    if (!signer.verified || !signer.invite_code) return null;
    if (!payload.statsToken || !payload.inviteCode)
      throw new Error(
        "Invite credentials must be persisted before preparing mail",
      );
  } else {
    throw new Error(`unknown email kind: ${kind}`);
  }

  return {
    kind,
    to: signer.email,
    name: signer.name,
    baseUrl,
    lang: signer.lang,
    ...(kind === "verification" && { token: signer.verification_token }),
    ...(kind === "invite" && {
      inviteCode: payload.inviteCode,
      statsToken: payload.statsToken,
    }),
    ...(await unsubscribeArgs(baseUrl, {
      signerId: signer.id,
      lang: signer.lang,
    })),
  };
}
