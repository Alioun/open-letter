import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { Checkbox } from "@base-ui/react/checkbox";
import { Collapsible } from "@base-ui/react/collapsible";
import { Menu } from "@base-ui/react/menu";
import cfg from "../config/letter.config.js";
import { useAdminRead, AdminReadStatus } from "./admin-read.jsx";
import { Breakable, EmptyState, Notice, SelectControl } from "./ui.jsx";
import Pager from "./Pager.jsx";
import SignerEditPanel from "./SignerEditPanel.jsx";
import SignerLookup from "./SignerLookup.jsx";
import { LinkDuplicateDialog, PositionField } from "./FirstSigners.jsx";
import {
  firstSignerBadges,
  setMark,
  setPosition,
} from "./first-signer-admin.js";
import { logTime } from "./admin-log-format.js";
import { signerDateRange } from "./signer-filters.js";
import {
  SIGNER_PAGE_SIZE,
  SIGNER_PAGE_SIZE_PHONE,
  downloadCsv,
  eraseSigner,
  isSignerList,
  removeSigner,
  removeSigners,
  saveSigner,
  signerListPath,
  unblockSigner,
} from "./signer-admin.js";

const MEETING_ON = Boolean(cfg.features.zoomEvent);
const PHONE = "(max-width: 650px)";

function usePhone() {
  const [phone, setPhone] = useState(
    () => typeof window !== "undefined" && window.matchMedia(PHONE).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const update = () => setPhone(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}

// What goes with a signature when its address is erased.
const ERASED = MEETING_ON
  ? "die Unterschrift, die Anmeldung zum Treffen und alle noch nicht gesendeten E-Mails an diese Adresse"
  : "die Unterschrift und alle noch nicht gesendeten E-Mails an diese Adresse";

const isFirstSigner = (signer) => signer.firstSigner || signer.position != null;

function Badges({ signer }) {
  const badges = firstSignerBadges(signer);
  if (!badges.length) return null;
  return (
    <span className="signer-badges">
      {badges.map((badge) => (
        <span
          key={badge}
          className={`admin-status signer-badge${badge === "Mögliches Duplikat" ? " signer-badge--warning" : ""}`}
        >
          {badge}
        </span>
      ))}
    </span>
  );
}

const NO_ADDRESS = "Von Hand eingetragen, ohne E-Mail-Adresse";

const UNBLOCK_MESSAGES = {
  unblocked:
    "Die Sperre ist aufgehoben. Die Adresse kann wieder unterschreiben.",
  "not-blocked": "Für diese Adresse gab es keine Sperre.",
  invalid: "Bitte gib eine gültige E-Mail-Adresse ein.",
};

function UnblockForm({ api, onUnblocked }) {
  const fieldId = useId();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const outcome = await unblockSigner(api, email.trim());
      setResult({ kind: outcome === "invalid" ? "alert" : "status", outcome });
      if (outcome === "unblocked") {
        setEmail("");
        onUnblocked?.();
      }
    } catch {
      setResult({ kind: "alert", outcome: "failed" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="signer-unblock" onSubmit={submit}>
      <h3 className="admin-card-title">Sperre aufheben</h3>
      <p className="admin-muted">
        Für eine versehentlich gesperrte Adresse. Varianten wie name+zusatz@…
        zählen als dieselbe Adresse.
      </p>
      <div className="field">
        <label htmlFor={`${fieldId}-email`}>E-Mail-Adresse</label>
        <Input
          id={`${fieldId}-email`}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="off"
        />
      </div>
      <Button
        type="submit"
        className="admin-button"
        disabled={busy || !email.trim()}
      >
        {busy ? "Wird aufgehoben…" : "Sperre aufheben"}
      </Button>
      {result && (
        <Notice
          tone={
            result.kind === "alert"
              ? "error"
              : result.outcome === "unblocked"
                ? "success"
                : "info"
          }
        >
          {UNBLOCK_MESSAGES[result.outcome] ||
            "Die Sperre konnte nicht aufgehoben werden. Bitte erneut versuchen."}
        </Notice>
      )}
    </form>
  );
}

function SelectBox({ checked, onChange, label }) {
  return (
    <Checkbox.Root
      className="admin-checkbox"
      aria-label={label}
      checked={checked}
      onCheckedChange={onChange}
    >
      <Checkbox.Indicator aria-hidden="true">✓</Checkbox.Indicator>
    </Checkbox.Root>
  );
}

// The actions of one row: [label, run(signer, element), kind].
function rowActions(signer, actions) {
  return [
    ["Bearbeiten", actions.edit],
    signer.position == null
      ? ["Nach oben anheften", actions.pin]
      : ["Position entfernen", actions.unpin],
    signer.firstSigner
      ? ["Markierung als Erstunterzeichner*in entfernen", actions.unmark]
      : ["Als Erstunterzeichner*in markieren", actions.mark],
    signer.possibleDuplicate && ["Mit Duplikat verknüpfen", actions.link],
    signer.showPublicly && ["Nicht öffentlich zeigen", actions.hide],
    signer.handAdded
      ? ["Löschen", actions.erase, "danger"]
      : ["Löschen ohne Sperre", actions.erase],
    !signer.handAdded && ["Entfernen und sperren", actions.remove, "danger"],
  ].filter(Boolean);
}

function ActionMenu({ signer, actions, disabled }) {
  const trigger = useRef(null);
  const [edit, ...more] = rowActions(signer, actions);
  return (
    <>
      <Button
        type="button"
        className="admin-button admin-button--small"
        disabled={disabled}
        aria-label={`${signer.name} bearbeiten`}
        onClick={(event) => edit[1](signer, event.currentTarget)}
      >
        Bearbeiten
      </Button>
      <Menu.Root>
        <Menu.Trigger
          ref={trigger}
          className="admin-button admin-button--small"
          disabled={disabled}
          aria-label={`Weitere Aktionen für ${signer.name}`}
        >
          Mehr
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner
            className="admin-choice-positioner"
            align="end"
            sideOffset={4}
          >
            <Menu.Popup className="admin-choice-popup">
              {more.map(([label, run, kind]) => (
                <Menu.Item
                  key={label}
                  className={`admin-choice-item${kind === "danger" ? " admin-choice-item--danger" : ""}`}
                  onClick={() => run(signer, trigger.current)}
                >
                  {label}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </>
  );
}

export function SignerTable({
  signers,
  details,
  busy,
  actions,
  selected,
  onSelect,
  onSelectPage,
}) {
  const detailsOf = (signer) =>
    details
      .map((key) => signer[key])
      .filter(Boolean)
      .join(" · ");
  const publicState = (signer) =>
    !signer.showPublicly
      ? "Nein"
      : details.length > 0 && !signer.showSignerDetails
        ? "Nur Name"
        : "Ja";
  const selectable = signers.filter((signer) => !signer.handAdded);
  const allSelected =
    selectable.length > 0 &&
    selectable.every((signer) => selected.has(signer.id));
  return (
    <>
      <ul className="admin-cards" aria-label="Unterschriften">
        {signers.map((signer) => (
          <li
            key={signer.id}
            className={selected.has(signer.id) ? "is-selected" : ""}
          >
            <label className="signer-card-identity">
              {!signer.handAdded && (
                <SelectBox
                  checked={selected.has(signer.id)}
                  onChange={(checked) => onSelect(signer, checked)}
                  label={`${signer.name} auswählen`}
                />
              )}
              <span className="admin-card-person">
                <strong>{signer.name}</strong>
                <span>
                  {signer.handAdded ? (
                    NO_ADDRESS
                  ) : (
                    <Breakable text={signer.email} />
                  )}
                </span>
              </span>
            </label>
            <Badges signer={signer} />
            <PositionField
              signer={signer}
              disabled={busy}
              onSet={actions.position}
            />
            <dl className="admin-facts">
              {detailsOf(signer) && (
                <div>
                  <dt>Angaben</dt>
                  <dd>{detailsOf(signer)}</dd>
                </div>
              )}
              <div>
                <dt>Öffentlich</dt>
                <dd>{publicState(signer)}</dd>
              </div>
              <div>
                <dt>Newsletter</dt>
                <dd>{signer.newsletter ? "Ja" : "Nein"}</dd>
              </div>
              <div>
                <dt>Unterschrieben</dt>
                <dd>{logTime(signer.createdAt)}</dd>
              </div>
            </dl>
            <div className="signer-card-actions">
              {rowActions(signer, actions).map(([label, run, kind]) => (
                <Button
                  key={label}
                  type="button"
                  className={`admin-button admin-button--small${kind === "danger" ? " admin-button--danger-secondary" : ""}`}
                  disabled={busy}
                  onClick={(event) => run(signer, event.currentTarget)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="admin-table-wrap has-cards">
        <table className="admin-table signature-table">
          <thead>
            <tr>
              <th scope="col" className="admin-sticky admin-table-check">
                <SelectBox
                  checked={allSelected}
                  onChange={onSelectPage}
                  label="Alle auf dieser Seite auswählen"
                />
              </th>
              <th scope="col" className="admin-sticky admin-sticky-edge">
                Name
              </th>
              <th scope="col">E-Mail</th>
              <th scope="col">Position</th>
              <th scope="col">Öffentlich</th>
              <th scope="col">Newsletter</th>
              <th scope="col">Unterschrieben</th>
              {details.length > 0 && <th scope="col">Angaben</th>}
              <th scope="col" className="admin-row-action">
                <span className="sr-only">Aktionen</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {signers.map((signer) => (
              <tr key={signer.id} aria-selected={selected.has(signer.id)}>
                <td className="admin-sticky admin-table-check">
                  {!signer.handAdded && (
                    <SelectBox
                      checked={selected.has(signer.id)}
                      onChange={(checked) => onSelect(signer, checked)}
                      label={`${signer.name} auswählen`}
                    />
                  )}
                </td>
                <td className="admin-sticky admin-sticky-edge admin-cell-wrap">
                  {signer.name}
                  <Badges signer={signer} />
                </td>
                <td className="admin-cell-wrap">
                  {signer.handAdded ? (
                    <span className="admin-muted">{NO_ADDRESS}</span>
                  ) : (
                    <Breakable text={signer.email} />
                  )}
                </td>
                <td>
                  <PositionField
                    signer={signer}
                    disabled={busy}
                    onSet={actions.position}
                    compact
                  />
                </td>
                <td>{publicState(signer)}</td>
                <td>{signer.newsletter ? "Ja" : "Nein"}</td>
                <td>{logTime(signer.createdAt)}</td>
                {details.length > 0 && (
                  <td className="admin-cell-wrap">
                    {detailsOf(signer) || "–"}
                  </td>
                )}
                <td className="admin-row-action">
                  <ActionMenu
                    signer={signer}
                    actions={actions}
                    disabled={busy}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const isBlockList = (data) =>
  Number.isInteger(data?.total) && Array.isArray(data.blocks);

function Blocks({ api, blocks, onUnblocked }) {
  const total = blocks.data?.total ?? 0;
  const dates = blocks.data?.blocks ?? [];
  return (
    <>
      <p className="admin-muted">
        Eine gesperrte Adresse ist nur als verschlüsselte Prüfsumme gespeichert,
        nicht die Adresse selbst. Deshalb zeigt diese Liste keine Adressen,
        sondern nur, wie viele gesperrt sind und seit wann.
      </p>
      {blocks.data && total === 0 && (
        <EmptyState compact title="Derzeit ist keine Adresse gesperrt." />
      )}
      {total > 0 && (
        <>
          <p>
            <strong>
              {total === 1
                ? "1 Adresse ist gesperrt."
                : `${total.toLocaleString("de-DE")} Adressen sind gesperrt.`}
            </strong>
            {total > dates.length && ` Die letzten ${dates.length} Sperren:`}
          </p>
          <ul className="signer-blocks">
            {dates.map((at, index) => (
              <li key={`${at}-${index}`}>Gesperrt am {logTime(at)}</li>
            ))}
          </ul>
        </>
      )}
      <UnblockForm api={api} onUnblocked={onUnblocked} />
    </>
  );
}

function Exports({ api }) {
  const [state, setState] = useState(null);
  async function download(path) {
    setState({ path, busy: true });
    try {
      setState({ name: await downloadCsv(api, path) });
    } catch {
      setState({ failed: true });
    }
  }
  const button = (path, label) => (
    <Button
      type="button"
      className="admin-button"
      disabled={Boolean(state?.busy)}
      onClick={() => download(path)}
    >
      {state?.busy && state.path === path ? "Wird erstellt…" : label}
    </Button>
  );
  return (
    <div className="signer-exports">
      <h3 className="admin-card-title">Export</h3>
      <p className="admin-muted">
        Als CSV-Datei für Excel und andere Tabellenprogramme. Die Dateien
        enthalten keine E-Mail-Adressen; die Liste der Unterschriften nur, was
        auch öffentlich auf der Website steht. Jeder Export wird im Protokoll
        vermerkt.
      </p>
      <div className="admin-actions">
        {button("/api/admin/export/signers.csv", "Öffentliche Unterschriften")}
        {MEETING_ON &&
          button(
            "/api/admin/export/meeting-registrations.csv",
            "Anmeldungen zum Treffen",
          )}
      </div>
      {state?.name && (
        <Notice tone="success">
          Die Datei „{state.name}“ wurde heruntergeladen.
        </Notice>
      )}
      {state?.failed && (
        <Notice tone="error">
          Der Export ist fehlgeschlagen. Bitte erneut versuchen.
        </Notice>
      )}
    </div>
  );
}

const NO_FILTERS = { search: "", from: "", to: "", visibility: "" };

// `version` changes when the first signers changed elsewhere on the page;
// `onChanged` tells the page this list changed something.
export default function SignerManagement({
  api,
  enabled,
  askConfirmation,
  details,
  version: outsideVersion = 0,
  onChanged,
}) {
  const fieldId = useId();
  const phone = usePhone();
  const pageSize = phone ? SIGNER_PAGE_SIZE_PHONE : SIGNER_PAGE_SIZE;
  const [filters, setFilters] = useState(NO_FILTERS);
  const [applied, setApplied] = useState(NO_FILTERS);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(() => new Map());
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [editing, setEditing] = useState(null);
  const [linking, setLinking] = useState(null);
  const [version, setVersion] = useState(0);
  const feedbackBox = useRef(null);
  const dateError = signerDateRange("custom", filters.from, filters.to).error;

  useEffect(() => {
    if (dateError) return undefined;
    const timer = setTimeout(() => {
      setApplied(filters);
      setPage(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [filters, dateError]);
  useEffect(() => setPage(0), [pageSize]);
  // A result is read out and reachable right where the action left off.
  useEffect(() => {
    if (feedback) feedbackBox.current?.focus();
  }, [feedback]);

  const list = useAdminRead(
    api,
    signerListPath(applied, page, pageSize),
    enabled,
    isSignerList,
  );
  const blocks = useAdminRead(
    api,
    "/api/admin/signers/blocks",
    enabled,
    isBlockList,
  );
  const seenOutside = useRef(outsideVersion);
  const reloadList = list.reload;
  useEffect(() => {
    if (seenOutside.current === outsideVersion) return;
    seenOutside.current = outsideVersion;
    reloadList();
  }, [outsideVersion, reloadList]);
  const signers = list.data?.signers ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const filtered = Object.values(applied).some(Boolean);

  async function refresh(removedFromPage = 0) {
    setVersion((before) => before + 1);
    onChanged?.();
    blocks.reload();
    if (removedFromPage >= signers.length && page > 0) setPage(page - 1);
    else await list.reload();
  }
  const forget = (ids) =>
    setSelected((before) => {
      const next = new Map(before);
      for (const id of ids) next.delete(id);
      return next;
    });

  // Runs one moderation step: feedback is cleared, shown, and the list read
  // again whatever the outcome.
  async function act(work, failed, removedFromPage = 0) {
    setBusy(true);
    setFeedback(null);
    try {
      setFeedback(await work());
    } catch {
      setFeedback({ tone: "error", text: failed });
    } finally {
      await refresh(removedFromPage);
      setBusy(false);
    }
  }

  const pinnedWarning = (signer) => {
    const facts = [
      signer.firstSigner && "ist als Erstunterzeichner*in markiert",
      signer.position != null &&
        `steht an Position ${signer.position} oben in der öffentlichen Liste`,
    ].filter(Boolean);
    return facts.length ? ` Achtung: Diese Person ${facts.join(" und ")}.` : "";
  };

  async function remove(signer, returnFocus) {
    const confirmed = await askConfirmation(
      `„${signer.name}“ (${signer.email}) wird entfernt. Gelöscht werden ${ERASED}. Die Unterschrift verschwindet aus dem Zähler und der öffentlichen Liste. Die Adresse wird gesperrt und kann nicht erneut unterschreiben. Das lässt sich nicht rückgängig machen.${pinnedWarning(signer)}`,
      {
        returnFocus,
        title: "Unterschrift entfernen und Adresse sperren?",
        confirmLabel: "Entfernen und sperren",
        danger: true,
      },
    );
    if (!confirmed) return;
    await act(
      async () => {
        const { outcome, variants } = await removeSigner(api, signer);
        forget([signer.id]);
        return outcome === "removed"
          ? {
              tone: "success",
              text: `„${signer.name}“ wurde entfernt. Die Adresse ${signer.email} ist gesperrt.`,
              unblock: signer.email,
              variants,
            }
          : { tone: "info", text: `„${signer.name}“ war bereits entfernt.` };
      },
      `„${signer.name}“ konnte nicht entfernt werden. Bitte erneut versuchen.`,
      1,
    );
  }

  async function erase(signer, returnFocus) {
    const confirmed = await askConfirmation(
      signer.handAdded
        ? `Der von Hand angelegte Eintrag „${signer.name}“ wird gelöscht und verschwindet aus dem Zähler und der öffentlichen Liste. Das lässt sich nicht rückgängig machen.${pinnedWarning(signer)}`
        : `„${signer.name}“ (${signer.email}) wird gelöscht: ${ERASED}. Die Adresse wird nicht gesperrt und kann erneut unterschreiben. Das lässt sich nicht rückgängig machen.${pinnedWarning(signer)}`,
      {
        returnFocus,
        title: "Unterschrift löschen?",
        confirmLabel: "Löschen",
        danger: true,
      },
    );
    if (!confirmed) return;
    await act(
      async () => {
        const outcome = await eraseSigner(api, signer);
        forget([signer.id]);
        return outcome === "erased"
          ? {
              tone: "success",
              text: signer.handAdded
                ? `„${signer.name}“ wurde gelöscht.`
                : `„${signer.name}“ wurde gelöscht. Die Adresse ist nicht gesperrt.`,
            }
          : { tone: "info", text: `„${signer.name}“ war bereits gelöscht.` };
      },
      `„${signer.name}“ konnte nicht gelöscht werden. Bitte erneut versuchen.`,
      1,
    );
  }

  async function hide(signer, returnFocus) {
    const confirmed = await askConfirmation(
      `„${signer.name}“ erscheint dann nicht mehr in der öffentlichen Liste. Die Unterschrift zählt weiter. Wieder öffentlich zeigen geht nur mit Zustimmung der Person.`,
      {
        returnFocus,
        title: "Nicht mehr öffentlich zeigen?",
        confirmLabel: "Nicht öffentlich zeigen",
      },
    );
    if (!confirmed) return;
    await act(async () => {
      await saveSigner(api, signer.id, { showPublicly: false });
      return {
        tone: "success",
        text: `„${signer.name}“ wird nicht mehr öffentlich gezeigt.`,
      };
    }, `„${signer.name}“ konnte nicht geändert werden. Bitte erneut versuchen.`);
  }

  // `people`: [{ id, name, firstSigner, position }]
  async function removeMany(people, returnFocus, title) {
    const count = people.length;
    const pinned = people.filter(isFirstSigner).length;
    const confirmed = await askConfirmation(
      `${count === 1 ? "1 Eintrag wird" : `${count} Einträge werden`} entfernt. Gelöscht werden jeweils ${ERASED}. ${count === 1 ? "Die Adresse wird" : `Alle ${count} Adressen werden`} gesperrt und ${count === 1 ? "kann" : "können"} nicht erneut unterschreiben. Das lässt sich nicht rückgängig machen.${pinned ? ` Achtung: Darunter ${pinned === 1 ? "ist 1 Erstunterzeichner*in" : `sind ${pinned} Erstunterzeichner*innen`}.` : ""}`,
      {
        returnFocus,
        title,
        confirmLabel:
          count === 1
            ? "Entfernen und sperren"
            : `${count} entfernen und sperren`,
        danger: true,
      },
    );
    if (!confirmed) return;
    const ids = people.map((person) => person.id);
    await act(
      async () => {
        let removed = 0;
        const variants = [];
        for (let start = 0; start < ids.length; start += 100) {
          const result = await removeSigners(
            api,
            ids.slice(start, start + 100),
          );
          removed += result.removed;
          variants.push(...result.variants);
        }
        forget(ids);
        return {
          tone: "success",
          text:
            removed === 1
              ? "1 Eintrag wurde entfernt, die Adresse ist gesperrt."
              : `${removed} Einträge wurden entfernt, ihre Adressen sind gesperrt.`,
          variants: variants.filter((variant) => !ids.includes(variant.id)),
        };
      },
      "Die Auswahl konnte nicht vollständig entfernt werden. Die Liste zeigt, was noch da ist. Bitte erneut versuchen.",
      ids.filter((id) => signers.some((signer) => signer.id === id)).length,
    );
  }

  async function unblock(email) {
    await act(async () => {
      const outcome = await unblockSigner(api, email);
      return {
        tone: outcome === "unblocked" ? "success" : "info",
        text:
          outcome === "unblocked"
            ? `Die Sperre für ${email} ist aufgehoben. Die Adresse kann wieder unterschreiben.`
            : UNBLOCK_MESSAGES[outcome],
      };
    }, "Die Sperre konnte nicht aufgehoben werden. Bitte erneut versuchen.");
  }

  // A first-signer change: one request, then the list (and the order card)
  // read again.
  const firstSignerStep = (signer, work, done) =>
    act(
      async () => ({ tone: "success", text: done(await work()) }),
      `„${signer.name}“ konnte nicht geändert werden. Bitte erneut versuchen.`,
    );

  const actions = {
    edit: (signer, returnFocus) => setEditing({ id: signer.id, returnFocus }),
    hide,
    erase,
    remove,
    unblock,
    pin: (signer) =>
      firstSignerStep(
        signer,
        () => setPosition(api, signer.id, "last"),
        ({ position }) =>
          `„${signer.name}“ steht jetzt an Position ${position}. Die Reihenfolge lässt sich unter „Erstunterzeichner*innen“ ändern.`,
      ),
    unpin: (signer) =>
      firstSignerStep(
        signer,
        () => setPosition(api, signer.id, null),
        () => `„${signer.name}“ hat keine feste Position mehr.`,
      ),
    position: (signer, position) =>
      firstSignerStep(
        signer,
        () => setPosition(api, signer.id, position),
        ({ position: now }) =>
          now == null
            ? `„${signer.name}“ hat keine feste Position mehr.`
            : `„${signer.name}“ steht jetzt an Position ${now}.`,
      ),
    mark: (signer) =>
      firstSignerStep(
        signer,
        () => setMark(api, signer.id, true),
        () =>
          `„${signer.name}“ ist als Erstunterzeichner*in markiert. Die öffentliche Liste zeigt „${cfg.ui.list.firstSigner}“ unter dem Namen.`,
      ),
    unmark: (signer) =>
      firstSignerStep(
        signer,
        () => setMark(api, signer.id, false),
        () =>
          `„${signer.name}“ ist nicht mehr als Erstunterzeichner*in markiert.`,
      ),
    link: (signer, returnFocus) => setLinking({ signer, returnFocus }),
  };
  const select = (signer, checked) =>
    setSelected((before) => {
      const next = new Map(before);
      if (checked) next.set(signer.id, signer);
      else next.delete(signer.id);
      return next;
    });
  const setFilter = (field) => (event) =>
    setFilters((before) => ({ ...before, [field]: event.target.value }));
  const variants = feedback?.variants ?? [];

  return (
    <div className="admin-card">
      <h2 className="admin-card-title">Unterschriften prüfen</h2>
      <p className="admin-muted">
        Alle bestätigten Unterschriften, neueste zuerst. Du kannst Angaben
        korrigieren, eine Unterschrift aus der öffentlichen Liste nehmen, sie
        löschen oder sie entfernen und ihre Adresse sperren.
      </p>
      <div className="signer-tools">
        <Collapsible.Root>
          <Collapsible.Trigger className="admin-disclosure-trigger">
            Adresse nachschlagen
          </Collapsible.Trigger>
          <Collapsible.Panel className="signer-tool-panel">
            <SignerLookup
              api={api}
              busy={busy}
              actions={actions}
              version={version}
            />
          </Collapsible.Panel>
        </Collapsible.Root>
        <Collapsible.Root>
          <Collapsible.Trigger className="admin-disclosure-trigger">
            Gesperrte Adressen
            {blocks.data ? ` (${blocks.data.total})` : ""} und Sperre aufheben
          </Collapsible.Trigger>
          <Collapsible.Panel className="signer-tool-panel">
            <Blocks api={api} blocks={blocks} onUnblocked={() => refresh()} />
          </Collapsible.Panel>
        </Collapsible.Root>
      </div>

      <div className="signature-filters">
        <div className="field">
          <label htmlFor={`${fieldId}-search`}>Suche (Name oder E-Mail)</label>
          <Input
            id={`${fieldId}-search`}
            type="search"
            value={filters.search}
            onChange={setFilter("search")}
            placeholder="Suchen…"
          />
        </div>
        <div className="field">
          <label htmlFor={`${fieldId}-from`}>Unterschrieben von</label>
          <Input
            id={`${fieldId}-from`}
            type="date"
            value={filters.from}
            onChange={setFilter("from")}
          />
        </div>
        <div className="field">
          <label htmlFor={`${fieldId}-to`}>bis</label>
          <Input
            id={`${fieldId}-to`}
            type="date"
            value={filters.to}
            onChange={setFilter("to")}
          />
        </div>
        <div className="field">
          <label htmlFor={`${fieldId}-public`}>Öffentlich gezeigt</label>
          <SelectControl
            id={`${fieldId}-public`}
            aria-label="Öffentlich gezeigt"
            value={filters.visibility}
            onChange={setFilter("visibility")}
          >
            <option value="">Alle</option>
            <option value="public">Ja</option>
            <option value="hidden">Nein</option>
          </SelectControl>
        </div>
      </div>
      {dateError && <Notice tone="error">{dateError}</Notice>}

      {feedback && (
        <Notice
          ref={feedbackBox}
          tabIndex={-1}
          tone={feedback.tone}
          className="signer-feedback"
          action={
            feedback.unblock && (
              <Button
                type="button"
                className="admin-button admin-button--small"
                disabled={busy}
                onClick={() => unblock(feedback.unblock)}
              >
                Sperre aufheben
              </Button>
            )
          }
        >
          {feedback.text}
        </Notice>
      )}
      {variants.length > 0 && (
        <Notice
          tone="warning"
          title={
            variants.length === 1
              ? "1 weitere Variante derselben Adresse"
              : `${variants.length} weitere Varianten derselben Adresse`
          }
          action={
            <Button
              type="button"
              className="admin-button admin-button--danger-secondary admin-button--small"
              disabled={busy}
              onClick={(event) =>
                removeMany(
                  variants,
                  event.currentTarget,
                  "Varianten derselben Adresse entfernen und sperren?",
                )
              }
            >
              {variants.length === 1
                ? "Auch entfernen"
                : `Alle ${variants.length} auch entfernen`}
            </Button>
          }
        >
          <span>
            Dieselbe Person kann sich mit Zusätzen wie name+zusatz@… mehrfach
            eintragen. Diese Einträge sind noch da:
          </span>
          <ul className="signer-variants">
            {variants.map((variant) => (
              <li key={variant.id}>
                {variant.name} · <Breakable text={variant.email} />
                {!variant.verified && " (noch nicht bestätigt)"}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <AdminReadStatus resource={list} label="Unterschriften" />
      {list.data && (
        <>
          <div className="signer-count">
            <p className="admin-muted">
              {total.toLocaleString("de-DE")}{" "}
              {filtered ? "Treffer" : "Unterschriften"}
              {list.data.fuzzy &&
                ". Kein Name und keine Adresse enthält den Suchbegriff genau; das sind ähnliche Namen."}
            </p>
            {selected.size > 0 && (
              <div className="signer-selection-actions">
                <span>{selected.size} ausgewählt</span>
                <Button
                  type="button"
                  className="admin-button admin-button--danger-secondary admin-button--small"
                  disabled={busy}
                  onClick={(event) =>
                    removeMany(
                      [...selected.values()],
                      event.currentTarget,
                      "Ausgewählte Unterschriften entfernen und Adressen sperren?",
                    )
                  }
                >
                  Ausgewählte entfernen und sperren
                </Button>
                <Button
                  type="button"
                  className="admin-button admin-button--quiet admin-button--small"
                  onClick={() => setSelected(new Map())}
                >
                  Auswahl aufheben
                </Button>
              </div>
            )}
          </div>
          {signers.length > 0 ? (
            <SignerTable
              signers={signers}
              details={details}
              busy={busy}
              actions={actions}
              selected={selected}
              onSelect={select}
              onSelectPage={(checked) =>
                setSelected((before) => {
                  const next = new Map(before);
                  for (const signer of signers)
                    if (checked) next.set(signer.id, signer);
                    else next.delete(signer.id);
                  return next;
                })
              }
            />
          ) : (
            <EmptyState compact title="Keine Unterschriften gefunden." />
          )}
          <Pager page={page} pages={pages} onPage={setPage} />
        </>
      )}
      <Exports api={api} />
      {linking && (
        <LinkDuplicateDialog
          api={api}
          signer={linking.signer}
          returnFocus={linking.returnFocus}
          onClose={() => setLinking(null)}
          onLinked={(text) => {
            setLinking(null);
            setFeedback({ tone: "success", text });
            refresh();
          }}
        />
      )}
      {editing && (
        <SignerEditPanel
          api={api}
          signerId={editing.id}
          returnFocus={editing.returnFocus}
          onClose={() => setEditing(null)}
          onSaved={(signer) => {
            setEditing(null);
            setFeedback({
              tone: "success",
              text: `Die Änderungen an „${signer.name}“ sind gespeichert.`,
            });
            refresh();
          }}
        />
      )}
    </div>
  );
}
