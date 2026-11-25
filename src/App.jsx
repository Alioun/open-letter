import { Popover } from "@base-ui/react/popover";
import {
  CampaignConfig,
  useCampaignConfig,
  CampaignApi,
  useCampaignApi,
} from "./CampaignConfig.jsx";
import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  memo,
  Fragment,
} from "react";
import bundledConfig, {
  LANG,
  DEFAULT_LANG,
  LANGUAGES,
} from "../config/letter.config.js";
import Headline from "./Headline.jsx";
import { Section, layoutFor, RichLetter, RichFaq } from "./SectionRenderer.jsx";
import { fixtureFetch, fixtureBoot } from "./preview-fixtures.js";
import { Modal, FreeTextChoice, Choice } from "./ui.jsx";
import { renderPrivacy } from "../config/public-privacy.js";
import { resolvePrivacy } from "../config/privacy.js";
import { resolveInvite } from "../config/invite.js";
import { LetterArticle, FaqContent } from "../config/content.jsx";
import { SIGNER_DETAIL_LIMIT } from "../config/signer-details.js";
import { ZoomForm } from "./ZoomForm";
import { KV_NONE, regionLabels } from "../config/region.js";
import { fillText } from "../config/ui.js";
import {
  InviteShare,
  InviteModal,
  InviteStatsModal,
  readInviteLocation,
  rememberInviteRef,
  takeInviteRef,
  forgetInviteRef,
  inviteOptInLabel,
} from "./Invite";

const cfg = bundledConfig;

// Read while rendering, so admin text overrides applied after load count.
const region = () => regionLabels(cfg);

const MAP_VB = { x: -60, y: -10, w: 520, h: 520 };

const GERMANY_PATH =
  "M 47,100 L 75,88 L 115,78 L 120,52 L 130,20 L 155,18 L 180,36 L 210,40 L 232,54 L 268,62 L 300,48 L 340,48 L 358,65 L 372,110 L 370,175 L 386,240 L 360,262 L 322,274 L 292,296 L 286,350 L 336,396 L 312,460 L 272,482 L 226,482 L 190,482 L 166,474 L 146,470 L 122,466 L 82,480 L 76,450 L 88,426 L 106,392 L 112,376 L 56,372 L 32,352 L 16,322 L 8,292 L 6,262 L 14,232 L 32,212 L 44,196 L 52,172 L 56,142 L 47,110 Z";

function initials(name) {
  const parts = (name || "").trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || "?";
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// "vor 3 Std" etc.; "gerade eben" stands alone (no "vor").
function relTime(ts) {
  const t = cfg.ui.time;
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  const ago = (key, n) => `${t.prefix} ${fillText(t[key], { n })}`.trim();
  if (diff < 60) return t.justNow;
  if (diff < 3600) return ago("minutes", Math.floor(diff / 60));
  if (diff < 86400) return ago("hours", Math.floor(diff / 3600));
  const days = Math.floor(diff / 86400);
  if (days < 7) return ago(days === 1 ? "day" : "days", days);
  if (diff < 86400 * 30) return ago("weeks", Math.floor(diff / (86400 * 7)));
  return ago("months", Math.floor(diff / (86400 * 30)));
}

const KNOWN_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.de",
  "yahoo.co.uk",
  "yahoo.fr",
  "yahoo.at",
  "hotmail.com",
  "hotmail.de",
  "hotmail.co.uk",
  "hotmail.fr",
  "outlook.com",
  "outlook.de",
  "live.com",
  "live.de",
  "web.de",
  "gmx.de",
  "gmx.net",
  "gmx.com",
  "gmx.at",
  "gmx.ch",
  "t-online.de",
  "freenet.de",
  "arcor.de",
  "posteo.de",
  "posteo.net",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "tutanota.com",
  "tuta.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "mail.com",
  "hey.com",
  "fastmail.com",
  "fastmail.fm",
]);

function emailWarning(email) {
  const domain =
    String(email || "")
      .split("@")[1]
      ?.toLowerCase() || "";
  if (domain === "mailbox.org") return "mailbox";
  if (!KNOWN_EMAIL_DOMAINS.has(domain)) return "custom";
  return null;
}

function getScrollTarget(id) {
  const el = document.getElementById(id);
  if (!el) return null;

  // Offset by exactly the pinned header's height so the section sits flush beneath
  // it; any extra would expose a sliver of the previous section's bottom padding.
  const header = document.querySelector(".topbar");
  const headerHeight = header?.getBoundingClientRect().height ?? 0;
  return Math.max(
    0,
    window.scrollY + el.getBoundingClientRect().top - headerHeight,
  );
}

function scrollTo(id) {
  const target = getScrollTarget(id);
  if (target === null) return;

  if ("scrollBehavior" in document.documentElement.style) {
    window.scrollTo({ top: target, behavior: "smooth" });
  } else {
    window.scrollTo(0, target);
  }
}

// Public API session token. The public read endpoints (/api/stats, /api/signers,
// /api/zoom-count, …) require a short-lived token minted by GET /api/session and
// sent back via the X-Api-Token header (see server/index.js `denyPublic`). We
// fetch one lazily, cache it, and refresh on expiry or a 401.
let apiToken = null;
let apiTokenExpiresAt = 0;
let apiTokenPromise = null;

function fetchSessionToken() {
  if (apiTokenPromise) return apiTokenPromise;
  apiTokenPromise = (async () => {
    try {
      const res = await fetch("/api/session");
      if (!res.ok) throw new Error("session");
      const { token, expiresIn } = await res.json();
      apiToken = token;
      // Refresh a minute before the server-side expiry to avoid edge races.
      apiTokenExpiresAt = Date.now() + Math.max(0, expiresIn - 60) * 1000;
      return token;
    } finally {
      apiTokenPromise = null;
    }
  })();
  return apiTokenPromise;
}

function getApiToken() {
  if (apiToken && Date.now() < apiTokenExpiresAt)
    return Promise.resolve(apiToken);
  return fetchSessionToken();
}

// fetch() wrapper that attaches the public API token and retries once on 401
// (token expired, or the server restarted with a new secret).
// Off the default language, X-Lang asks for error messages in the page's.
async function liveApiFetch(path, opts = {}) {
  if (LANG !== DEFAULT_LANG) {
    opts = { ...opts, headers: { ...(opts.headers || {}), "X-Lang": LANG } };
  }
  const doFetch = (t) =>
    fetch(path, {
      ...opts,
      headers: { ...(opts.headers || {}), "X-Api-Token": t },
    });
  let token;
  try {
    token = await getApiToken();
  } catch {
    return fetch(path, opts); // token unavailable, let the server decide
  }
  let res = await doFetch(token);
  if (res.status === 401) {
    apiToken = null;
    try {
      res = await doFetch(await fetchSessionToken());
    } catch {
      /* keep the original 401 response */
    }
  }
  return res;
}

// The section the reader is on, as "#id" (scrolling does not set the hash).
function currentSectionHash() {
  const bar = document.querySelector(".topbar")?.offsetHeight || 0;
  let hash = "";
  for (const el of document.querySelectorAll("main section[id]")) {
    if (el.getBoundingClientRect().top <= bar + 1) hash = `#${el.id}`;
  }
  return hash;
}

// DE | EN links, only for letters with features.multiLanguage and more than
// one language. Switching keeps the section the reader is on.
function LanguageSwitch() {
  if (LANGUAGES.length < 2) return null;
  const t = cfg.ui.chrome;
  const href = (l) => (l === DEFAULT_LANG ? "/" : `/${l}/`);
  return (
    <div className="lang-switch" role="group" aria-label={t.languageNav}>
      {LANGUAGES.map((l) => (
        <a
          key={l}
          href={href(l)}
          hrefLang={l}
          lang={l}
          aria-label={fillText(t.languageLink, {
            language: t.languageNames?.[l] || l.toUpperCase(),
          })}
          aria-current={l === LANG ? "page" : undefined}
          onClick={(e) => {
            e.currentTarget.href = href(l) + currentSectionHash();
          }}
        >
          {l.toUpperCase()}
        </a>
      ))}
    </div>
  );
}

// `boot` is the live initial state from /api/boot (loaded in main.jsx before
// the first render), so the counter and Treffen date never flash. null if it
// failed or timed out.
export default function App({
  boot = null,
  preview = false,
  previewConfig,
  onlySection,
  previewState,
}) {
  const cfg = previewConfig || bundledConfig;
  const INVITES = Boolean(cfg.features.inviteLinks);
  const region = () => regionLabels(cfg);
  const apiFetch = preview ? fixtureFetch : liveApiFetch;
  boot = preview ? boot || fixtureBoot : boot;
  const [signers, setSigners] = useState([]);
  const [stats, setStats] = useState(
    boot?.stats ?? {
      total: 0,
      today: 0,
      week: 0,
      kvCount: 0,
    },
  );
  const [signersTotal, setSignersTotal] = useState(0);
  const [filter, setFilter] = useState("alle");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const knownIdsRef = useRef(new Set());
  const visitStartRef = useRef(Date.now());

  const signerKey = useCallback((s) => `${s.created_at}|${s.name}`, []);

  const [emailModal, setEmailModal] = useState(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendSent, setResendSent] = useState(false);
  const [resendError, setResendError] = useState(null);
  const [showSuccess, setShowSuccess] = useState(
    preview && previewState === "confirmation",
  );
  // Own invite code, shown in the success modal after confirming.
  const [ownInviteCode, setOwnInviteCode] = useState(null);
  // Landing on someone's invite link: { firstName } for the modal.
  const [invitedBy, setInvitedBy] = useState(null);
  // Private stats link: { count } | { below } | { invalid }.
  const [inviteStats, setInviteStats] = useState(null);
  const [submitError, setSubmitError] = useState(
    preview && previewState === "error" ? cfg.ui.errors.network : null,
  );
  const [navOpen, setNavOpen] = useState(false);
  const [showImpressum, setShowImpressum] = useState(false);
  const [showDatenschutz, setShowDatenschutz] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [detailsView, setDetailsView] = useState(null);
  const [detailGroups, setDetailGroups] = useState([]);
  const [showKreisverband, setShowKreisverband] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [kvGroups, setKvGroups] = useState([]);
  const [signFormKvNames, setSignFormKvNames] = useState([]);
  const [signFormOccNames, setSignFormOccNames] = useState([]);
  const [zoomError, setZoomError] = useState(null);
  const bootZoom = boot?.zoom;
  const [zoomCount, setZoomCount] = useState(bootZoom?.count || 0);
  const [zoomEventAt, setZoomEventAt] = useState(bootZoom?.eventAt || null);
  // Runtime-editable Treffen settings (admin panel → /api/zoom-count). Seeded
  // from /api/boot, else the bundled config, so there's no flash before the
  // fetch resolves.
  const [zoomShowDelegierter, setZoomShowDelegierter] = useState(
    typeof bootZoom?.showDelegierter === "boolean"
      ? bootZoom.showDelegierter
      : Boolean(cfg.zoom?.form?.showDelegierter),
  );
  const [zoomMode, setZoomMode] = useState(
    bootZoom?.mode || cfg.zoom?.mode || "online",
  );
  const [zoomLocation, setZoomLocation] = useState(
    bootZoom?.location || {
      name: cfg.zoom?.location?.name || "",
      address: cfg.zoom?.location?.address || "",
      mapsUrl: cfg.zoom?.location?.mapsUrl || "",
    },
  );
  const [zoomNavLabelRt, setZoomNavLabelRt] = useState(
    bootZoom?.navLabel || cfg.zoom?.navLabel || "Treffen",
  );
  const fetchStats = useCallback(async () => {
    try {
      const res = await apiFetch("/api/stats");
      if (res.ok) setStats(await res.json());
    } catch {}
  }, []);

  const fetchSigners = useCallback(async (f, s, o, append) => {
    try {
      if (!append) setLoading(true);
      const params = new URLSearchParams({
        filter: f,
        search: s,
        limit: "18",
        offset: String(o),
        sort: f === "alle" ? "asc" : "desc",
      });
      const res = await apiFetch(`/api/signers?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      data.signers.forEach((s) => knownIdsRef.current.add(signerKey(s)));
      setSigners((prev) =>
        append ? [...prev, ...data.signers] : data.signers,
      );
      setSignersTotal(data.total);
      setError(null);
    } catch {
      setError(cfg.ui.list.loadError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchSigners("alle", "", 0, false);
  }, [fetchStats, fetchSigners]);

  const fetchZoomCount = useCallback(async () => {
    try {
      const res = await apiFetch("/api/zoom-count");
      if (res.ok) {
        const data = await res.json();
        setZoomCount(data.count || 0);
        if (data.eventAt) setZoomEventAt(data.eventAt);
        if (typeof data.showDelegierter === "boolean")
          setZoomShowDelegierter(data.showDelegierter);
        if (data.mode) setZoomMode(data.mode);
        if (data.location) setZoomLocation(data.location);
        if (data.navLabel) setZoomNavLabelRt(data.navLabel);
      }
    } catch {}
  }, []);

  useEffect(() => {
    // Poll the live zoom registration count only when the module is enabled.
    if (cfg.features.zoomEvent) fetchZoomCount();
  }, [fetchZoomCount]);

  useEffect(() => {
    (async () => {
      try {
        if (cfg.features.kreisverbandField) {
          const kvRes = await apiFetch("/api/kreisverband-stats");
          if (kvRes.ok) {
            const kvData = await kvRes.json();
            setSignFormKvNames(
              kvData.map((d) => d.kreisverband).filter(Boolean),
            );
          }
        }
        if (cfg.features.occupationField) {
          const occRes = await apiFetch("/api/occupations");
          if (occRes.ok) {
            const occData = await occRes.json();
            setSignFormOccNames(occData.map((d) => d.occupation));
          }
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (preview) return;
    const interval = setInterval(async () => {
      if (document.hidden) return;
      fetchStats();
      try {
        const params = new URLSearchParams({
          filter,
          search,
          limit: "18",
          offset: "0",
          sort: filter === "alle" ? "asc" : "desc",
        });
        const res = await apiFetch(`/api/signers?${params}`);
        if (!res.ok) return;
        const data = await res.json();
        setSignersTotal(data.total);
        const newOnes = data.signers
          .filter(
            (s) =>
              !knownIdsRef.current.has(signerKey(s)) &&
              new Date(s.created_at).getTime() > visitStartRef.current,
          )
          .map((s) => ({ ...s, _isNew: true }));
        if (newOnes.length > 0) {
          newOnes.forEach((s) => knownIdsRef.current.add(signerKey(s)));
          setSigners((prev) =>
            filter === "alle" ? [...prev, ...newOnes] : [...newOnes, ...prev],
          );
          setTimeout(() => {
            setSigners((prev) =>
              prev.map((s) => (s._isNew ? { ...s, _isNew: false } : s)),
            );
          }, 2000);
        }
      } catch {}
    }, 10000);
    return () => clearInterval(interval);
  }, [filter, search, fetchStats]);

  useEffect(() => {
    if (!INVITES) return;
    const invite = readInviteLocation();
    if (!invite) return;
    // Redirect target after confirming: the new signer's own link.
    if (invite.confirmed) {
      forgetInviteRef();
      setOwnInviteCode(invite.code);
      setShowSuccess(true);
      return;
    }
    if (invite.statsToken) {
      apiFetch("/api/invite-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: invite.code, token: invite.statsToken }),
      })
        .then((res) => (res.ok ? res.json() : { invalid: true }))
        .then(setInviteStats)
        .catch(() => setInviteStats({ invalid: true }));
      return;
    }
    rememberInviteRef(invite.code);
    apiFetch(`/api/invite/${invite.code}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setInvitedBy(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("confirmed") === "1") {
      setShowSuccess(true);
      fetchStats();
      fetchSigners(filter, search, 0, false);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("deleted") === "1") {
      setShowDeleted(true);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("error") === "token-expired") {
      // Used tokens aren't kept, so a second click (or a link already opened
      // by a mail scanner) can't be told apart from an expired one. Instead of
      // "sign again", route the person through the sign form's existing check:
      // an already confirmed address gets the "already signed" mail, an
      // unconfirmed one its confirmation link again, without the page revealing
      // which.
      setSubmitError(cfg.ui.errors.tokenExpired);
      window.history.replaceState({}, "", window.location.pathname);
      requestAnimationFrame(() => {
        const field = document.getElementById("sign-name");
        field?.closest("details")?.setAttribute("open", "");
        field?.scrollIntoView({ block: "center" });
      });
    } else if (params.get("error") === "delete-token-expired") {
      setSubmitError(cfg.ui.errors.deleteTokenExpired);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const zoomOpen =
    !zoomEventAt ||
    Date.now() < new Date(zoomEventAt).getTime() + 2 * 60 * 60 * 1000;

  // "Accomplished" wind-down mode (config-driven, generic across letters).
  const successMode = Boolean(cfg.features?.successMode);
  const signingPause = cfg.features.signingPaused ? cfg.ui.signForm : null;
  const zoomEnabled = Boolean(cfg.features?.zoomEvent);
  // Only link to the outcome once a real URL is set (hide the config placeholder).
  const antragUrl = cfg.success?.antragUrl || "";
  const antragUrlValid = antragUrl && !antragUrl.startsWith("TODO");
  // Collapsed-section summary text, derived from the letter's own nav labels.
  const navLabel = (id) => cfg.nav.find((n) => n.id === id)?.label || id;
  // Which main content sections render folded into a shared <details> block
  // instead of full-height. Config-driven and independent of successMode; when
  // unset, success mode still defaults to folding the list & FAQ (backward
  // compatible). Valid ids: "brief", "unterzeichnen", "liste", "faq".
  const collapsedSections =
    cfg.features?.collapsedSections ?? (successMode ? ["liste", "faq"] : []);
  const isCollapsed = (id) => collapsedSections.includes(id);
  // In success mode the sign form is gone, so drop its nav entry and repoint the
  // primary CTA at the Zoom signup (all config-driven, generic across letters).
  const navItems = successMode
    ? cfg.nav.filter((n) => n.id !== "unterzeichnen")
    : cfg.nav;
  const zoomNavLabel = zoomNavLabelRt || "Treffen";
  const showZoomNav = zoomEnabled && zoomOpen;
  // In-person meeting location (shown in the #zoom section when mode is inperson).
  const zoomInPerson = zoomMode === "inperson";
  const zoomLocationText = [zoomLocation?.name, zoomLocation?.address]
    .filter(Boolean)
    .join(", ");
  const ctaToZoom = successMode && showZoomNav;
  const ctaLabel = ctaToZoom
    ? cfg.success?.ctaZoom || zoomNavLabel
    : signingPause?.pausedTitle;
  // Hide the header/menu CTA in success mode when there's nothing to sign up for
  // (form removed and Zoom not open); otherwise it would scroll to a gone anchor.
  const showCta = !successMode || ctaToZoom;

  // Persists deliberate user scroll so layout shifts never yank them back.
  const hashScrollAbortedRef = useRef(false);

  useEffect(() => {
    // Scroll to the hashed section and keep it pinned while the page settles.
    // The signer list (#liste, loaded async), web fonts, and images all change
    // the layout *after* the first scroll, pushing #zoom further down. A single
    // early scroll therefore lands short (on the signer list). We watch <body>
    // for any size change and re-pin to the section's true position each time,
    // until the user takes over or a time cap elapses.
    let released = false;
    let releaseTimer = null;
    let observer = null;
    let didInitialScroll = false;
    let lastTarget = null;

    const release = () => {
      released = true;
      if (releaseTimer !== null) clearTimeout(releaseTimer);
      if (observer) observer.disconnect();
    };

    const onUserInterrupt = () => {
      hashScrollAbortedRef.current = true;
      release();
    };

    const pin = () => {
      if (released || hashScrollAbortedRef.current) return;
      const id = (window.location.hash || "").slice(1);
      if (!id) return;
      const target = getScrollTarget(id);
      if (target === null) return; // not mounted yet; a later resize will retry

      if (!didInitialScroll) {
        // First sighting: animate so the user sees deliberate motion.
        didInitialScroll = true;
        lastTarget = target;
        scrollTo(id);
      } else if (lastTarget === null || Math.abs(target - lastTarget) > 1) {
        // Layout above shifted: re-pin instantly to the corrected position.
        lastTarget = target;
        window.scrollTo(0, target);
      }
    };

    const arm = () => {
      if (!window.location.hash) return;
      released = false;
      didInitialScroll = false;
      lastTarget = null;
      if (releaseTimer !== null) clearTimeout(releaseTimer);
      releaseTimer = setTimeout(release, 5000);
      if (observer && document.body) observer.observe(document.body);
      pin();
    };

    const onHashChange = () => {
      // Explicit navigation: the user wants to go here, so re-enable and restart.
      hashScrollAbortedRef.current = false;
      arm();
    };

    if (typeof ResizeObserver !== "undefined" && document.body) {
      observer = new ResizeObserver(pin);
    }
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("wheel", onUserInterrupt, { passive: true });
    window.addEventListener("touchmove", onUserInterrupt, { passive: true });
    window.addEventListener("keydown", onUserInterrupt);

    arm();

    return () => {
      release();
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("wheel", onUserInterrupt);
      window.removeEventListener("touchmove", onUserInterrupt);
      window.removeEventListener("keydown", onUserInterrupt);
    };
  }, []);

  useEffect(() => {
    setOffset(0);
    knownIdsRef.current.clear();
    fetchSigners(filter, search, 0, false);
  }, [filter, search, fetchSigners]);

  useEffect(() => {
    if (!detailsView) return;
    let ignore = false;
    setDetailGroups([]);
    (async () => {
      try {
        const functions = detailsView === "functions";
        const res = await apiFetch(
          functions ? "/api/signer-functions" : "/api/occupations",
        );
        if (res.ok) {
          const groups = await res.json();
          if (!ignore)
            setDetailGroups(
              groups.map(({ occupation, label, count }) => ({
                label: label ?? occupation,
                count,
              })),
            );
        }
      } catch {}
    })();
    return () => {
      ignore = true;
    };
  }, [detailsView]);

  useEffect(() => {
    if (!showKreisverband && !showMap) return;
    (async () => {
      try {
        const res = await apiFetch("/api/kreisverband-stats");
        if (res.ok) setKvGroups(await res.json());
      } catch {}
    })();
  }, [showKreisverband, showMap]);

  function handleLoadMore() {
    const next = offset + 18;
    setOffset(next);
    fetchSigners(filter, search, next, true);
  }

  const handleSubmit = useCallback(async (data) => {
    setSubmitError(null);
    try {
      const res = await apiFetch("/api/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          ...(INVITES && { ref: takeInviteRef() }),
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setSubmitError(result.error || cfg.ui.errors.generic);
        return false;
      }
      setEmailModal({
        name: data.name,
        email: data.email,
        kv: data.kv || "",
        occupation: data.occupation || "",
        newsletter: !!data.newsletter,
        agree: !!data.agree,
        delayed: Boolean(result.emailDelayed),
      });
      return true;
    } catch {
      setSubmitError(cfg.ui.errors.network);
      return false;
    }
  }, []);

  const handleZoomSubmit = useCallback(
    async (data) => {
      setZoomError(null);
      try {
        const res = await apiFetch("/api/zoom-register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const result = await res.json();
        if (!res.ok) {
          setZoomError(result.error || cfg.ui.errors.generic);
          return false;
        }
        fetchZoomCount();
        return true;
      } catch {
        setZoomError(cfg.ui.errors.network);
        return false;
      }
    },
    [fetchZoomCount],
  );

  useEffect(() => {
    if (!emailModal) {
      setResendCooldown(0);
      setResendSent(false);
      setResendError(null);
      return;
    }
    setResendCooldown(60);
    const id = setInterval(() => {
      setResendCooldown((c) => {
        if (c <= 1) {
          clearInterval(id);
          setResendSent(false);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [emailModal]);

  function closeModal() {
    setEmailModal(null);
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    setResendError(null);
    try {
      const res = await apiFetch("/api/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailModal.email }),
      });
      const result = await res.json();
      if (!res.ok) {
        setResendError(result.error || cfg.ui.errors.resendFailed);
        return;
      }
    } catch {
      setResendError(cfg.ui.errors.network);
      return;
    }
    setResendSent(true);
    setEmailModal((prev) => ({ ...prev }));
  }

  function closeSuccess() {
    setShowSuccess(false);
  }

  const locale = cfg.brand.locale;
  const total = stats.total;
  // Milestones are admin-editable (served via /api/stats); fall back to the
  // config seed until stats load.
  const milestones =
    stats.milestones?.length > 0 ? stats.milestones : cfg.hero.milestones;
  const nextMilestone = milestones.find((m) => m > total);
  const ZIEL = nextMilestone ?? milestones[milestones.length - 1];
  const rawPct = Math.round((total / ZIEL) * 100);
  const pct = nextMilestone ? Math.min(100, rawPct) : rawPct;

  // The Treffen signup section. In success mode it is rendered first (right after
  // the hero); otherwise it stays at the bottom of the page.
  const zoomSection =
    zoomEnabled && zoomOpen ? (
      <section
        className="section sign-section zoom-section"
        id="zoom"
        aria-label={cfg.ui.sections.zoom}
      >
        <div className="section-inner">
          <div className="sign-grid">
            <div className="sign-intro">
              {cfg.zoom?.section?.sectionNum && (
                <span className="section-num">
                  {cfg.zoom.section.sectionNum}
                </span>
              )}
              <h2
                dangerouslySetInnerHTML={{
                  __html: cfg.zoom?.section?.headingHtml || "",
                }}
              />
              {cfg.zoom?.section?.whenText && (
                <p className="zoom-when">
                  <strong>{cfg.zoom.section.whenText}</strong>
                </p>
              )}
              {zoomInPerson && zoomLocationText && (
                <p className="zoom-where">
                  <strong>{cfg.ui.zoomForm.locationLabel}</strong>{" "}
                  {zoomLocationText}
                  {zoomLocation?.mapsUrl && (
                    <>
                      {" · "}
                      <a
                        href={zoomLocation.mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {cfg.ui.zoomForm.mapLink}
                      </a>
                    </>
                  )}
                </p>
              )}
              <ul>
                {(cfg.zoom?.section?.bullets || []).map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
              {cfg.zoom?.section?.privacy && (
                <p className="privacy">{cfg.zoom.section.privacy}</p>
              )}
            </div>

            <ZoomForm
              onSubmit={handleZoomSubmit}
              serverError={zoomError}
              kvNames={signFormKvNames}
              config={cfg}
              showDelegierter={zoomShowDelegierter}
            />
          </div>
        </div>
      </section>
    ) : null;

  // --- Main content sections (config-driven collapse) -----------------------
  // Each section can render full-height, or fold into a shared <details> block.
  // The body is the exact section-inner content; collapsing only swaps the
  // shell around it. Consecutive collapsed sections merge into one bordered
  // group (like the FAQ's own stacked items); a non-collapsed section between
  // them splits the group.
  const briefBody = (
    <div className="section-inner">
      <RichLetter
        config={cfg}
        total={total}
        fallback={<LetterArticle total={total} />}
      />
    </div>
  );

  const signBody = (
    <div className="section-inner">
      <div className="sign-grid">
        <div className="sign-intro">
          <span className="section-num">{cfg.sign.sectionNum}</span>
          <h2 dangerouslySetInnerHTML={{ __html: cfg.sign.headingHtml }} />
          <ul>
            {cfg.sign.criteria.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          <p className="privacy">{cfg.sign.privacyNote}</p>
        </div>

        {signingPause ? (
          <aside className="form-card" aria-labelledby="signing-pause-title">
            <h3 id="signing-pause-title">{signingPause.pausedTitle}</h3>
            <p>{signingPause.pausedMessage}</p>
          </aside>
        ) : (
          <SignForm
            onSubmit={handleSubmit}
            serverError={submitError}
            notice={
              !preview && boot?.email?.ready === false
                ? cfg.ui.signForm.emailDelayed
                : null
            }
            kvNames={signFormKvNames}
            occNames={signFormOccNames}
          />
        )}
      </div>
    </div>
  );

  const listeBody = (
    <div className="section-inner">
      <div className="signers-head">
        <div>
          <span className="section-num">{cfg.list.sectionNum}</span>
          <h2
            dangerouslySetInnerHTML={{
              __html: cfg.list.headingHtml.replace(
                "{count}",
                total.toLocaleString(locale),
              ),
            }}
          />
        </div>
        <div className="total">
          <b>+{stats.today}</b> {cfg.ui.list.last24h}
        </div>
      </div>

      <div className="stats-row">
        <div className="stat">
          <div className="v">{total.toLocaleString("de-DE")}</div>
          <div className="k">{cfg.ui.list.statTotal}</div>
        </div>
        <div className="stat">
          <div className="v">+{stats.today}</div>
          <div className="k">{cfg.ui.list.statToday}</div>
        </div>
        <div className="stat">
          <div className="v">+{stats.week}</div>
          <div className="k">{cfg.ui.list.statWeek}</div>
        </div>
        {cfg.features.kreisverbandField && (
          <div className="stat">
            <div className="v">{stats.kvCount}</div>
            <div className="k">{region().plural}</div>
          </div>
        )}
      </div>

      <div className="filters" role="group" aria-label={cfg.ui.list.filterAria}>
        <button
          className={
            "filter-chip " +
            (!detailsView && !showKreisverband && !showMap && filter === "alle"
              ? "active"
              : "")
          }
          aria-pressed={
            !detailsView && !showKreisverband && !showMap && filter === "alle"
          }
          onClick={() => {
            setDetailsView(null);
            setShowKreisverband(false);
            setShowMap(false);
            setFilter("alle");
          }}
        >
          {cfg.ui.list.filterAll}
        </button>
        <button
          className={
            "filter-chip " +
            (!detailsView &&
            !showKreisverband &&
            !showMap &&
            filter === "neueste"
              ? "active"
              : "")
          }
          aria-pressed={
            !detailsView &&
            !showKreisverband &&
            !showMap &&
            filter === "neueste"
          }
          onClick={() => {
            setDetailsView(null);
            setShowKreisverband(false);
            setShowMap(false);
            setFilter("neueste");
          }}
        >
          {cfg.ui.list.filterNewest}
        </button>
        {cfg.features.germanyMap && (
          <button
            className={"filter-chip " + (showMap ? "active" : "")}
            aria-pressed={showMap}
            onClick={() => {
              setDetailsView(null);
              setShowKreisverband(false);
              setShowMap((v) => !v);
            }}
          >
            {cfg.ui.list.filterMap}
          </button>
        )}
        {cfg.features.kreisverbandField && (
          <button
            className={"filter-chip " + (showKreisverband ? "active" : "")}
            onClick={() => {
              setDetailsView(null);
              setShowMap(false);
              setShowKreisverband((v) => !v);
            }}
            aria-pressed={showKreisverband}
          >
            {region().plural}
          </button>
        )}
        {[
          [
            "organisations",
            cfg.features.occupationField && cfg.ui.list.filterOccupations,
          ],
          ["functions", cfg.sign.fields.signerFunction?.filterLabel],
        ]
          .filter(([, label]) => label)
          .map(([view, label]) => (
            <button
              key={view}
              className={
                "filter-chip " + (detailsView === view ? "active" : "")
              }
              onClick={() => {
                setShowKreisverband(false);
                setShowMap(false);
                setDetailsView((current) => (current === view ? null : view));
              }}
              aria-pressed={detailsView === view}
            >
              {label}
            </button>
          ))}
        {!detailsView && !showKreisverband && !showMap && (
          <>
            <label htmlFor="signer-search" className="sr-only">
              {fillText(cfg.ui.list.searchLabel, { region: region().name })}
            </label>
            <input
              id="signer-search"
              className="search"
              placeholder={fillText(cfg.ui.list.searchPlaceholder, {
                region: region().name,
              })}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </>
        )}
      </div>

      {error && (
        <p className="alert-error" role="alert">
          {error}
        </p>
      )}

      {showMap ? (
        kvGroups.length === 0 ? (
          <div className="empty-state">{cfg.ui.list.loadingMap}</div>
        ) : (
          <KreisverbandMap kvGroups={kvGroups} />
        )
      ) : showKreisverband ? (
        kvGroups.length === 0 ? (
          <div className="empty-state">
            {fillText(cfg.ui.list.emptyRegions, { regions: region().plural })}
          </div>
        ) : (
          <div className="occupation-grid">
            {kvGroups.map((g) => (
              <div key={g.kreisverband} className="occupation-chip">
                <span className="occupation-name">
                  {g.kreisverband === KV_NONE ? region().none : g.kreisverband}
                </span>
                <span className="occupation-count">{g.count}</span>
              </div>
            ))}
          </div>
        )
      ) : detailsView ? (
        detailGroups.length === 0 ? (
          <div className="empty-state">
            {detailsView === "functions"
              ? cfg.sign.fields.signerFunction.emptyLabel
              : cfg.ui.list.emptyOccupations}
          </div>
        ) : (
          <div className="occupation-grid">
            {detailGroups.map((g) => (
              <div key={g.label} className="occupation-chip">
                <span className="occupation-name">{g.label}</span>
                <span className="occupation-count">{g.count}</span>
              </div>
            ))}
          </div>
        )
      ) : loading && signers.length === 0 ? (
        <div className="empty-state">{cfg.ui.list.loading}</div>
      ) : (
        <>
          <div className="signers-grid">
            {signers.map((s) => (
              <SignerRow
                key={signerKey(s)}
                name={s.name}
                kreisverband={s.kreisverband}
                signerFunction={s.signerFunction}
                organisation={s.organisation}
                firstSigner={s.firstSigner}
                createdAt={s.created_at}
                isNew={s._isNew}
              />
            ))}
          </div>

          <div className="signers-foot">
            <span>
              {fillText(cfg.ui.list.shown, {
                shown: signers.length,
                total: signersTotal.toLocaleString(locale),
              })}
            </span>
            {signers.length < signersTotal && (
              <button onClick={handleLoadMore}>{cfg.ui.list.loadMore}</button>
            )}
          </div>
        </>
      )}
    </div>
  );

  const faqBody = (
    <div className="section-inner">
      <RichFaq config={cfg} fallback={<FaqContent />} />
    </div>
  );

  const contentSectionDefs = [
    {
      id: "brief",
      shouldRender: true,
      sectionClass: "",
      ariaLabel: cfg.ui.sections.brief,
      body: briefBody,
    },
    {
      id: "unterzeichnen",
      shouldRender: !successMode,
      sectionClass: "sign-section",
      ariaLabel: cfg.ui.sections.sign,
      body: signBody,
    },
    {
      id: "liste",
      shouldRender: true,
      sectionClass: "signers-section",
      ariaLabel: cfg.ui.sections.list,
      body: listeBody,
    },
    {
      id: "faq",
      shouldRender: true,
      sectionClass: "faq-section",
      ariaLabel: cfg.ui.sections.faq,
      body: faqBody,
    },
  ];

  const layout = layoutFor(cfg);
  const runtimeSections = {
    header: (
      <Popover.Root open={navOpen} onOpenChange={setNavOpen}>
        <header
          className={
            "topbar" +
            (showCta ? "" : " topbar--no-cta") +
            (LANGUAGES.length > 1 ? " topbar--langs" : "")
          }
        >
          <a
            href="#main"
            className="wordmark"
            aria-label={cfg.ui.chrome.toTop}
            onClick={(e) => {
              e.preventDefault();
              scrollTo("main");
            }}
          >
            <span className="dot" aria-hidden="true"></span>{" "}
            {cfg.brand.wordmark}
          </a>
          <nav aria-label={cfg.ui.chrome.mainNav}>
            {navItems.map((n) => (
              <a
                key={n.id}
                href={`#${n.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  scrollTo(n.id);
                }}
              >
                {n.label}
              </a>
            ))}
            {
              /* zoom module: toggle via features.zoomEvent */ showZoomNav && (
                <a
                  href="#zoom"
                  onClick={(e) => {
                    e.preventDefault();
                    scrollTo("zoom");
                  }}
                >
                  {zoomNavLabel}
                </a>
              )
            }
          </nav>
          <LanguageSwitch />
          {showCta && (
            <button
              className="cta topbar-cta"
              onClick={() => scrollTo(ctaToZoom ? "zoom" : "unterzeichnen")}
            >
              {ctaLabel || cfg.navCta} <span aria-hidden="true">→</span>
            </button>
          )}
          <Popover.Trigger
            className={"hamburger" + (navOpen ? " open" : "")}
            aria-label={
              navOpen ? cfg.ui.chrome.menuClose : cfg.ui.chrome.menuOpen
            }
            aria-expanded={navOpen}
            aria-controls="mobile-nav"
          >
            <span></span>
            <span></span>
            <span></span>
          </Popover.Trigger>
        </header>
        <Popover.Portal>
          <Popover.Positioner className="mobile-nav-positioner" sideOffset={8}>
            <Popover.Popup
              render={<nav />}
              id="mobile-nav"
              className={"mobile-nav" + (navOpen ? " open" : "")}
              aria-label={cfg.ui.chrome.mobileNav}
              aria-hidden={!navOpen}
            >
              {navItems.map((n) => (
                <a
                  key={n.id}
                  href={`#${n.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setNavOpen(false);
                    scrollTo(n.id);
                  }}
                >
                  {n.label}
                </a>
              ))}
              {
                /* zoom module: toggle via features.zoomEvent */ showZoomNav && (
                  <a
                    href="#zoom"
                    onClick={(e) => {
                      e.preventDefault();
                      setNavOpen(false);
                      scrollTo("zoom");
                    }}
                  >
                    {zoomNavLabel}
                  </a>
                )
              }
              {showCta && (
                <a
                  href={ctaToZoom ? "#zoom" : "#unterzeichnen"}
                  className="mobile-nav-cta"
                  onClick={(e) => {
                    e.preventDefault();
                    setNavOpen(false);
                    scrollTo(ctaToZoom ? "zoom" : "unterzeichnen");
                  }}
                >
                  {ctaLabel || cfg.hero.ctaPrimary}{" "}
                  <span aria-hidden="true">→</span>
                </a>
              )}
              <LanguageSwitch />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    ),
    hero: (
      <>
        <section
          className="hero"
          aria-label={
            successMode ? cfg.ui.hero.ariaSuccess : cfg.ui.hero.ariaCampaign
          }
        >
          <div className="hero-inner">
            {successMode ? (
              <div className="hero-success">
                {cfg.success?.kicker && (
                  <span className="success-kicker">{cfg.success.kicker}</span>
                )}
                <Headline
                  lines={cfg.success?.headlineLines}
                  text={cfg.success?.headline}
                />
                {cfg.success?.countLabel && (
                  <div
                    className="counter-card hero-success-card"
                    aria-label={`${total.toLocaleString(locale)} ${cfg.success.countLabel}`}
                  >
                    <div className="num">{total.toLocaleString(locale)}</div>
                    <div className="meta">{cfg.success.countLabel}</div>
                  </div>
                )}
                <div className="hero-success-cta">
                  {cfg.success?.body && (
                    <p className="hero-success-body">{cfg.success.body}</p>
                  )}
                  <div className="hero-actions">
                    {zoomEnabled && zoomOpen && (
                      <button
                        className="scrollcta"
                        onClick={() => scrollTo("zoom")}
                      >
                        {cfg.success?.ctaZoom || cfg.ui.hero.successCtaFallback}{" "}
                        <span aria-hidden="true">→</span>
                      </button>
                    )}
                    {antragUrlValid && (
                      <a
                        className="scrollcta scrollcta--secondary"
                        href={antragUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {cfg.success?.antragLabel ||
                          cfg.ui.hero.successAntragFallback}{" "}
                        <span aria-hidden="true">→</span>
                      </a>
                    )}
                    <button
                      className="scrollcta scrollcta--secondary"
                      onClick={() => scrollTo("brief")}
                    >
                      {cfg.hero.ctaSecondary}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {cfg.hero.kicker && (
                  <p className="hero-kicker">{cfg.hero.kicker}</p>
                )}
                <Headline lines={cfg.hero.headlineLines} />
                {cfg.hero.description && (
                  <p className="hero-description">{cfg.hero.description}</p>
                )}
                {cfg.hero.artwork && (
                  <figure className="hero-artwork">
                    <img
                      src={cfg.hero.artwork.src}
                      alt={cfg.hero.artwork.alt}
                      width={cfg.hero.artwork.width}
                      height={cfg.hero.artwork.height}
                    />
                  </figure>
                )}

                <div className="hero-row">
                  <div className="counter-wrap">
                    <div
                      className="counter-card"
                      aria-label={fillText(cfg.ui.hero.counterAria, {
                        total: total.toLocaleString(locale),
                        goal: ZIEL.toLocaleString(locale),
                      })}
                    >
                      <div className="label">{cfg.hero.counterLabel}</div>
                      <div className="num">
                        {total.toLocaleString(locale)}
                        <span className="unit">
                          / {ZIEL.toLocaleString(locale)}
                        </span>
                      </div>
                      <div className="meta">
                        {cfg.hero.goalLabelPrefix} {ZIEL.toLocaleString(locale)}{" "}
                        {cfg.hero.goalMetaLabel}
                      </div>
                      <div
                        className="goal-bar"
                        role="progressbar"
                        aria-label={cfg.ui.hero.progressAria}
                        aria-valuenow={Math.min(100, pct)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        style={{ "--progress": pct / 100 }}
                      >
                        <div></div>
                      </div>
                      <div className="goal-meta">
                        <span>{fillText(cfg.ui.hero.reached, { pct })}</span>
                        <span>
                          {fillText(cfg.ui.hero.updated, {
                            time: new Date().toLocaleTimeString(locale, {
                              hour: "2-digit",
                              minute: "2-digit",
                            }),
                          })}
                        </span>
                      </div>
                    </div>

                    {
                      /* zoom module: toggle via features.zoomEvent */ zoomEnabled &&
                        cfg.ui.stoerer.showFrom > 0 &&
                        total >= cfg.ui.stoerer.showFrom &&
                        zoomOpen && (
                          <button
                            className="stoerer"
                            onClick={() => scrollTo("zoom")}
                            aria-label={cfg.ui.stoerer.aria}
                          >
                            <span className="stoerer-head">
                              {fillText(cfg.ui.stoerer.head, {
                                count:
                                  cfg.ui.stoerer.showFrom.toLocaleString(
                                    locale,
                                  ),
                              })}
                            </span>
                            <span className="stoerer-body">
                              {cfg.ui.stoerer.body}
                            </span>
                            <span className="stoerer-cta">
                              {cfg.ui.stoerer.cta}{" "}
                              <span aria-hidden="true">→</span>
                            </span>
                          </button>
                        )
                    }
                  </div>

                  <div className="hero-actions">
                    <button
                      className="scrollcta"
                      onClick={() => scrollTo("unterzeichnen")}
                    >
                      {ctaLabel || cfg.hero.ctaPrimary}{" "}
                      <span aria-hidden="true">→</span>
                    </button>
                    <button
                      className="scrollcta scrollcta--secondary"
                      onClick={() => scrollTo("brief")}
                    >
                      {cfg.hero.ctaSecondary}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      </>
    ),
    footer: (
      <>
        <footer>
          <div className="footer-inner">
            <div className="footer-top">
              <div>
                <h3>{cfg.footer.heading}</h3>
                <p>{cfg.footer.blurb}</p>
              </div>
              <div>
                <h3>{cfg.ui.chrome.footerContact}</h3>
                <a href={`mailto:${cfg.footer.contactEmail}`}>
                  {cfg.footer.contactEmail}
                </a>
              </div>
              <div>
                <h3>{cfg.ui.chrome.footerLegal}</h3>
                <button
                  type="button"
                  className="footer-link"
                  onClick={() => setShowImpressum(true)}
                >
                  {cfg.ui.chrome.impressum}
                </button>
                <button
                  type="button"
                  className="footer-link"
                  onClick={() => setShowDatenschutz(true)}
                >
                  {cfg.ui.chrome.datenschutz}
                </button>
              </div>
            </div>
          </div>
        </footer>
      </>
    ),
    zoom: zoomSection,
    ...Object.fromEntries(
      contentSectionDefs.map((s) => [
        s.id,
        s.shouldRender ? (
          isCollapsed(s.id) ? (
            <section className="section">
              <details className="section-collapse" id={s.id}>
                <summary className="section-collapse-summary">
                  {navLabel(s.id)}
                </summary>
                {s.body}
              </details>
            </section>
          ) : (
            <section
              className={`section ${s.sectionClass}`}
              id={s.id}
              aria-label={s.ariaLabel}
            >
              {s.body}
            </section>
          )
        ) : null,
      ]),
    ),
  };
  const renderBlock = (block) => (
    <Section
      key={block.props.id}
      block={block}
      config={cfg}
      body={runtimeSections[block.props.id]}
    />
  );
  if (onlySection) {
    const block = layout.content.find((b) => b.props.id === onlySection);
    return block ? (
      <CampaignConfig.Provider value={cfg}>
        <CampaignApi.Provider value={apiFetch}>
          {renderBlock(block)}
        </CampaignApi.Provider>
      </CampaignConfig.Provider>
    ) : null;
  }

  return (
    <CampaignConfig.Provider value={cfg}>
      <CampaignApi.Provider value={apiFetch}>
        <a href="#main" className="skip-link">
          {cfg.ui.chrome.skipLink}
        </a>

        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {total.toLocaleString(locale)} {cfg.hero.counterLabel}
        </div>

        {renderBlock(layout.content[0])}

        <main id="main">{layout.content.slice(1, -1).map(renderBlock)}</main>

        {renderBlock(layout.content.at(-1))}

        {emailModal && (
          <Modal onClose={closeModal} labelledBy="email-modal-title">
            <div
              className="modal"
              aria-labelledby="email-modal-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-head">
                <h3 id="email-modal-title">
                  {emailModal.delayed
                    ? cfg.ui.emailModal.delayedTitle
                    : cfg.ui.emailModal.title}
                </h3>
                <button onClick={closeModal} aria-label={cfg.ui.chrome.close}>
                  ×
                </button>
              </div>
              <div className="modal-body">
                <p>
                  {fillText(
                    emailModal.delayed
                      ? cfg.ui.emailModal.delayedSent
                      : cfg.ui.emailModal.sent,
                    { name: emailModal.name },
                  )}
                </p>
                <div className="email-pill">{emailModal.email}</div>

                <p>{cfg.ui.emailModal.explain}</p>
                {emailModal.delayed ? (
                  <p className="hint">
                    {fillText(cfg.ui.emailModal.delayedHint, {
                      hours: resolvePrivacy(cfg).confirmationLinkHours,
                    })}
                  </p>
                ) : (
                  <>
                    <p className="hint">{cfg.ui.emailModal.spamHint}</p>
                    <p className="hint">{cfg.ui.emailModal.delayHint}</p>
                    {resendError && (
                      <p className="hint hint--error">{resendError}</p>
                    )}
                    <button
                      className="resend-btn"
                      onClick={handleResend}
                      disabled={resendCooldown > 0}
                    >
                      {resendSent && resendCooldown > 0
                        ? fillText(cfg.ui.emailModal.resendSent, {
                            seconds: resendCooldown,
                          })
                        : resendCooldown > 0
                          ? fillText(cfg.ui.emailModal.resendWait, {
                              seconds: resendCooldown,
                            })
                          : cfg.ui.emailModal.resend}
                    </button>
                  </>
                )}
                <button className="confirm-btn" onClick={closeModal}>
                  {cfg.ui.emailModal.ok}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {showSuccess && (
          <Modal onClose={closeSuccess} labelledBy="success-modal-title">
            <div
              className="modal success"
              aria-labelledby="success-modal-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-head">
                <h3 id="success-modal-title">{cfg.ui.successModal.title}</h3>
                <button onClick={closeSuccess} aria-label={cfg.ui.chrome.close}>
                  ×
                </button>
              </div>
              <div className="modal-body">
                <div className="check-anim">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
                <p className="success-title">{cfg.ui.successModal.heading}</p>
                <p>
                  {fillText(cfg.ui.successModal.body, {
                    goal: ZIEL.toLocaleString(locale),
                  })}
                </p>
                {ownInviteCode && <InviteShare code={ownInviteCode} />}
                <button
                  className="confirm-btn confirm-btn--accent"
                  onClick={() => {
                    closeSuccess();
                    scrollTo("liste");
                  }}
                >
                  {cfg.ui.successModal.showMe} <span aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          </Modal>
        )}

        {invitedBy && (
          <InviteModal
            firstName={invitedBy.firstName}
            onClose={() => setInvitedBy(null)}
          />
        )}

        {inviteStats && (
          <InviteStatsModal
            result={inviteStats}
            onClose={() => setInviteStats(null)}
          />
        )}

        {showDeleted && (
          <Modal
            onClose={() => setShowDeleted(false)}
            labelledBy="deleted-modal-title"
          >
            <div
              className="modal success"
              aria-labelledby="deleted-modal-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-head">
                <h3 id="deleted-modal-title">{cfg.ui.deletedModal.title}</h3>
                <button
                  onClick={() => setShowDeleted(false)}
                  aria-label={cfg.ui.chrome.close}
                >
                  ×
                </button>
              </div>
              <div className="modal-body">
                <div className="check-anim">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
                <p className="success-title">{cfg.ui.deletedModal.heading}</p>
                <p>{cfg.ui.deletedModal.body}</p>
                <button
                  className="confirm-btn"
                  onClick={() => setShowDeleted(false)}
                >
                  {cfg.ui.chrome.close}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {showImpressum && (
          <ImpressumModal onClose={() => setShowImpressum(false)} />
        )}

        {showDatenschutz && (
          <DatenschutzModal onClose={() => setShowDatenschutz(false)} />
        )}
      </CampaignApi.Provider>
    </CampaignConfig.Provider>
  );
}

const SignerRow = memo(function SignerRow({
  name,
  kreisverband,
  signerFunction,
  organisation,
  firstSigner,
  createdAt,
  isNew,
}) {
  const cfg = useCampaignConfig();
  const region = regionLabels(cfg);
  const showsDetails =
    cfg.features.publicFirstSignerDetails || cfg.features.publicSignerDetails;
  const details = showsDetails
    ? [signerFunction, organisation].filter(Boolean).join(" · ")
    : "";
  // On a letter that shows function and organisation, a row without them
  // names the region only if the letter asks for one.
  const regionLine =
    cfg.features.kreisverbandField || !showsDetails
      ? kreisverband
        ? region.rowPrefix + kreisverband
        : region.none
      : "";
  const subtitle = details || regionLine;
  const kvClass = details ? "kv kv-details" : "kv";
  return (
    <div className={"signer" + (isNew ? " new" : "")}>
      <div className="avatar">{initials(name)}</div>
      <div className="info">
        <div className="name">{name}</div>
        {firstSigner ? (
          <div className={kvClass}>
            <span className="first-signer-label">
              {cfg.ui.list.firstSigner}
            </span>
            {subtitle && ` · ${subtitle}`}
          </div>
        ) : (
          subtitle && <div className={kvClass}>{subtitle}</div>
        )}
      </div>
      <div className="time">{relTime(createdAt)}</div>
    </div>
  );
});

const SignForm = memo(function SignForm({
  onSubmit,
  serverError,
  notice,
  kvNames,
  occNames,
}) {
  const cfg = useCampaignConfig();
  const INVITES = Boolean(cfg.features.inviteLinks);
  const region = () => regionLabels(cfg);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [kv, setKv] = useState("");
  const [occupation, setOccupation] = useState("");
  const [signerFunction, setSignerFunction] = useState("");
  const functionField = cfg.sign.fields.signerFunction;
  const [visibility, setVisibility] = useState("private");
  const [newsletter, setNewsletter] = useState(false);
  const [inviteShowName, setInviteShowName] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef(null);
  const emailRef = useRef(null);

  const visibilityFields = [
    cfg.features.kreisverbandField && cfg.sign.fields.kreisverband.label,
    cfg.features.occupationField &&
      !functionField &&
      cfg.sign.fields.occupation.label,
  ].filter(Boolean);
  const visibilityExtra = visibilityFields.length
    ? fillText(cfg.ui.signForm.publicFieldsExtra, {
        fields: visibilityFields.join("/"),
      })
    : "";

  function validate() {
    const e = {};
    if (name.trim().length < 2) e.name = cfg.ui.signForm.errName;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      e.email = cfg.ui.signForm.errEmail;
    setErrors(e);
    if (e.name) nameRef.current?.focus();
    else if (e.email) emailRef.current?.focus();
    return Object.keys(e).length === 0;
  }

  async function submit(e) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    const ok = await onSubmit({
      name: name.trim(),
      email: email.trim(),
      kv: kv.trim().replace(/^KV\s*/i, ""),
      occupation: occupation.trim(),
      ...(functionField && { signerFunction: signerFunction.trim() }),
      newsletter,
      agree: visibility !== "private",
      ...(cfg.features.publicSignerDetails && {
        showSignerDetails: visibility === "details",
      }),
      ...(INVITES && { inviteShowName }),
    });
    setSubmitting(false);
    if (!ok) return;
    setName("");
    setEmail("");
    setKv("");
    setOccupation("");
    setSignerFunction("");
    setVisibility("private");
    setNewsletter(false);
    setInviteShowName(false);
    setErrors({});
  }

  return (
    <form className="form-card" onSubmit={submit} noValidate>
      <span className="badge">{cfg.ui.signForm.badge}</span>
      <h3>{cfg.sign.formTitle || "Unterschreiben in 30 Sekunden"}</h3>
      <div className="sub2">
        {cfg.sign.formSubtitle ||
          "Felder ausfüllen, bestätigen per E-Mail. Fertig."}
      </div>

      {notice && (
        <div className="form-notice" role="status">
          {notice}
        </div>
      )}
      {serverError && (
        <div className="err" role="alert">
          {serverError}
        </div>
      )}

      <div className="field">
        <label htmlFor="sign-name">
          {cfg.ui.signForm.nameLabel}{" "}
          {!cfg.features.publicSignerDetails && (
            <span className="opt"> {cfg.ui.signForm.nameHint}</span>
          )}
        </label>
        <input
          id="sign-name"
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={cfg.ui.signForm.namePlaceholder}
          className={errors.name ? "invalid" : ""}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "err-name" : undefined}
          autoComplete="name"
        />
        {errors.name && (
          <div className="err" id="err-name">
            {errors.name}
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor="sign-email">
          {cfg.ui.signForm.emailLabel}{" "}
          <span className="opt"> {cfg.ui.signForm.emailHint}</span>
        </label>
        <input
          id="sign-email"
          ref={emailRef}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={cfg.ui.signForm.emailPlaceholder}
          className={errors.email ? "invalid" : ""}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "err-email" : undefined}
          autoComplete="email"
        />
        {errors.email && (
          <div className="err" id="err-email">
            {errors.email}
          </div>
        )}
      </div>

      {cfg.features.kreisverbandField && (
        <div className="field field--relative">
          <label htmlFor="sign-kv">
            {cfg.sign.fields.kreisverband.label}{" "}
            <span className="opt">
              {cfg.sign.fields.kreisverband.optionalLabel}
            </span>
          </label>
          {region().options ? (
            <Choice
              label={cfg.sign.fields.kreisverband.label}
              value={kv}
              onChange={setKv}
              options={[
                ["", region().selectPlaceholder],
                ...region().options.map((v) => [v, v]),
              ]}
            />
          ) : (
            <FreeTextChoice
              id="sign-kv"
              value={kv}
              onChange={setKv}
              items={kvNames}
              placeholder={cfg.sign.fields.kreisverband.placeholder}
            />
          )}
        </div>
      )}

      {cfg.features.occupationField && (
        <div className="field field--relative">
          <label htmlFor="sign-occupation">
            {cfg.sign.fields.occupation.label}{" "}
            <span className="opt">
              {cfg.sign.fields.occupation.optionalLabel}
            </span>
          </label>
          <FreeTextChoice
            id="sign-occupation"
            value={occupation}
            onChange={setOccupation}
            items={occNames}
            placeholder={cfg.sign.fields.occupation.placeholder}
            maxLength={functionField ? SIGNER_DETAIL_LIMIT : undefined}
          />
        </div>
      )}

      {functionField && (
        <div className="field">
          <label htmlFor="sign-function">
            {functionField.label}{" "}
            <span className="opt">{functionField.optionalLabel}</span>
          </label>
          <input
            id="sign-function"
            type="text"
            value={signerFunction}
            onChange={(event) => setSignerFunction(event.target.value)}
            placeholder={functionField.placeholder}
            maxLength={SIGNER_DETAIL_LIMIT}
          />
        </div>
      )}

      <div className="checks">
        {cfg.features.publicSignerDetails ? (
          <fieldset className="sign-visibility">
            <legend>{cfg.ui.signForm.visibilityLegend}</legend>
            {[
              ["private", cfg.ui.signForm.visibilityPrivate],
              ["name", cfg.ui.signForm.visibilityName],
              ["details", cfg.sign.publicDetailsLabel],
            ].map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="sign-visibility"
                  value={value}
                  checked={visibility === value}
                  onChange={() => setVisibility(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <label className="check">
            <input
              type="checkbox"
              checked={visibility === "name"}
              onChange={(e) =>
                setVisibility(e.target.checked ? "name" : "private")
              }
            />
            <span>
              {fillText(cfg.ui.signForm.publicLabel, {
                fields: visibilityExtra,
              })}{" "}
              <span className="opt">{cfg.ui.signForm.optional}</span>
            </span>
          </label>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={newsletter}
            onChange={(e) => setNewsletter(e.target.checked)}
          />
          <span>{cfg.ui.signForm.newsletterLabel}</span>
        </label>
        {INVITES && (
          <label className="check">
            <input
              type="checkbox"
              checked={inviteShowName}
              onChange={(e) => setInviteShowName(e.target.checked)}
            />
            <span>
              {inviteOptInLabel()}{" "}
              <span className="opt">{cfg.ui.signForm.optional}</span>
            </span>
          </label>
        )}
      </div>

      <button type="submit" className="submit" disabled={submitting}>
        {submitting ? cfg.ui.signForm.submitting : cfg.hero.ctaPrimary}{" "}
        <span className="arrow" aria-hidden="true">
          →
        </span>
      </button>
      <p className="form-legal">{cfg.ui.signForm.legal}</p>
    </form>
  );
});

// The ZoomForm component lives in ./ZoomForm.jsx and is imported at the top of
// this file; it renders in the #zoom section when features.zoomEvent is on.

const STATE_CLUSTERS = [
  { id: "nrw", label: "NRW", state: "Nordrhein-Westfalen", center: [55, 230] },
  {
    id: "bawue",
    label: "Baden-Württemberg",
    state: "Baden-Württemberg",
    center: [125, 420],
  },
  { id: "bayern", label: "Bayern", state: "Bayern", center: [230, 395] },
  {
    id: "niedersachsen",
    label: "Niedersachsen",
    state: "Niedersachsen",
    center: [150, 165],
  },
  { id: "hessen", label: "Hessen", state: "Hessen", center: [128, 295] },
  { id: "sachsen", label: "Sachsen", state: "Sachsen", center: [305, 260] },
  { id: "berlin", label: "Berlin", state: "Berlin", center: [323, 163] },
  {
    id: "brandenburg",
    label: "Brandenburg",
    state: "Brandenburg",
    center: [290, 185],
  },
  { id: "hamburg", label: "Hamburg", state: "Hamburg", center: [179, 98] },
  { id: "bremen", label: "Bremen", state: "Bremen", center: [128, 128] },
  {
    id: "sh",
    label: "Schleswig-Holstein",
    state: "Schleswig-Holstein",
    center: [175, 48],
  },
  {
    id: "thueringen",
    label: "Thüringen",
    state: "Thüringen",
    center: [228, 270],
  },
  {
    id: "sachsen-anhalt",
    label: "Sachsen-Anhalt",
    state: "Sachsen-Anhalt",
    center: [255, 205],
  },
  {
    id: "mv",
    label: "Meckl.-Vorpommern",
    state: "Mecklenburg-Vorpommern",
    center: [268, 64],
  },
  {
    id: "rlp",
    label: "Rheinland-Pfalz",
    state: "Rheinland-Pfalz",
    center: [97, 323],
  },
  { id: "saarland", label: "Saarland", state: "Saarland", center: [51, 371] },
];

const STATE_TO_CLUSTER = Object.fromEntries(
  STATE_CLUSTERS.map((cl) => [cl.state, cl.id]),
);

function chipPos(name, count, coords) {
  const [cx, cy] = coords || [0, 0];
  const CHIP_H = 16;
  const nameW = name.length * 5 + 23;
  const countW = Math.max(String(count).length * 4.5 + 10, 13);
  const chipW = nameW + countW;
  const chipX =
    cx < 180 ? cx - 16 : cx > 280 ? cx - chipW + 16 : cx - chipW / 2;
  const chipY = cy - CHIP_H / 2;
  return { name, count, cx, cy, x: chipX, y: chipY, w: chipW, h: CHIP_H };
}

function nudgeChips(chips, maxNudge = 150) {
  const GAP = 10;
  const placed = [];
  for (const chip of chips) {
    const overlaps = (ty) =>
      placed.some(
        (p) =>
          chip.x < p.x + p.w + GAP &&
          chip.x + chip.w + GAP > p.x &&
          ty < p.y + p.h + GAP &&
          ty + chip.h + GAP > p.y,
      );
    if (!overlaps(chip.y)) {
      placed.push(chip);
      continue;
    }
    let bestUp = null;
    let bestDown = null;
    for (let dy = 1; dy <= maxNudge; dy++) {
      if (bestUp === null && !overlaps(chip.y - dy)) bestUp = chip.y - dy;
      if (bestDown === null && !overlaps(chip.y + dy)) bestDown = chip.y + dy;
      if (bestUp !== null && bestDown !== null) break;
    }
    const distUp = bestUp !== null ? Math.abs(chip.y - bestUp) : Infinity;
    const distDown = bestDown !== null ? Math.abs(chip.y - bestDown) : Infinity;
    chip.y = distUp <= distDown ? bestUp : bestDown;
    placed.push(chip);
  }
  return chips;
}

function KreisverbandMap({ kvGroups }) {
  const cfg = useCampaignConfig();
  const region = () => regionLabels(cfg);
  const mapData = useMemo(() => {
    const stateCounts = {};
    const stateKvs = {};
    const unmapped = [];
    let ohneCount = 0;
    let total = 0;
    for (const g of kvGroups) {
      total += g.count;
      if (g.kreisverband === KV_NONE) {
        ohneCount = g.count;
        continue;
      }
      const clusterId = g.state ? STATE_TO_CLUSTER[g.state] : null;
      if (clusterId) {
        stateCounts[clusterId] = (stateCounts[clusterId] || 0) + g.count;
        if (!stateKvs[clusterId]) stateKvs[clusterId] = [];
        stateKvs[clusterId].push({ city: g.kreisverband, count: g.count });
      } else {
        unmapped.push(g);
      }
    }
    return { stateCounts, stateKvs, unmapped, ohneCount, total };
  }, [kvGroups]);

  const [popup, setPopup] = useState(null);
  const [popupAtBottom, setPopupAtBottom] = useState(false);
  useEffect(() => {
    setPopupAtBottom(false);
  }, [popup]);

  const wrapRef = useRef(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, []);

  const clusterData = useMemo(() => {
    return STATE_CLUSTERS.filter((cl) => mapData.stateCounts[cl.id] > 0).map(
      (cl) => ({
        ...cl,
        members: (mapData.stateKvs[cl.id] || []).sort(
          (a, b) => b.count - a.count,
        ),
        total: mapData.stateCounts[cl.id],
      }),
    );
  }, [mapData]);

  const chips = useMemo(() => {
    const list = clusterData.map((cl) => {
      return {
        ...chipPos(cl.label, cl.total, cl.center),
        id: cl.id,
        isSolo: false,
      };
    });
    return nudgeChips(list);
  }, [clusterData]);

  function handleClusterClick(chip, triggerEl) {
    const cl = clusterData.find((c) => c.id === chip.id);
    if (!cl) return;
    // Anchor to the rendered chip rect (chipPos offsets + nudgeChips shifts),
    // not the raw state center. Chips in the upper part of the map open the
    // popup below themselves so it can't escape the scroll container.
    const below = (chip.y - MAP_VB.y) / MAP_VB.h < 0.35;
    const anchorX = chip.x + chip.w / 2;
    const anchorY = below ? chip.y + chip.h + 8 : chip.y;
    setPopup({
      id: cl.id,
      label: cl.label,
      total: cl.total,
      members: cl.members,
      below,
      x: `${((anchorX - MAP_VB.x) / MAP_VB.w) * 100}%`,
      y: `${((anchorY - MAP_VB.y) / MAP_VB.h) * 100}%`,
    });
  }

  return (
    <Popover.Root
      open={Boolean(popup)}
      onOpenChange={(open) => {
        if (!open) setPopup(null);
      }}
    >
      <div className="kv-map-wrap">
        <div className="kv-map-scroll" ref={wrapRef}>
          <div className="kv-map-content" onClick={() => setPopup(null)}>
            <svg
              viewBox={`${MAP_VB.x} ${MAP_VB.y} ${MAP_VB.w} ${MAP_VB.h}`}
              className="kv-map"
              role="group"
              aria-label={cfg.ui.list.showMap || cfg.ui.list.mapPopupAria}
              onClick={() => setPopup(null)}
            >
              <path d={GERMANY_PATH} className="kv-map-outline" />
              {chips.map((chip) => (
                <g key={chip.id} className="kv-map-marker">
                  <foreignObject
                    x={chip.x}
                    y={chip.y}
                    width={chip.w + 8}
                    height={chip.h + 8}
                    className="kv-map-foreign"
                  >
                    <Popover.Trigger
                      type="button"
                      className={
                        "occupation-chip occupation-chip--map occupation-chip--cluster" +
                        (popup && popup.id === chip.id
                          ? " occupation-chip--active"
                          : "")
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClusterClick(chip, e.currentTarget);
                      }}
                      aria-label={fillText(cfg.ui.list.mapChipAria, {
                        name: chip.name,
                        count: chip.count,
                      })}
                      aria-expanded={popup ? popup.id === chip.id : false}
                    >
                      <span className="occupation-name">{chip.name}</span>
                      <span className="occupation-count">{chip.count}</span>
                    </Popover.Trigger>
                  </foreignObject>
                </g>
              ))}
            </svg>
            {popup && (
              <Popover.Portal>
                <Popover.Positioner
                  sideOffset={8}
                  className="map-popup-positioner"
                >
                  <Popover.Popup
                    className="kv-map-popup base-map-popup"
                    aria-label={fillText(cfg.ui.list.mapPopupAria, {
                      name: popup.label,
                      count: popup.total,
                    })}
                  >
                    <div className="kv-map-popup-head">
                      <span>{popup.label}</span>
                      <button
                        onClick={() => setPopup(null)}
                        aria-label={cfg.ui.chrome.close}
                      >
                        ×
                      </button>
                    </div>
                    <div
                      className="kv-map-popup-body"
                      onScroll={(e) => {
                        const el = e.currentTarget;
                        setPopupAtBottom(
                          el.scrollHeight - el.scrollTop <= el.clientHeight + 4,
                        );
                      }}
                    >
                      {popup.members.map((m) => (
                        <div key={m.city} className="kv-map-popup-row">
                          <span>{m.city}</span>
                          <span className="occupation-count">{m.count}</span>
                        </div>
                      ))}
                    </div>
                    {popup.members.length > 5 && !popupAtBottom && (
                      <div
                        className="kv-map-popup-scroll-hint"
                        aria-hidden="true"
                      >
                        ▾
                      </div>
                    )}
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            )}
          </div>
        </div>
        {(mapData.unmapped.length > 0 || mapData.ohneCount > 0) && (
          <div className="kv-map-extras">
            {mapData.unmapped.map((g) => (
              <div key={g.kreisverband} className="occupation-chip">
                <span className="occupation-name">{g.kreisverband}</span>
                <span className="occupation-count">{g.count}</span>
              </div>
            ))}
            {mapData.ohneCount > 0 && (
              <div className="occupation-chip">
                <span className="occupation-name">{region().none}</span>
                <span className="occupation-count">{mapData.ohneCount}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </Popover.Root>
  );
}

function ImpressumModal({ onClose }) {
  const cfg = useCampaignConfig();
  const region = () => regionLabels(cfg);
  return (
    <Modal onClose={onClose} labelledBy="impressum-title">
      <div
        className="modal modal-legal"
        aria-labelledby="impressum-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="impressum-title">{cfg.ui.chrome.impressum}</h3>
          <button onClick={onClose} aria-label={cfg.ui.chrome.close}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <p>
            <strong>{cfg.legal.entityName}</strong>
            <br />
            {cfg.legal.contactName}
            {cfg.legal.addressLines.map((line) => (
              <Fragment key={line}>
                <br />
                {line}
              </Fragment>
            ))}
          </p>
          <p>
            <a href={`mailto:${cfg.legal.contactEmail}`}>
              {cfg.legal.contactEmail}
            </a>
          </p>
          <p className="modal-disclaimer">{cfg.legal.disclaimer}</p>
        </div>
      </div>
    </Modal>
  );
}

// Retention periods and link lifetimes quoted in the privacy policy: the same
// values the server enforces (config/privacy.js).

function DatenschutzModal({ onClose }) {
  const apiFetch = useCampaignApi();
  const cfg = useCampaignConfig();
  const region = () => regionLabels(cfg);
  const [deletionEmail, setDeletionEmail] = useState("");
  const [deletionStatus, setDeletionStatus] = useState("idle");

  async function handleDeletion(e) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(deletionEmail.trim())) return;
    setDeletionStatus("submitting");
    try {
      await apiFetch("/api/request-deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: deletionEmail.trim() }),
      });
      setDeletionStatus("sent");
    } catch {
      setDeletionStatus("error");
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="datenschutz-title">
      <div
        className="modal modal-legal"
        aria-labelledby="datenschutz-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="datenschutz-title">{cfg.ui.privacy.title}</h3>
          <button onClick={onClose} aria-label={cfg.ui.chrome.close}>
            ×
          </button>
        </div>
        <div className="modal-body modal-legal-body">
          <div dangerouslySetInnerHTML={{ __html: renderPrivacy(cfg) }} />

          {deletionStatus === "sent" ? (
            <p className="deletion-sent">{cfg.ui.privacy.deletionSent}</p>
          ) : (
            <form
              className="deletion-form"
              onSubmit={handleDeletion}
              noValidate
            >
              <input
                type="email"
                value={deletionEmail}
                onChange={(e) => setDeletionEmail(e.target.value)}
                placeholder={cfg.ui.privacy.deletionPlaceholder}
                required
                disabled={deletionStatus === "submitting"}
                aria-label={cfg.ui.privacy.deletionLabel}
              />
              <button type="submit" disabled={deletionStatus === "submitting"}>
                {deletionStatus === "submitting"
                  ? cfg.ui.privacy.deletionSending
                  : cfg.ui.privacy.deletionSubmit}
              </button>
              {deletionStatus === "error" && (
                <p className="err" role="alert">
                  {cfg.ui.errors.network}
                </p>
              )}
            </form>
          )}
        </div>
      </div>
    </Modal>
  );
}
