import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";

const MILESTONES = [
  1000, 1300, 1600, 2000, 2300, 2600, 3000, 4000, 5000, 7500, 10000,
];

const MAP_VB = { x: -60, y: -10, w: 520, h: 520 };

const GERMANY_PATH =
  "M 47,100 L 75,88 L 115,78 L 120,52 L 130,20 L 155,18 L 180,36 L 210,40 L 232,54 L 268,62 L 300,48 L 340,48 L 358,65 L 372,110 L 370,175 L 386,240 L 360,262 L 322,274 L 292,296 L 286,350 L 336,396 L 312,460 L 272,482 L 226,482 L 190,482 L 166,474 L 146,470 L 122,466 L 82,480 L 76,450 L 88,426 L 106,392 L 112,376 L 56,372 L 32,352 L 16,322 L 8,292 L 6,262 L 14,232 L 32,212 L 44,196 L 52,172 L 56,142 L 47,110 Z";

function initials(name) {
  const parts = (name || "").trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || "?";
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function relTime(ts) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return "gerade eben";
  if (diff < 3600) return Math.floor(diff / 60) + " Min";
  if (diff < 86400) return Math.floor(diff / 3600) + " Std";
  const days = Math.floor(diff / 86400);
  if (days < 7) return days + (days === 1 ? " Tag" : " Tagen");
  if (diff < 86400 * 30) return Math.floor(diff / (86400 * 7)) + " Wo";
  return Math.floor(diff / (86400 * 30)) + " Mon";
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
  // it — any extra would expose a sliver of the previous section's bottom padding.
  const header = document.querySelector(".topbar");
  const headerHeight = header?.getBoundingClientRect().height ?? 0;
  return Math.max(0, window.scrollY + el.getBoundingClientRect().top - headerHeight);
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

function useFocusTrap(active) {
  const ref = useRef(null);

  useEffect(() => {
    if (!active || !ref.current) return;
    const el = ref.current;
    const focusable = el.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    first?.focus();

    function trap(e) {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }

    el.addEventListener("keydown", trap);
    return () => el.removeEventListener("keydown", trap);
  }, [active]);

  return ref;
}

export default function App() {
  const [signers, setSigners] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    today: 0,
    week: 0,
    kvCount: 0,
  });
  const [signersTotal, setSignersTotal] = useState(0);
  const [filter, setFilter] = useState("alle");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const knownIdsRef = useRef(new Set());
  const visitStartRef = useRef(Date.now());

  const [emailModal, setEmailModal] = useState(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendSent, setResendSent] = useState(false);
  const [resendError, setResendError] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const [showImpressum, setShowImpressum] = useState(false);
  const [showDatenschutz, setShowDatenschutz] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [showOccupations, setShowOccupations] = useState(false);
  const [occupationGroups, setOccupationGroups] = useState([]);
  const [showKreisverband, setShowKreisverband] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [kvGroups, setKvGroups] = useState([]);
  const [signFormKvNames, setSignFormKvNames] = useState([]);
  const [signFormOccNames, setSignFormOccNames] = useState([]);
  const [zoomError, setZoomError] = useState(null);
  const [zoomCount, setZoomCount] = useState(0);
  const [zoomEventAt, setZoomEventAt] = useState(null);

  const emailTrapRef = useFocusTrap(!!emailModal);
  const successTrapRef = useFocusTrap(showSuccess);
  const deletedTrapRef = useFocusTrap(showDeleted);
  const mobileNavRef = useRef(null);

  useEffect(() => {
    if (navOpen && mobileNavRef.current) {
      const firstLink = mobileNavRef.current.querySelector("a");
      firstLink?.focus();
    }
  }, [navOpen]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
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
      const res = await fetch(`/api/signers?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      data.signers.forEach((s) => knownIdsRef.current.add(s.id));
      setSigners((prev) =>
        append ? [...prev, ...data.signers] : data.signers,
      );
      setSignersTotal(data.total);
      setError(null);
    } catch {
      setError("Daten konnten nicht geladen werden.");
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
      const res = await fetch("/api/zoom-count");
      if (res.ok) {
        const data = await res.json();
        setZoomCount(data.count || 0);
        if (data.eventAt) setZoomEventAt(data.eventAt);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchZoomCount();
  }, [fetchZoomCount]);

  useEffect(() => {
    (async () => {
      try {
        const [kvRes, occRes] = await Promise.all([
          fetch("/api/kreisverband-stats"),
          fetch("/api/occupations"),
        ]);
        if (kvRes.ok) {
          const kvData = await kvRes.json();
          setSignFormKvNames(kvData.map((d) => d.kreisverband).filter(Boolean));
        }
        if (occRes.ok) {
          const occData = await occRes.json();
          setSignFormOccNames(occData.map((d) => d.occupation));
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
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
        const res = await fetch(`/api/signers?${params}`);
        if (!res.ok) return;
        const data = await res.json();
        setSignersTotal(data.total);
        const newOnes = data.signers
          .filter(
            (s) =>
              !knownIdsRef.current.has(s.id) &&
              new Date(s.created_at).getTime() > visitStartRef.current,
          )
          .map((s) => ({ ...s, _isNew: true }));
        if (newOnes.length > 0) {
          newOnes.forEach((s) => knownIdsRef.current.add(s.id));
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
      setSubmitError(
        "Der Bestätigungslink ist abgelaufen. Bitte unterschreibe erneut.",
      );
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("error") === "delete-token-expired") {
      setSubmitError(
        "Der Löschlink ist abgelaufen. Bitte fordere über die Datenschutzseite einen neuen an.",
      );
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const zoomOpen =
    !zoomEventAt ||
    Date.now() < new Date(zoomEventAt).getTime() + 2 * 60 * 60 * 1000;

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
      if (target === null) return; // not mounted yet — a later resize will retry

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
    if (!showOccupations) return;
    (async () => {
      try {
        const res = await fetch("/api/occupations");
        if (res.ok) setOccupationGroups(await res.json());
      } catch {}
    })();
  }, [showOccupations]);

  useEffect(() => {
    if (!showKreisverband && !showMap) return;
    (async () => {
      try {
        const res = await fetch("/api/kreisverband-stats");
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
      const res = await fetch("/api/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok) {
        setSubmitError(result.error || "Ein Fehler ist aufgetreten.");
        return;
      }
      setEmailModal({
        name: data.name,
        email: data.email,
        kv: data.kv || "",
        occupation: data.occupation || "",
        newsletter: !!data.newsletter,
        agree: !!data.agree,
      });
    } catch {
      setSubmitError("Verbindung fehlgeschlagen. Bitte versuche es erneut.");
    }
  }, []);

  const handleZoomSubmit = useCallback(
    async (data) => {
      setZoomError(null);
      try {
        const res = await fetch("/api/zoom-register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const result = await res.json();
        if (!res.ok) {
          setZoomError(result.error || "Ein Fehler ist aufgetreten.");
          return false;
        }
        fetchZoomCount();
        return true;
      } catch {
        setZoomError("Verbindung fehlgeschlagen. Bitte versuche es erneut.");
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
      const res = await fetch("/api/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailModal.email }),
      });
      const result = await res.json();
      if (!res.ok) {
        setResendError(
          result.error ||
            "Senden fehlgeschlagen. Bitte versuche es später erneut.",
        );
        return;
      }
    } catch {
      setResendError("Verbindung fehlgeschlagen. Bitte versuche es erneut.");
      return;
    }
    setResendSent(true);
    setEmailModal((prev) => ({ ...prev }));
  }

  function closeSuccess() {
    setShowSuccess(false);
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") {
        if (showSuccess) closeSuccess();
        else if (emailModal) closeModal();
        else if (showImpressum) setShowImpressum(false);
        else if (showDatenschutz) setShowDatenschutz(false);
        else if (showDeleted) setShowDeleted(false);
        else if (showMap) setShowMap(false);
        else if (navOpen) setNavOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    showSuccess,
    emailModal,
    showImpressum,
    showDatenschutz,
    showDeleted,
    navOpen,
  ]);

  const total = stats.total;
  const ZIEL =
    MILESTONES.find((m) => m > total) ?? MILESTONES[MILESTONES.length - 1];
  const pct = Math.min(100, Math.round((total / ZIEL) * 100));

  return (
    <>
      <a href="#main" className="skip-link">
        Zum Inhalt springen
      </a>

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {total.toLocaleString("de-DE")} Unterschriften
      </div>

      <header className="topbar">
        <div className="wordmark">
          <span className="dot" aria-hidden="true"></span> Gehaltsdeckel jetzt.
        </div>
        <nav aria-label="Hauptnavigation">
          <a
            href="#brief"
            onClick={(e) => {
              e.preventDefault();
              scrollTo("brief");
            }}
          >
            Brief
          </a>
          <a
            href="#unterzeichnen"
            onClick={(e) => {
              e.preventDefault();
              scrollTo("unterzeichnen");
            }}
          >
            Unterzeichnen
          </a>
          <a
            href="#liste"
            onClick={(e) => {
              e.preventDefault();
              scrollTo("liste");
            }}
          >
            Unterstützer*innen
          </a>
          {zoomOpen && (
            <a
              href="#zoom"
              onClick={(e) => {
                e.preventDefault();
                scrollTo("zoom");
              }}
            >
              Zoom-Treffen
            </a>
          )}
        </nav>
        <button
          className="cta topbar-cta"
          onClick={() => scrollTo("unterzeichnen")}
        >
          Mitzeichnen <span aria-hidden="true">→</span>
        </button>
        <button
          className={"hamburger" + (navOpen ? " open" : "")}
          aria-label={navOpen ? "Menü schließen" : "Menü öffnen"}
          aria-expanded={navOpen}
          aria-controls="mobile-nav"
          onClick={() => setNavOpen((v) => !v)}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
      </header>
      <nav
        id="mobile-nav"
        ref={mobileNavRef}
        className={"mobile-nav" + (navOpen ? " open" : "")}
        aria-label="Mobilnavigation"
        aria-hidden={!navOpen}
        inert={navOpen ? undefined : ""}
      >
        <a
          href="#brief"
          onClick={(e) => {
            e.preventDefault();
            setNavOpen(false);
            scrollTo("brief");
          }}
        >
          Brief
        </a>
        <a
          href="#unterzeichnen"
          onClick={(e) => {
            e.preventDefault();
            setNavOpen(false);
            scrollTo("unterzeichnen");
          }}
        >
          Unterzeichnen
        </a>
        <a
          href="#liste"
          onClick={(e) => {
            e.preventDefault();
            setNavOpen(false);
            scrollTo("liste");
          }}
        >
          Unterstützer*innen
        </a>
        <a
          href="#zoom"
          onClick={(e) => {
            e.preventDefault();
            setNavOpen(false);
            scrollTo("zoom");
          }}
        >
          Zoom-Treffen
        </a>
        <a
          href="#unterzeichnen"
          className="mobile-nav-cta"
          onClick={(e) => {
            e.preventDefault();
            setNavOpen(false);
            scrollTo("unterzeichnen");
          }}
        >
          Jetzt mitzeichnen <span aria-hidden="true">→</span>
        </a>
      </nav>

      <main id="main">
        <section
          className="hero"
          aria-label="Titelbild und Unterschriftenzähler"
        >
          <div className="hero-inner">
            <h1 className="headline">
              <span className="banner">Gehalt</span>
              <br />
              <span className="banner">deckeln.</span>
              <br />
              <span className="light">Jetzt.</span>
            </h1>

            <div className="hero-row">
              <div className="counter-wrap">
                <div
                  className="counter-card"
                  aria-label={`${total.toLocaleString("de-DE")} von ${ZIEL.toLocaleString("de-DE")} Unterschriften`}
                >
                  <div className="label">Unterschriften</div>
                  <div className="num">
                    {total.toLocaleString("de-DE")}
                    <span className="unit">
                      / {ZIEL.toLocaleString("de-DE")}
                    </span>
                  </div>
                  <div className="meta">
                    Ziel: {ZIEL.toLocaleString("de-DE")} verifizierte
                    Mitzeichner*innen
                  </div>
                  <div
                    className="goal-bar"
                    role="progressbar"
                    aria-label="Fortschritt zum Unterschriftenziel"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div style={{ transform: `scaleX(${pct / 100})` }}></div>
                  </div>
                  <div className="goal-meta">
                    <span>{pct}% erreicht</span>
                    <span>
                      Aktualisiert{" "}
                      {new Date().toLocaleTimeString("de-DE", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>

                {total >= 2000 && zoomOpen && (
                  <button
                    className="stoerer"
                    onClick={() => scrollTo("zoom")}
                    aria-label="Wir sind 2000 — jetzt zum Zoom-Treffen anmelden"
                  >
                    <span className="stoerer-head">Wir sind 2000!</span>
                    <span className="stoerer-body">
                      Jetzt treffen wir uns zum Zoom und planen die nächsten
                      Schritte.
                    </span>
                    <span className="stoerer-date">9.6. · 20 Uhr</span>
                    <span className="stoerer-cta">
                      Sei dabei! <span aria-hidden="true">→</span>
                    </span>
                  </button>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  alignItems: "flex-start",
                }}
              >
                <button
                  className="scrollcta"
                  onClick={() => scrollTo("unterzeichnen")}
                >
                  Jetzt mitzeichnen <span aria-hidden="true">→</span>
                </button>
                <button
                  className="scrollcta"
                  onClick={() => scrollTo("brief")}
                  style={{
                    background: "transparent",
                    color: "var(--akzent)",
                    borderColor: "var(--akzent)",
                  }}
                >
                  Brief lesen
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="brief" aria-label="Der offene Brief">
          <div className="section-inner">
            <article className="brief-paper">
              <h2>Ein Brief von Genoss*innen</h2>
              <p className="anrede">Liebe Genoss*innen,</p>

              <p className="lead">
                in diesem Brief melden wir uns als aktive Mitglieder der Linken
                - mit und ohne Funktion - zu Wort. Wir wollen uns konstruktiv in
                die Debatte um den Gehaltsdeckel für Mandatsträger*innen
                einbringen, die in den vergangenen Wochen teils unschön über die
                Medien geführt wurde. Denn es ist uns wichtig, dass unsere
                Perspektive gehört wird.
              </p>

              <p>
                Der Parteivorstand hat dem nächsten Bundesparteitag in Potsdam
                einen Antrag zur Begrenzung der Diäten von Mandatsträger*innen
                vorgelegt. Für uns ist dieser Antrag absolut richtig und längst
                überfällig. Denn natürlich ist in einer Partei wie der Linken
                die Rolle von Mandatsträger*innen und ihr Verhältnis zur Partei
                eine zentrale politische Frage. Wir wollen über den Diätendeckel
                demokratisch diskutieren, und zwar auf dem Parteitag. Genau dort
                gehört diese Auseinandersetzung hin und nicht in die Presse.
              </p>

              <p>
                Das Comeback 2025 wurde nicht von Mandatsträger*innen allein
                ermöglicht. Es wurde von tausenden Mitgliedern getragen, die
                ihre Feierabende, ihre Wochenenden und ihre Energie mit
                Wahlkampf verbracht haben. Von Genoss*innen, die geblieben sind,
                als es schwierig war. Die Infostände organisiert, an
                hunderttausende Haustüren geklopft und zehntausende Plakate
                aufgehängt haben.
              </p>

              <div className="pullquote">
                „Die Linke wurde von uns allen gerettet, und zwar neben Beruf,
                Familie oder Studium und ohne jegliche öffentliche
                Aufmerksamkeit."
              </div>

              <p>
                Wir erwarten, dass Mandate in der Linken anders verstanden
                werden als in anderen Parteien: als politische Verantwortung
                gegenüber der Partei und den Menschen, die sie tragen. Wenn wir
                sagen, dass wir als Linke Politik anders machen wollen, dann
                muss sich dieser Anspruch auch in unserer politischen Praxis
                widerspiegeln. Gerade in unserer Partei, die beinahe daran
                zerbrochen wäre, dass einzelne Funktionär*innen sie für
                persönliche Interessen missbraucht haben, ist die Debatte über
                die Rolle und Verantwortung von Abgeordneten selbstverständlich.
                Denn Mandatsträger*innen sind Aushängeschilder unserer Politik.
                An ihrem Auftreten wird Die Linke insgesamt gemessen. Wenn
                unsere Mandatsträger*innen ihre Diäten wirksam begrenzen und
                Geld zugunsten von Sozialfonds und sozialen Initiativen
                umverteilen, dann stärkt das die Glaubwürdigkeit unserer Partei.
                Ein wirksamer Gehaltsdeckel ist es für uns nur, wenn wir uns an
                den Durchschnittslöhnen in diesem Land orientieren.
              </p>

              <p>
                Wir alle teilen eine Vision. Das Comeback 2025 war nur der erste
                Schritt. Wir wollen Die Linke weiter aufbauen, Menschen
                organisieren und so eine nachhaltige sozialistische Politik
                schaffen. In den letzten Monaten haben wir erlebt, zu was wir in
                der Lage sind, wenn wir an einem Strang ziehen. Genau diesen Weg
                wollen wir fortsetzen, denn wir haben viel zu tun und die
                Herausforderungen sind groß.
              </p>

              <p>
                Wir erwarten von allen, auch denen, die gegen einen
                Gehaltsdeckel sind, dass sie sich solidarisch und an den
                vorgesehenen Orten in diese Debatte einbringen. Auf Augenhöhe
                und innerhalb der Partei, statt über Medien. Denn die Aufgaben,
                vor denen wir stehen, gehen weit über einen Gehaltsdeckel
                hinaus. Unsere gemeinsame Aufgabe ist schließlich, Die Linke
                weiter aufzubauen. Das Comeback zur Bundestagswahl müssen wir in
                nachhaltige und glaubwürdige sozialistische Politik überführen.
              </p>

              <p className="gruss">Mit solidarischen Grüßen</p>

              <p className="signers-line">
                Marlen Borchardt, Philipp Möller, Lisbeth Ritterhoff, Zozan
                Bulut und
                <br />
                {(total - 4).toLocaleString("de-DE")} Mitglieder und
                Sympathisant*innen der Partei Die Linke
              </p>
            </article>
          </div>
        </section>

        <section
          className="section sign-section"
          id="unterzeichnen"
          aria-label="Unterschriftenformular"
        >
          <div className="section-inner">
            <div className="sign-grid">
              <div className="sign-intro">
                <span className="section-num">02 / Mitzeichnen</span>
                <h2>
                  Setz deinen
                  <br />
                  Namen <span className="rot">drunter.</span>
                </h2>
                <ul>
                  <li>
                    Du bist Mitglied oder Sympathisant*in der Partei Die Linke.
                  </li>
                  <li>Du stehst hinter diesem Brief.</li>
                  <li>
                    Du kannst wählen, ob dein Name öffentlich angezeigt wird.
                  </li>
                </ul>
                <p className="privacy">
                  Deine E-Mail-Adresse wird ausschließlich zur Verifizierung
                  deiner Unterschrift verwendet und nicht öffentlich gezeigt.
                  Eine Unterschrift wird erst nach Bestätigung per E-Mail
                  gezählt. Du kannst deine Zustimmung jederzeit zurückziehen.
                </p>
              </div>

              <SignForm
                onSubmit={handleSubmit}
                serverError={submitError}
                kvNames={signFormKvNames}
                occNames={signFormOccNames}
              />
            </div>
          </div>
        </section>

        <section
          className="section signers-section"
          id="liste"
          aria-label="Liste der Unterstützer*innen"
        >
          <div className="section-inner">
            <div className="signers-head">
              <div>
                <span className="section-num">03 / Schon dabei</span>
                <h2>
                  {total.toLocaleString("de-DE")} Genoss*innen
                  <br />
                  haben unterzeichnet.
                </h2>
              </div>
              <div className="total">
                <b>+{stats.today}</b> in den letzten 24 Stunden
              </div>
            </div>

            <div className="stats-row">
              <div className="stat">
                <div className="v">{total.toLocaleString("de-DE")}</div>
                <div className="k">Gesamt verifiziert</div>
              </div>
              <div className="stat">
                <div className="v">+{stats.today}</div>
                <div className="k">Heute</div>
              </div>
              <div className="stat">
                <div className="v">+{stats.week}</div>
                <div className="k">Diese Woche</div>
              </div>
              <div className="stat">
                <div className="v">{stats.kvCount}</div>
                <div className="k">Kreisverbände</div>
              </div>
            </div>

            <div className="filters" role="group" aria-label="Filter">
              <button
                className={
                  "filter-chip " +
                  (!showOccupations &&
                  !showKreisverband &&
                  !showMap &&
                  filter === "alle"
                    ? "active"
                    : "")
                }
                aria-pressed={
                  !showOccupations &&
                  !showKreisverband &&
                  !showMap &&
                  filter === "alle"
                }
                onClick={() => {
                  setShowOccupations(false);
                  setShowKreisverband(false);
                  setShowMap(false);
                  setFilter("alle");
                }}
              >
                Alle
              </button>
              <button
                className={
                  "filter-chip " +
                  (!showOccupations &&
                  !showKreisverband &&
                  !showMap &&
                  filter === "neueste"
                    ? "active"
                    : "")
                }
                aria-pressed={
                  !showOccupations &&
                  !showKreisverband &&
                  !showMap &&
                  filter === "neueste"
                }
                onClick={() => {
                  setShowOccupations(false);
                  setShowKreisverband(false);
                  setShowMap(false);
                  setFilter("neueste");
                }}
              >
                Neueste
              </button>
              <button
                className={"filter-chip " + (showMap ? "active" : "")}
                aria-pressed={showMap}
                onClick={() => {
                  setShowOccupations(false);
                  setShowKreisverband(false);
                  setShowMap((v) => !v);
                }}
              >
                Karte
              </button>
              <button
                className={"filter-chip " + (showKreisverband ? "active" : "")}
                onClick={() => {
                  setShowOccupations(false);
                  setShowMap(false);
                  setShowKreisverband((v) => !v);
                }}
                aria-pressed={showKreisverband}
              >
                Kreisverbände
              </button>
              <button
                className={"filter-chip " + (showOccupations ? "active" : "")}
                onClick={() => {
                  setShowKreisverband(false);
                  setShowMap(false);
                  setShowOccupations((v) => !v);
                }}
                aria-pressed={showOccupations}
              >
                Berufe
              </button>
              {!showOccupations && !showKreisverband && !showMap && (
                <input
                  className="search"
                  placeholder="Suchen nach Name oder Kreisverband…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Suche nach Name oder Kreisverband"
                />
              )}
            </div>

            {error && (
              <p
                role="alert"
                style={{
                  color: "var(--rot-text)",
                  textAlign: "center",
                  padding: 20,
                }}
              >
                {error}
              </p>
            )}

            {showMap ? (
              kvGroups.length === 0 ? (
                <div className="empty-state">Lade Karte…</div>
              ) : (
                <KreisverbandMap kvGroups={kvGroups} />
              )
            ) : showKreisverband ? (
              kvGroups.length === 0 ? (
                <div className="empty-state">Noch keine Kreisverbände.</div>
              ) : (
                <div className="occupation-grid">
                  {kvGroups.map((g) => (
                    <div key={g.kreisverband} className="occupation-chip">
                      <span className="occupation-name">{g.kreisverband}</span>
                      <span className="occupation-count">{g.count}</span>
                    </div>
                  ))}
                </div>
              )
            ) : showOccupations ? (
              occupationGroups.length === 0 ? (
                <div className="empty-state">Noch keine Berufe angegeben.</div>
              ) : (
                <div className="occupation-grid">
                  {occupationGroups.map((g) => (
                    <div key={g.occupation} className="occupation-chip">
                      <span className="occupation-name">{g.occupation}</span>
                      <span className="occupation-count">{g.count}</span>
                    </div>
                  ))}
                </div>
              )
            ) : loading && signers.length === 0 ? (
              <div className="empty-state">Lade Unterschriften…</div>
            ) : (
              <>
                <div className="signers-grid">
                  {signers.map((s) => (
                    <SignerRow
                      key={s.id}
                      name={s.name}
                      kreisverband={s.kreisverband}
                      createdAt={s.created_at}
                      isNew={s._isNew}
                    />
                  ))}
                </div>

                <div className="signers-foot">
                  <span>
                    {signers.length} von {signersTotal.toLocaleString("de-DE")}{" "}
                    angezeigt
                  </span>
                  {signers.length < signersTotal && (
                    <button onClick={handleLoadMore}>Weitere laden</button>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        {zoomOpen && (
          <section
            className="section sign-section zoom-section"
            id="zoom"
            aria-label="Anmeldung zum Zoom-Treffen"
          >
            <div className="section-inner">
              <div className="sign-grid">
                <div className="sign-intro">
                  <span className="section-num">04 / Zoom-Treffen</span>
                  <h2>
                    Wir treffen uns
                    <br />
                    <span className="rot">am 9. Juni.</span>
                  </h2>
                  <p className="zoom-when">
                    <strong>Montag, 9. Juni · 20 Uhr · per Zoom</strong>
                  </p>
                  <ul>
                    <li>
                      Wir planen die öffentliche Übergabe des offenen Briefes.
                    </li>
                    <li>
                      Wir sprechen über eine Choreografie auf dem Parteitag.
                    </li>
                    <li>Wir verabreden die nächsten gemeinsamen Schritte.</li>
                  </ul>
                  <p className="privacy">
                    Den Einwahllink schicken wir dir vor dem Termin per E-Mail.
                    Deine Angaben nutzen wir ausschließlich für die Organisation
                    des Treffens.
                  </p>
                </div>

                <ZoomForm
                  onSubmit={handleZoomSubmit}
                  serverError={zoomError}
                  kvNames={signFormKvNames}
                />
              </div>
            </div>
          </section>
        )}
      </main>

      <footer>
        <div className="footer-inner">
          <div className="footer-top">
            <div>
              <h3>Gehaltsdeckel jetzt.</h3>
              <p>
                Eine offene Initiative aus den Kreisverbänden. Kein offizielles
                Schreiben des Parteivorstandes oder der Bundestagsfraktion.
              </p>
            </div>
            <div>
              <h3>Kontakt</h3>
              <a href="mailto:kontakt@gehaltsdeckel.jetzt">
                kontakt@gehaltsdeckel.jetzt
              </a>
            </div>
            <div>
              <h3>Rechtliches</h3>
              <button
                type="button"
                className="footer-link"
                onClick={() => setShowImpressum(true)}
              >
                Impressum
              </button>
              <button
                type="button"
                className="footer-link"
                onClick={() => setShowDatenschutz(true)}
              >
                Datenschutz
              </button>
            </div>
          </div>
        </div>
      </footer>

      {emailModal && (
        <div className="modal-overlay" onClick={closeModal} role="presentation">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="email-modal-title"
            onClick={(e) => e.stopPropagation()}
            ref={emailTrapRef}
          >
            <div className="modal-head">
              <h3 id="email-modal-title">Bitte E-Mail bestätigen</h3>
              <button onClick={closeModal} aria-label="Schließen">
                ×
              </button>
            </div>
            <div className="modal-body">
              <p>
                Danke, <strong>{emailModal.name}</strong>. Wir haben dir einen
                Bestätigungslink geschickt an:
              </p>
              <div className="email-pill">{emailModal.email}</div>

              <p>
                Erst nach dem Klick auf den Link in dieser E-Mail wird deine
                Unterschrift gezählt und öffentlich gelistet.
              </p>
              <p className="hint">
                Keine E-Mail erhalten? Schau in den Spam-Ordner.
              </p>
              <p className="hint">
                E-Mails können manchmal ein paar Minuten auf sich warten lassen.
              </p>
              {resendError && (
                <p className="hint" style={{ color: "var(--fehler)" }}>
                  {resendError}
                </p>
              )}
              <button
                className="resend-btn"
                onClick={handleResend}
                disabled={resendCooldown > 0}
              >
                {resendSent && resendCooldown > 0
                  ? `E-Mail gesendet ✓ nochmal in ${resendCooldown}s`
                  : resendCooldown > 0
                    ? `Erneut senden in ${resendCooldown}s`
                    : "Link erneut anfordern"}
              </button>
              <button className="confirm-btn" onClick={closeModal}>
                Verstanden
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccess && (
        <div
          className="modal-overlay"
          onClick={closeSuccess}
          role="presentation"
        >
          <div
            className="modal success"
            role="dialog"
            aria-modal="true"
            aria-labelledby="success-modal-title"
            onClick={(e) => e.stopPropagation()}
            ref={successTrapRef}
          >
            <div className="modal-head">
              <h3 id="success-modal-title">Unterschrift gezählt</h3>
              <button onClick={closeSuccess} aria-label="Schließen">
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
              <p className="success-title">Solidarisch dabei.</p>
              <p>
                Deine Unterschrift ist jetzt Teil des offenen Briefes. Teile ihn
                mit deinem Kreisverband - wir wollen vor dem nächsten Parteitag
                bei {ZIEL} stehen.
              </p>
              <button
                className="confirm-btn"
                style={{ background: "var(--rot)", borderColor: "var(--rot)" }}
                onClick={() => {
                  closeSuccess();
                  scrollTo("liste");
                }}
              >
                Mich in der Liste zeigen <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleted && (
        <div
          className="modal-overlay"
          onClick={() => setShowDeleted(false)}
          role="presentation"
        >
          <div
            className="modal success"
            role="dialog"
            aria-modal="true"
            aria-labelledby="deleted-modal-title"
            onClick={(e) => e.stopPropagation()}
            ref={deletedTrapRef}
          >
            <div className="modal-head">
              <h3 id="deleted-modal-title">Daten gelöscht</h3>
              <button
                onClick={() => setShowDeleted(false)}
                aria-label="Schließen"
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
              <p className="success-title">Erledigt.</p>
              <p>
                Deine Unterschrift und alle damit verbundenen Daten wurden
                unwiderruflich gelöscht.
              </p>
              <button
                className="confirm-btn"
                onClick={() => setShowDeleted(false)}
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}

      {showImpressum && (
        <ImpressumModal onClose={() => setShowImpressum(false)} />
      )}

      {showDatenschutz && (
        <DatenschutzModal onClose={() => setShowDatenschutz(false)} />
      )}
    </>
  );
}

const SignerRow = memo(function SignerRow({
  name,
  kreisverband,
  createdAt,
  isNew,
}) {
  return (
    <div className={"signer" + (isNew ? " new" : "")}>
      <div className="avatar">{initials(name)}</div>
      <div className="info">
        <div className="name">{name}</div>
        <div className="kv">
          {kreisverband ? "KV " + kreisverband : "Ohne Kreisverband"}
        </div>
      </div>
      <div className="time">vor {relTime(createdAt)}</div>
    </div>
  );
});

const SignForm = memo(function SignForm({
  onSubmit,
  serverError,
  kvNames,
  occNames,
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [kv, setKv] = useState("");
  const [occupation, setOccupation] = useState("");
  const [agree, setAgree] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [showOccSuggest, setShowOccSuggest] = useState(false);
  const [kvActiveIndex, setKvActiveIndex] = useState(-1);
  const [occActiveIndex, setOccActiveIndex] = useState(-1);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef(null);
  const emailRef = useRef(null);
  const kvInputRef = useRef(null);
  const occInputRef = useRef(null);

  const occMatches = useMemo(() => {
    if (!occupation) return [];
    const q = occupation.toLowerCase();
    return occNames
      .filter((o) => o.toLowerCase().includes(q) && o.toLowerCase() !== q)
      .slice(0, 6);
  }, [occupation, occNames]);

  const kvMatches = useMemo(() => {
    if (!kv) return [];
    const q = kv.toLowerCase();
    return kvNames.filter((k) => k.toLowerCase().includes(q)).slice(0, 6);
  }, [kv, kvNames]);

  function validate() {
    const e = {};
    if (name.trim().length < 2)
      e.name = "Bitte gib deinen vollständigen Namen an.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      e.email = "Bitte gib eine gültige E-Mail-Adresse an.";
    setErrors(e);
    if (e.name) nameRef.current?.focus();
    else if (e.email) emailRef.current?.focus();
    return Object.keys(e).length === 0;
  }

  async function submit(e) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    await onSubmit({
      name: name.trim(),
      email: email.trim(),
      kv: kv.trim().replace(/^KV\s*/i, ""),
      occupation: occupation.trim(),
      newsletter,
      agree,
    });
    setSubmitting(false);
    setName("");
    setEmail("");
    setKv("");
    setOccupation("");
    setAgree(false);
    setNewsletter(false);
    setErrors({});
  }

  return (
    <form className="form-card" onSubmit={submit} noValidate>
      <span className="badge">Mitzeichnen</span>
      <h3>Unterschreiben in 30 Sekunden</h3>
      <div className="sub2">
        Felder ausfüllen, bestätigen per E-Mail. Fertig.
      </div>

      {serverError && (
        <div className="err" role="alert">
          {serverError}
        </div>
      )}

      <div className="field">
        <label htmlFor="sign-name">
          Name <span className="opt"> wird öffentlich gezeigt</span>
        </label>
        <input
          id="sign-name"
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z. B. Anna Berger"
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
          E-Mail{" "}
          <span className="opt"> nur zur Verifizierung, nicht öffentlich</span>
        </label>
        <input
          id="sign-email"
          ref={emailRef}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="anna@example.org"
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

      <div className="field" style={{ position: "relative" }}>
        <label htmlFor="sign-kv">
          Kreisverband <span className="opt"> optional</span>
        </label>
        <input
          id="sign-kv"
          ref={kvInputRef}
          type="text"
          value={kv}
          onChange={(e) => {
            setKv(e.target.value);
            setShowSuggest(true);
            setKvActiveIndex(-1);
          }}
          onFocus={() => setShowSuggest(true)}
          onBlur={() => {
            setTimeout(() => {
              setShowSuggest(false);
              setKvActiveIndex(-1);
            }, 150);
            setKv((v) => v.replace(/^KV\s*/i, ""));
          }}
          onKeyDown={(e) => {
            if (!showSuggest || !kvMatches.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setKvActiveIndex((i) => Math.min(i + 1, kvMatches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setKvActiveIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && kvActiveIndex >= 0) {
              e.preventDefault();
              setKv(kvMatches[kvActiveIndex]);
              setShowSuggest(false);
              setKvActiveIndex(-1);
            } else if (e.key === "Escape") {
              setShowSuggest(false);
              setKvActiveIndex(-1);
              kvInputRef.current?.focus();
            }
          }}
          placeholder="z. B. Berlin-Neukölln"
          autoComplete="off"
          role="combobox"
          aria-expanded={showSuggest && kv && kvMatches.length > 0}
          aria-autocomplete="list"
          aria-controls="kv-listbox"
          aria-activedescendant={
            kvActiveIndex >= 0 ? `kv-option-${kvActiveIndex}` : undefined
          }
        />
        {showSuggest && kv && kvMatches.length > 0 && (
          <div id="kv-listbox" role="listbox" className="autocomplete-dropdown">
            {kvMatches.map((k, i) => (
              <div
                key={k}
                id={`kv-option-${i}`}
                role="option"
                aria-selected={i === kvActiveIndex}
                onMouseDown={() => {
                  setKv(k);
                  setShowSuggest(false);
                  setKvActiveIndex(-1);
                }}
                className={
                  "autocomplete-option" + (i === kvActiveIndex ? " active" : "")
                }
              >
                {k}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="field" style={{ position: "relative" }}>
        <label htmlFor="sign-occupation">
          Beruf <span className="opt"> optional</span>
        </label>
        <input
          id="sign-occupation"
          ref={occInputRef}
          type="text"
          value={occupation}
          onChange={(e) => {
            setOccupation(e.target.value);
            setShowOccSuggest(true);
            setOccActiveIndex(-1);
          }}
          onFocus={() => setShowOccSuggest(true)}
          onBlur={() => {
            setTimeout(() => {
              setShowOccSuggest(false);
              setOccActiveIndex(-1);
            }, 150);
          }}
          onKeyDown={(e) => {
            if (!showOccSuggest || !occMatches.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOccActiveIndex((i) => Math.min(i + 1, occMatches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setOccActiveIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && occActiveIndex >= 0) {
              e.preventDefault();
              setOccupation(occMatches[occActiveIndex]);
              setShowOccSuggest(false);
              setOccActiveIndex(-1);
            } else if (e.key === "Escape") {
              setShowOccSuggest(false);
              setOccActiveIndex(-1);
              occInputRef.current?.focus();
            }
          }}
          placeholder="z. B. Sozialarbeiter*in"
          autoComplete="off"
          role="combobox"
          aria-expanded={showOccSuggest && occupation && occMatches.length > 0}
          aria-autocomplete="list"
          aria-controls="occ-listbox"
          aria-activedescendant={
            occActiveIndex >= 0 ? `occ-option-${occActiveIndex}` : undefined
          }
        />
        {showOccSuggest && occupation && occMatches.length > 0 && (
          <div
            id="occ-listbox"
            role="listbox"
            className="autocomplete-dropdown"
          >
            {occMatches.map((o, i) => (
              <div
                key={o}
                id={`occ-option-${i}`}
                role="option"
                aria-selected={i === occActiveIndex}
                onMouseDown={() => {
                  setOccupation(o);
                  setShowOccSuggest(false);
                  setOccActiveIndex(-1);
                }}
                className={
                  "autocomplete-option" +
                  (i === occActiveIndex ? " active" : "")
                }
              >
                {o}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="checks">
        <label className="check">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
          />
          <span>
            Mein <strong>Name (und ggf. Kreisverband/Beruf)</strong> darf
            öffentlich auf dieser Seite angezeigt werden.{" "}
            <span className="opt">(optional)</span>
          </span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={newsletter}
            onChange={(e) => setNewsletter(e.target.checked)}
          />
          <span>
            Haltet mich zur Initiative auf dem Laufenden (gelegentliche E-Mails,
            jederzeit abbestellbar).
          </span>
        </label>
      </div>

      <button type="submit" className="submit" disabled={submitting}>
        {submitting ? "Wird gesendet…" : "Jetzt mitzeichnen"}{" "}
        <span className="arrow" aria-hidden="true">
          →
        </span>
      </button>
      <p className="form-legal">
        Mit Klick auf „Mitzeichnen" schicken wir dir einen Bestätigungslink an
        deine E-Mail. Erst danach zählt deine Unterschrift.
      </p>
    </form>
  );
});

const ZoomForm = memo(function ZoomForm({ onSubmit, serverError, kvNames }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [kv, setKv] = useState("");
  const [delegierter, setDelegierter] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [kvActiveIndex, setKvActiveIndex] = useState(-1);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const nameRef = useRef(null);
  const emailRef = useRef(null);
  const kvInputRef = useRef(null);

  const kvMatches = useMemo(() => {
    if (!kv) return [];
    const q = kv.toLowerCase();
    return kvNames.filter((k) => k.toLowerCase().includes(q)).slice(0, 6);
  }, [kv, kvNames]);

  function validate() {
    const e = {};
    if (name.trim().length < 2)
      e.name = "Bitte gib deinen vollständigen Namen an.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      e.email = "Bitte gib eine gültige E-Mail-Adresse an.";
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
      delegierter,
    });
    setSubmitting(false);
    if (ok) {
      setDone(true);
      setName("");
      setEmail("");
      setKv("");
      setDelegierter(false);
      setErrors({});
    }
  }

  if (done) {
    return (
      <div className="form-card zoom-done" role="status">
        <span className="badge">Angemeldet</span>
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
        <h3>Du bist dabei.</h3>
        <p className="sub2">
          Wir haben dir eine Bestätigung per E-Mail geschickt. Den Einwahllink
          bekommst du rechtzeitig vor dem Termin am 9. Juni, 20 Uhr.
        </p>
      </div>
    );
  }

  return (
    <form className="form-card" onSubmit={submit} noValidate>
      <span className="badge">Zoom-Anmeldung</span>
      <h3>Anmelden in 30 Sekunden</h3>
      <div className="sub2">Den Link schicken wir dir per E-Mail.</div>

      {serverError && (
        <div className="err" role="alert">
          {serverError}
        </div>
      )}

      <div className="field">
        <label htmlFor="zoom-name">Name</label>
        <input
          id="zoom-name"
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z. B. Anna Berger"
          className={errors.name ? "invalid" : ""}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "zoom-err-name" : undefined}
          autoComplete="name"
        />
        {errors.name && (
          <div className="err" id="zoom-err-name">
            {errors.name}
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor="zoom-email">
          E-Mail{" "}
          <span className="opt"> für die Bestätigung und den Zoom-Link</span>
        </label>
        <input
          id="zoom-email"
          ref={emailRef}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="anna@example.org"
          className={errors.email ? "invalid" : ""}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "zoom-err-email" : undefined}
          autoComplete="email"
        />
        {errors.email && (
          <div className="err" id="zoom-err-email">
            {errors.email}
          </div>
        )}
      </div>

      <div className="field" style={{ position: "relative" }}>
        <label htmlFor="zoom-kv">
          Kreisverband <span className="opt"> optional</span>
        </label>
        <input
          id="zoom-kv"
          ref={kvInputRef}
          type="text"
          value={kv}
          onChange={(e) => {
            setKv(e.target.value);
            setShowSuggest(true);
            setKvActiveIndex(-1);
          }}
          onFocus={() => setShowSuggest(true)}
          onBlur={() => {
            setTimeout(() => {
              setShowSuggest(false);
              setKvActiveIndex(-1);
            }, 150);
            setKv((v) => v.replace(/^KV\s*/i, ""));
          }}
          onKeyDown={(e) => {
            if (!showSuggest || !kvMatches.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setKvActiveIndex((i) => Math.min(i + 1, kvMatches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setKvActiveIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && kvActiveIndex >= 0) {
              e.preventDefault();
              setKv(kvMatches[kvActiveIndex]);
              setShowSuggest(false);
              setKvActiveIndex(-1);
            } else if (e.key === "Escape") {
              setShowSuggest(false);
              setKvActiveIndex(-1);
              kvInputRef.current?.focus();
            }
          }}
          placeholder="z. B. Berlin-Neukölln"
          autoComplete="off"
          role="combobox"
          aria-expanded={showSuggest && kv && kvMatches.length > 0}
          aria-autocomplete="list"
          aria-controls="zoom-kv-listbox"
          aria-activedescendant={
            kvActiveIndex >= 0 ? `zoom-kv-option-${kvActiveIndex}` : undefined
          }
        />
        {showSuggest && kv && kvMatches.length > 0 && (
          <div
            id="zoom-kv-listbox"
            role="listbox"
            className="autocomplete-dropdown"
          >
            {kvMatches.map((k, i) => (
              <div
                key={k}
                id={`zoom-kv-option-${i}`}
                role="option"
                aria-selected={i === kvActiveIndex}
                onMouseDown={() => {
                  setKv(k);
                  setShowSuggest(false);
                  setKvActiveIndex(-1);
                }}
                className={
                  "autocomplete-option" + (i === kvActiveIndex ? " active" : "")
                }
              >
                {k}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="checks">
        <label className="check">
          <input
            type="checkbox"
            checked={delegierter}
            onChange={(e) => setDelegierter(e.target.checked)}
          />
          <span>
            Ich bin <strong>Delegierte*r zum Parteitag.</strong>{" "}
            <span className="opt">(optional)</span>
          </span>
        </label>
      </div>

      <button type="submit" className="submit" disabled={submitting}>
        {submitting ? "Wird gesendet…" : "Zum Zoom anmelden"}{" "}
        <span className="arrow" aria-hidden="true">
          →
        </span>
      </button>
      <p className="form-legal">
        Wir nutzen deine Angaben nur zur Organisation des Treffens und schicken
        dir den Einwahllink rechtzeitig per E-Mail.
      </p>
    </form>
  );
});

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
  const mapData = useMemo(() => {
    const stateCounts = {};
    const stateKvs = {};
    const unmapped = [];
    let ohneCount = 0;
    let total = 0;
    for (const g of kvGroups) {
      total += g.count;
      if (g.kreisverband === "Ohne Kreisverband") {
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
  const popupCloseRef = useRef(null);
  const lastFocusedRef = useRef(null);

  useEffect(() => {
    if (popup && popupCloseRef.current) {
      popupCloseRef.current.focus();
    } else if (!popup && lastFocusedRef.current) {
      lastFocusedRef.current.focus();
      lastFocusedRef.current = null;
    }
    setPopupAtBottom(false);
  }, [popup]);

  useEffect(() => {
    if (!popup) return;
    function onKey(e) {
      if (e.key === "Escape") setPopup(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
    if (triggerEl) lastFocusedRef.current = triggerEl;
    setPopup({
      id: cl.id,
      label: cl.label,
      total: cl.total,
      members: cl.members,
      x: `${((chip.cx - MAP_VB.x) / MAP_VB.w) * 100}%`,
      y: `${((chip.cy - MAP_VB.y) / MAP_VB.h) * 100}%`,
    });
  }

  return (
    <div className="kv-map-wrap">
      <div className="kv-map-scroll" ref={wrapRef}>
        <div
          style={{ position: "relative", width: "100%", maxWidth: 900 }}
          onClick={() => setPopup(null)}
        >
          <svg
            viewBox={`${MAP_VB.x} ${MAP_VB.y} ${MAP_VB.w} ${MAP_VB.h}`}
            className="kv-map"
            aria-hidden="true"
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
                  style={{ overflow: "visible" }}
                >
                  <button
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
                    aria-label={`${chip.name}: ${chip.count} Unterschriften, Details anzeigen`}
                    aria-expanded={popup ? popup.id === chip.id : false}
                  >
                    <span className="occupation-name">{chip.name}</span>
                    <span className="occupation-count">{chip.count}</span>
                  </button>
                </foreignObject>
              </g>
            ))}
          </svg>
          {popup && (
            <div
              className="kv-map-popup"
              style={{ left: popup.x, top: popup.y }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label={`${popup.label}: ${popup.total} Unterschriften`}
            >
              <div className="kv-map-popup-head">
                <span>{popup.label}</span>
                <button
                  ref={popupCloseRef}
                  onClick={() => setPopup(null)}
                  aria-label="Schließen"
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
                <div className="kv-map-popup-scroll-hint" aria-hidden="true">
                  ▾
                </div>
              )}
            </div>
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
              <span className="occupation-name">Ohne Kreisverband</span>
              <span className="occupation-count">{mapData.ohneCount}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ImpressumModal({ onClose }) {
  const trapRef = useFocusTrap(true);
  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal modal-legal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="impressum-title"
        onClick={(e) => e.stopPropagation()}
        ref={trapRef}
      >
        <div className="modal-head">
          <h3 id="impressum-title">Impressum</h3>
          <button onClick={onClose} aria-label="Schließen">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p>
            <strong>Klinke e.V.</strong>
            <br />
            Marlen Borchardt
            <br />
            Volckmarstr. 5
            <br />
            04317 Leipzig
          </p>
          <p>
            <a href="mailto:kontakt@gehaltsdeckel.jetzt">
              kontakt@gehaltsdeckel.jetzt
            </a>
          </p>
          <p className="modal-disclaimer">
            Diese Website ist kein offizielles Angebot der Partei Die Linke. Es
            handelt sich um eine private Initiative von Parteimitgliedern an der
            Basis.
          </p>
        </div>
      </div>
    </div>
  );
}

function DatenschutzModal({ onClose }) {
  const trapRef = useFocusTrap(true);
  const [deletionEmail, setDeletionEmail] = useState("");
  const [deletionStatus, setDeletionStatus] = useState("idle");

  async function handleDeletion(e) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(deletionEmail.trim())) return;
    setDeletionStatus("submitting");
    try {
      await fetch("/api/request-deletion", {
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
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal modal-legal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="datenschutz-title"
        onClick={(e) => e.stopPropagation()}
        ref={trapRef}
      >
        <div className="modal-head">
          <h3 id="datenschutz-title">Datenschutzerklärung</h3>
          <button onClick={onClose} aria-label="Schließen">
            ×
          </button>
        </div>
        <div className="modal-body modal-legal-body">
          <h4>I. Informationen gemäß Art. 13 DS-GVO</h4>

          <h5>1. Verantwortliche</h5>
          <p>
            Verantwortlich für diese Website ist:
            <br />
            <strong>Klinke e.V.</strong>
            <br />
            Marlen Borchardt
            <br />
            Volckmarstr. 5, 04317 Leipzig
            <br />
            <a href="mailto:kontakt@gehaltsdeckel.jetzt">
              kontakt@gehaltsdeckel.jetzt
            </a>
          </p>
          <p>
            Ein Datenschutzbeauftragter ist nicht zu benennen, da es sich um
            eine private Initiative handelt.
          </p>

          <h5>2. Welche Daten werden verarbeitet?</h5>
          <p>
            <strong>a) Server-Protokolldateien</strong>
            <br />
            Bei jedem Zugriff werden vorübergehend Daten gespeichert:
            IP-Adresse, Datum und Uhrzeit, aufgerufene Seite, Browser und
            Betriebssystem sowie Referrer-URL. Rechtsgrundlage ist Art. 6 Abs. 1
            lit. f DS-GVO (berechtigtes Interesse am sicheren Betrieb). Die
            Protokolldateien werden spätestens nach 7 Tagen gelöscht.
          </p>
          <p>
            <strong>b) Unterschriften</strong>
            <br />
            Beim Mitzeichnen werden Name, E-Mail-Adresse sowie optionaler
            Kreisverband und Beruf gespeichert. Rechtsgrundlage ist deine
            ausdrückliche Einwilligung (Art. 6 Abs. 1 lit. a DS-GVO). Die Daten
            werden <strong>
              ausschließlich für diese Petition verwendet
            </strong>{" "}
            und nicht an Dritte weitergegeben oder für andere Zwecke genutzt.
            Sie werden für die Dauer der Initiative gespeichert und bei
            Beendigung der Kampagne vollständig gelöscht , spätestens jedoch 3
            Jahre nach Unterzeichnung (§ 195 BGB) oder auf frühere Anfrage.
          </p>
          <p>
            <strong>c) Newsletter / Kampagnen-Updates</strong>
            <br />
            Kampagnen-E-Mails werden{" "}
            <strong>
              ausschließlich versendet, wenn du beim Unterschreiben die
              entsprechende Checkbox aktiviert hast
            </strong>
            . Du kannst diese Einwilligung jederzeit widerrufen - über das
            Löschformular unten oder durch Antwort auf eine Kampagnen-E-Mail.
          </p>

          <h5>3. Deine Rechte</h5>
          <p>
            Du hast das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16),
            Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18) sowie
            Datenübertragbarkeit (Art. 20 DS-GVO). Für Anfragen wende dich an{" "}
            <a href="mailto:kontakt@gehaltsdeckel.jetzt">
              kontakt@gehaltsdeckel.jetzt
            </a>
            .
          </p>
          <p>
            Du hast außerdem das Recht, aus Gründen deiner besonderen Situation
            jederzeit Widerspruch gegen die Verarbeitung einzulegen (Art. 21
            Abs. 1 DS-GVO).
          </p>

          <h5>4. Beschwerderecht</h5>
          <p>
            Wenn du der Ansicht bist, dass die Verarbeitung deiner Daten gegen
            Datenschutzrecht verstößt, kannst du dich bei der zuständigen
            Aufsichtsbehörde beschweren:
          </p>
          <p>
            Bundesbeauftragte für den Datenschutz und die Informationsfreiheit
            (BfDI) -{" "}
            <a
              href="https://www.bfdi.bund.de"
              target="_blank"
              rel="noopener noreferrer"
            >
              www.bfdi.bund.de
            </a>
          </p>

          <hr />

          <h5>Unterschrift löschen</h5>
          <p>
            Du kannst deine Unterschrift und alle damit gespeicherten Daten
            jederzeit löschen lassen. Gib dazu deine E-Mail-Adresse ein - wir
            schicken dir einen Löschlink.
          </p>

          {deletionStatus === "sent" ? (
            <p className="deletion-sent">
              Wenn deine E-Mail-Adresse bei uns hinterlegt ist, haben wir dir
              einen Löschlink geschickt. Bitte prüfe auch deinen Spam-Ordner.
            </p>
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
                placeholder="deine@email.de"
                required
                disabled={deletionStatus === "submitting"}
                aria-label="E-Mail-Adresse für Löschanfrage"
              />
              <button type="submit" disabled={deletionStatus === "submitting"}>
                {deletionStatus === "submitting"
                  ? "Wird gesendet…"
                  : "Löschlink anfordern"}
              </button>
              {deletionStatus === "error" && (
                <p className="err" role="alert">
                  Verbindungsfehler. Bitte versuche es erneut.
                </p>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
