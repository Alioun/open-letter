import { useState, useEffect, useMemo, useRef, useCallback } from "react";

const KREISVERBAENDE = [
  "Berlin-Mitte",
  "Berlin-Neukölln",
  "Berlin-Friedrichshain-Kreuzberg",
  "Hamburg-Altona",
  "Hamburg-Mitte",
  "Leipzig",
  "Dresden",
  "Köln",
  "Düsseldorf",
  "Frankfurt am Main",
  "München",
  "Stuttgart",
  "Bremen",
  "Hannover",
  "Nürnberg",
  "Rostock",
  "Erfurt",
  "Magdeburg",
  "Kiel",
  "Saarbrücken",
  "Mainz",
  "Potsdam",
  "Aachen",
  "Bonn",
  "Karlsruhe",
  "Freiburg",
  "Heidelberg",
  "Halle (Saale)",
  "Jena",
  "Chemnitz",
  "Bielefeld",
  "Dortmund",
  "Essen",
  "Duisburg",
  "Wuppertal",
  "Münster",
  "Oldenburg",
  "Göttingen",
  "Kassel",
  "Marburg",
  "Tübingen",
  "Konstanz",
  "Regensburg",
  "Augsburg",
  "Würzburg",
  "Lübeck",
  "Flensburg",
  "Osnabrück",
];

const ZIEL = 100;

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
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + " Tagen";
  if (diff < 86400 * 30) return Math.floor(diff / (86400 * 7)) + " Wo";
  return Math.floor(diff / (86400 * 30)) + " Mon";
}

const KNOWN_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.de", "yahoo.co.uk", "yahoo.fr", "yahoo.at",
  "hotmail.com", "hotmail.de", "hotmail.co.uk", "hotmail.fr",
  "outlook.com", "outlook.de",
  "live.com", "live.de",
  "web.de", "gmx.de", "gmx.net", "gmx.com", "gmx.at", "gmx.ch",
  "t-online.de", "freenet.de", "arcor.de",
  "posteo.de", "posteo.net",
  "protonmail.com", "proton.me", "pm.me",
  "tutanota.com", "tuta.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "mail.com", "hey.com",
  "fastmail.com", "fastmail.fm",
]);

function emailWarning(email) {
  const domain = String(email || "").split("@")[1]?.toLowerCase() || "";
  if (domain === "mailbox.org") return "mailbox";
  if (!KNOWN_EMAIL_DOMAINS.has(domain)) return "custom";
  return null;
}

function scrollTo(id) {
  const el = document.getElementById(id);
  if (el) window.scrollTo({ top: el.offsetTop - 70, behavior: "smooth" });
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

  const emailTrapRef = useFocusTrap(!!emailModal);
  const successTrapRef = useFocusTrap(showSuccess);

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

  useEffect(() => {
    const interval = setInterval(async () => {
      fetchStats();
      try {
        const params = new URLSearchParams({
          filter,
          search,
          limit: "18",
          offset: "0",
        });
        const res = await fetch(`/api/signers?${params}`);
        if (!res.ok) return;
        const data = await res.json();
        setSignersTotal(data.total);
        const newOnes = data.signers
          .filter((s) => !knownIdsRef.current.has(s.id))
          .map((s) => ({ ...s, _isNew: true }));
        if (newOnes.length > 0) {
          newOnes.forEach((s) => knownIdsRef.current.add(s.id));
          setSigners((prev) => [...newOnes, ...prev]);
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

  useEffect(() => {
    setOffset(0);
    knownIdsRef.current.clear();
    fetchSigners(filter, search, 0, false);
  }, [filter, search, fetchSigners]);

  function handleLoadMore() {
    const next = offset + 18;
    setOffset(next);
    fetchSigners(filter, search, next, true);
  }

  async function handleSubmit(data) {
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
        newsletter: !!data.newsletter,
        agree: !!data.agree,
      });
    } catch {
      setSubmitError("Verbindung fehlgeschlagen. Bitte versuche es erneut.");
    }
  }

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
  const pct = Math.min(100, Math.round((total / ZIEL) * 100));

  return (
    <>
      <a href="#main" className="skip-link">
        Zum Inhalt springen
      </a>

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
      {navOpen && (
        <nav
          id="mobile-nav"
          className="mobile-nav"
          aria-label="Mobilnavigation"
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
      )}

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
              <div
                className="counter-card"
                aria-label={`${total.toLocaleString("de-DE")} von ${ZIEL.toLocaleString("de-DE")} Unterschriften`}
              >
                <div className="label">Unterschriften</div>
                <div className="num">
                  {total.toLocaleString("de-DE")}
                  <span className="unit">/ {ZIEL.toLocaleString("de-DE")}</span>
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
                  <div style={{ width: pct + "%" }}></div>
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
                – mit und ohne Funktion – zu Wort. Wir wollen uns konstruktiv in
                die Debatte um den Gehaltsdeckel für Mandatsträger*innen
                einbringen, die in den vergangenen Wochen von Abgeordneten teils
                unschön über die Medien geführt wurde. Denn es ist uns wichtig,
                dass unsere Perspektive gehört wird.
              </p>

              <p>
                Der Parteivorstand hat dem nächsten Bundesparteitag in Potsdam
                einen Antrag zur Begrenzung der Diäten von Mandatsträger*innen
                vorgelegt. Für uns ist dieser Antrag absolut richtig und längst
                überfällig. Denn natürlich ist in einer Partei wie der Linken
                die Rolle von Mandatsträger*innen und ihr Verhältnis zur Partei
                eine zentrale politische Frage. Wir wollen über den Diätendeckel
                demokratisch diskutieren, und zwar auf dem Parteitag. Genau dort
                gehört diese Auseinandersetzung hin. Für uns ist es
                unverständlich, wenn einzelne Abgeordnete diese Debatte über die
                Medien führen. Solche öffentlichen Eskalationen helfen weder der
                Partei noch der inhaltlichen Diskussion.
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
                „Die Linke wurde von uns allen gerettet."
              </div>

              <p>
                Wir erwarten, dass Mandate in der Linken anders verstanden
                werden als in anderen Parteien: als politische Verantwortung
                gegenüber der Partei und den Menschen, die sie tragen. Und nicht
                als persönliche Karrieremöglichkeit. Wenn wir sagen, dass wir
                als Linke Politik anders machen wollen, dann muss sich dieser
                Anspruch auch in unserer politischen Praxis widerspiegeln.
                Gerade in unserer Partei, die beinahe daran zerbrochen wäre,
                dass einzelne Funktionär*innen sie für persönliche Interessen
                missbraucht haben, ist die Debatte über die Rolle und
                Verantwortung von Abgeordneten selbstverständlich. Denn
                Mandatsträger*innen sind Aushängeschilder unserer Politik. An
                ihrem Auftreten wird Die Linke insgesamt gemessen. Wenn unsere
                Mandatsträger*innen ihre Diäten wirksam begrenzen, dann stärkt
                das die Glaubwürdigkeit unserer Partei. Ein wirksamer
                Gehaltsdeckel ist es für uns nur, wenn wir uns an den
                Durchschnittslöhnen in diesem Land orientieren.
              </p>

              <p>
                Wir alle teilen eine Vision. Das Comeback 2025 war nur der erste
                Schritt. Wir wollen die Linke weiter aufbauen, Menschen
                organisieren und so eine nachhaltige sozialistische Politik
                schaffen. In den letzten Monaten haben wir erlebt, zu was wir in
                der Lage sind, wenn wir uns fokussieren und gemeinsam an einem
                Strang ziehen. Genau diesen Weg wollen wir fortsetzen, denn wir
                haben viel zu tun und die Herausforderungen sind groß. Wir
                werden auf dem Parteitag Personalentscheidungen maßgeblich davon
                abhängig machen, wer sich produktiv an dieser Debatte beteiligt.
                Denn die Aufgaben, vor denen wir stehen, gehen weit über einen
                Gehaltsdeckel hinaus. Unsere gemeinsame Aufgabe ist schließlich,
                Die Linke weiter aufzubauen. Das Comeback zur Bundestagswahl
                müssen wir in nachhaltige und glaubwürdige sozialistische
                Politik überführen.
              </p>

              <p className="gruss">Mit solidarischen Grüßen</p>
              <p className="signers-line">
                {total.toLocaleString("de-DE")} Mitglieder und
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
                <span
                  className="num work"
                  style={{
                    fontWeight: 900,
                    fontSize: 14,
                    color: "var(--rot)",
                    letterSpacing: ".05em",
                    display: "block",
                    marginBottom: 12,
                  }}
                >
                  02 / Mitzeichnen
                </span>
                <h2>
                  Setz deinen
                  <br />
                  Namen <span className="rot">drunter.</span>
                </h2>
                <p className="lead">
                  Wir sind die Partei. Wenn unsere Abgeordneten nicht von selbst
                  handeln, müssen wir sie erinnern.
                </p>
                <ul>
                  <li>
                    Du bist Mitglied oder Sympathisant:in der Partei Die Linke.
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

              <SignForm onSubmit={handleSubmit} serverError={submitError} />
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
                <span
                  className="num work"
                  style={{
                    fontWeight: 900,
                    fontSize: 14,
                    color: "var(--rot)",
                    letterSpacing: ".05em",
                    display: "block",
                    marginBottom: 8,
                  }}
                >
                  03 / Schon dabei
                </span>
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

            <div className="filters">
              <button
                className={"filter-chip " + (filter === "alle" ? "active" : "")}
                onClick={() => setFilter("alle")}
              >
                Alle
              </button>
              <button
                className={
                  "filter-chip " + (filter === "heute" ? "active" : "")
                }
                onClick={() => setFilter("heute")}
              >
                Heute
              </button>
              <button
                className={"filter-chip " + (filter === "kv" ? "active" : "")}
                onClick={() => setFilter("kv")}
              >
                Mit Kreisverband
              </button>
              <input
                className="search"
                placeholder="Suchen nach Name oder Kreisverband…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Suche nach Name oder Kreisverband"
              />
            </div>

            {error && (
              <p
                style={{
                  color: "var(--rot)",
                  textAlign: "center",
                  padding: 20,
                }}
              >
                {error}
              </p>
            )}

            {loading && signers.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: 40,
                  color: "var(--grau)",
                }}
              >
                Lade Unterschriften…
              </div>
            ) : (
              <>
                <div className="signers-grid">
                  {signers.map((s) => (
                    <div
                      key={s.id}
                      className={"signer" + (s._isNew ? " new" : "")}
                    >
                      <div className="avatar">{initials(s.name)}</div>
                      <div className="info">
                        <div className="name">{s.name}</div>
                        <div className="kv">
                          {s.kreisverband
                            ? "KV " + s.kreisverband
                            : "Ohne Kreisverband"}
                        </div>
                      </div>
                      <div className="time">vor {relTime(s.created_at)}</div>
                    </div>
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
              <div className="footer-disclaimer">
                Diese Seite wurde nicht von der Partei Die Linke herausgegeben.
                Es handelt sich um eine Initiative von Parteimitgliedern an der
                Basis.
              </div>
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
              {emailWarning(emailModal.email) === "mailbox" && (
                <div className="mail-warning">
                  <strong>Achtung:</strong> mailbox.org blockiert leider Bestätigungs-E-Mails von unserer Domain. Bitte verwende eine andere E-Mail-Adresse (z.B. Gmail, GMX oder Posteo).
                </div>
              )}
              {emailWarning(emailModal.email) === "custom" && (
                <div className="mail-warning mail-warning--soft">
                  <strong>Hinweis:</strong> Bei privaten oder Organisations-Domains kann die Zustellung verzögert sein oder im Spam landen.
                </div>
              )}
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
                  ? `E-Mail gesendet ✓ — nochmal in ${resendCooldown}s`
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
                >
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
              <p className="success-title">Solidarisch dabei.</p>
              <p>
                Deine Unterschrift ist jetzt Teil des offenen Briefes. Teile ihn
                mit deinem Kreisverband - wir wollen vor dem nächsten Parteitag
                bei 100 stehen.
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

function SignForm({ onSubmit, serverError }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [kv, setKv] = useState("");
  const [agree, setAgree] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const kvMatches = useMemo(() => {
    if (!kv) return [];
    const q = kv.toLowerCase();
    return KREISVERBAENDE.filter((k) => k.toLowerCase().includes(q)).slice(
      0,
      6,
    );
  }, [kv]);

  function validate() {
    const e = {};
    if (name.trim().length < 2)
      e.name = "Bitte gib deinen vollständigen Namen an.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      e.email = "Bitte gib eine gültige E-Mail-Adresse an.";
    // agree is optional – name is shown publicly only if checked
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(e) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    await onSubmit({
      name: name.trim(),
      email: email.trim(),
      kv: kv.trim(),
      newsletter,
      agree,
    });
    setSubmitting(false);
    setName("");
    setEmail("");
    setKv("");
    setAgree(false);
    setNewsletter(false);
    setErrors({});
  }

  return (
    <form className="form-card" onSubmit={submit} noValidate>
      <span className="badge">Mitzeichnen</span>
      <h3>Unterschreiben in 30 Sekunden</h3>
      <div className="sub2">
        Drei Felder, eine Bestätigung per E-Mail — fertig.
      </div>

      {serverError && (
        <div className="err" style={{ marginBottom: 16 }} role="alert">
          {serverError}
        </div>
      )}

      <div className="field">
        <label htmlFor="sign-name">
          Name <span className="opt">— wird öffentlich gezeigt</span>
        </label>
        <input
          id="sign-name"
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
          <span className="opt">— nur zur Verifizierung, nicht öffentlich</span>
        </label>
        <input
          id="sign-email"
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
          Kreisverband <span className="opt">— optional</span>
        </label>
        <input
          id="sign-kv"
          type="text"
          value={kv}
          onChange={(e) => {
            setKv(e.target.value);
            setShowSuggest(true);
          }}
          onFocus={() => setShowSuggest(true)}
          onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
          placeholder="z. B. Berlin-Neukölln"
          autoComplete="off"
          role="combobox"
          aria-expanded={showSuggest && kv && kvMatches.length > 0}
          aria-autocomplete="list"
          aria-controls="kv-listbox"
        />
        {showSuggest && kv && kvMatches.length > 0 && (
          <div id="kv-listbox" role="listbox" className="autocomplete-dropdown">
            {kvMatches.map((k) => (
              <div
                key={k}
                role="option"
                onMouseDown={() => {
                  setKv(k);
                  setShowSuggest(false);
                }}
                className="autocomplete-option"
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
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
          />
          <span>
            Mein <strong>Name (und ggf. Kreisverband)</strong> darf öffentlich
            auf dieser Seite angezeigt werden.{" "}
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
            <strong>Marlen Borchardt</strong>
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
          <p style={{ marginTop: 16, color: "var(--grau)", fontSize: 13 }}>
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
            <strong>Marlen Borchardt</strong>
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
            Kreisverband gespeichert. Rechtsgrundlage ist deine ausdrückliche
            Einwilligung (Art. 6 Abs. 1 lit. a DS-GVO). Die Daten werden{" "}
            <strong>ausschließlich für diese Petition verwendet</strong> und
            nicht an Dritte weitergegeben oder für andere Zwecke genutzt. Sie
            werden für die Dauer der Initiative gespeichert und bei Beendigung
            der Kampagne vollständig gelöscht — spätestens jedoch 3 Jahre nach
            Unterzeichnung (§ 195 BGB) oder auf frühere Anfrage.
          </p>
          <p>
            <strong>c) Newsletter / Kampagnen-Updates</strong>
            <br />
            Kampagnen-E-Mails werden{" "}
            <strong>
              ausschließlich versendet, wenn du beim Unterschreiben die
              entsprechende Checkbox aktiviert hast
            </strong>
            . Du kannst diese Einwilligung jederzeit widerrufen — über das
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
            (BfDI) —{" "}
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
            jederzeit löschen lassen. Gib dazu deine E-Mail-Adresse ein — wir
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
