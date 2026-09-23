// Personal invite links (features.inviteLinks): the share block shown after
// confirming, the invite modal on /i/<code>, and the private stats modal on
// /i/<code>#s=<token>. Texts come from the letter's `invite` block.
//
// Sharing uses plain links only (wa.me, t.me, mailto, the Web Share API): no
// third-party script loads, and nothing is sent anywhere until someone clicks.

import { useState, useEffect, useRef } from "react";
import cfg from "../config/letter.config.js";
import { resolveInvite, fillInvite } from "../config/invite.js";

// Resolved on use, so admin text overrides applied after load count.
const T = () => resolveInvite(cfg);
const CODE_RE = /^\/i\/([0-9a-hjkmnp-tv-z]{8})\/?$/;
const REF_KEY = "invite-ref";

export const inviteUrl = (code) => `${window.location.origin}/i/${code}`;

// Read the invite path once on load. The stats token is taken out of the
// fragment and the address bar is reset to "/", so neither the code nor the
// token stays in the history or gets copied along with the page URL.
export function readInviteLocation() {
  const match = CODE_RE.exec(window.location.pathname);
  if (!match) return null;
  const code = match[1];
  const token = new URLSearchParams(window.location.hash.slice(1)).get("s");
  const confirmed =
    new URLSearchParams(window.location.search).get("confirmed") === "1";
  window.history.replaceState({}, "", "/");
  return { code, statsToken: token || null, confirmed };
}

// The inviter's code rides along with the sign-up, kept for this tab only.
export function rememberInviteRef(code) {
  try {
    sessionStorage.setItem(REF_KEY, code);
  } catch {}
}

export function takeInviteRef() {
  try {
    return sessionStorage.getItem(REF_KEY);
  } catch {
    return null;
  }
}

export function forgetInviteRef() {
  try {
    sessionStorage.removeItem(REF_KEY);
  } catch {}
}

export const inviteOptInLabel = () => T().optInLabel;

export function InviteShare({ code }) {
  const url = inviteUrl(code);
  const message = fillInvite(T().shareMessage, { title: T().title, url });
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  const links = [
    ["WhatsApp", `https://wa.me/?text=${encodeURIComponent(message)}`],
    [
      "Telegram",
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(
        fillInvite(T().shareMessage, { title: T().title, url: "" }).trim(),
      )}`,
    ],
    ["E-Mail", `mailto:?subject=${encodeURIComponent(T().title)}&body=${encodeURIComponent(message)}`],
  ];

  return (
    <div className="invite-share">
      <p className="invite-share__heading">{T().successHeading}</p>
      <div className="invite-share__link">
        <input
          readOnly
          value={url}
          aria-label={T().successHeading}
          onFocus={(e) => e.target.select()}
        />
        <button type="button" onClick={copy}>
          {copied ? T().copiedLabel : T().copyLabel}
        </button>
      </div>
      <div className="invite-share__buttons">
        {links.map(([label, href]) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {label}
          </a>
        ))}
        {canShare && (
          <button
            type="button"
            onClick={() =>
              navigator.share({ title: T().title, text: message }).catch(() => {})
            }
          >
            {T().moreLabel}
          </button>
        )}
      </div>
      <p className="invite-share__note">{T().successNote}</p>
    </div>
  );
}

function InviteDialog({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal success"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-modal-title"
        onClick={(e) => e.stopPropagation()}
        ref={ref}
      >
        <div className="modal-head">
          <h3 id="invite-modal-title">{title}</h3>
          <button onClick={onClose} aria-label="Schließen">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function InviteModal({ firstName, onClose }) {
  const text = firstName
    ? fillInvite(T().modalText, { firstName, title: T().title })
    : fillInvite(T().modalTextAnonymous, { title: T().title });
  return (
    <InviteDialog title={T().title} onClose={onClose}>
      <p className="success-title">{text}</p>
      <button className="confirm-btn confirm-btn--accent" onClick={onClose}>
        {T().modalButton} <span aria-hidden="true">→</span>
      </button>
    </InviteDialog>
  );
}

// result: { count } | { below } | { min, max } | { min } | { invalid: true }
export function InviteStatsModal({ result, onClose }) {
  let text;
  if (result.invalid) text = T().statsInvalid;
  else if (result.below != null)
    text = fillInvite(T().statsBelow, { threshold: result.below });
  else if (result.max != null)
    text = fillInvite(T().statsRange, { min: result.min, max: result.max });
  else if (result.min != null)
    text = fillInvite(T().statsAtLeast, { min: result.min });
  else text = fillInvite(T().statsCount, { count: result.count });
  return (
    <InviteDialog title={T().statsHeading} onClose={onClose}>
      <p className="success-title">{text}</p>
    </InviteDialog>
  );
}
