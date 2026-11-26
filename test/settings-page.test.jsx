// The settings page behind the link in a mail, against a stand-in server.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import cfg from "../config/letter.config.js";

let root;
let browser;
let restore;
let saved;
let settings;

const signer = {
  emailMasked: "f****@example.org",
  source: "newsletter",
  newsletter: true,
  hasZoom: false,
  editable: true,
  canDeleteSigner: true,
  hasSigner: true,
  name: "First Signer",
  kreisverband: "",
  occupation: "Clinic",
  showPublicly: true,
  inviteShowName: false,
  hasInviteCode: false,
};

beforeEach(() => {
  browser = new Window({ url: "https://example.invalid/abmelden/a-token" });
  saved = [];
  const globals = {
    window: browser,
    document: browser.document,
    navigator: browser.navigator,
    HTMLElement: browser.HTMLElement,
    Element: browser.Element,
    Node: browser.Node,
    Event: browser.Event,
    MutationObserver: browser.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (path, options) => {
      if (!options?.method) return Response.json(settings);
      saved.push(JSON.parse(options.body));
      return Response.json({ ok: true, ...settings });
    },
  };
  const descriptors = Object.fromEntries(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  restore = () => {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(async () => root.unmount());
  await browser.happyDOM.close();
  restore();
});

const checkbox = (text) =>
  [...document.querySelectorAll("label.check")]
    .find((element) => element.textContent === text)
    ?.querySelector("input");

async function open(state) {
  settings = state;
  const { default: UnsubscribeApp } = await import("../src/UnsubscribeApp.jsx");
  await act(async () => root.render(<UnsubscribeApp />));
}

// The letter's own wording for the choice, or the interface default when the
// letter has none.
async function withDetailsLabel(label, run) {
  const configured = cfg.sign.publicDetailsLabel;
  if (label) cfg.sign.publicDetailsLabel = label;
  else delete cfg.sign.publicDetailsLabel;
  try {
    await run();
  } finally {
    if (configured === undefined) delete cfg.sign.publicDetailsLabel;
    else cfg.sign.publicDetailsLabel = configured;
  }
}

test("a signer whose details can be public is asked about them in the letter's wording, and the answer is sent", async () => {
  await withDetailsLabel("Show my name with my post", async () => {
    await open({ ...signer, showSignerDetails: true });
    const box = checkbox("Show my name with my post");
    expect(box.checked).toBe(true);
    expect(checkbox(cfg.ui.settings.showSignerDetails)).toBeUndefined();

    await act(async () => box.click());
    await act(async () => {
      document
        .querySelector("form")
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(saved).toHaveLength(1);
    expect(saved[0].showSignerDetails).toBe(false);
  });
});

test("a letter without its own wording asks with the interface default", async () => {
  await withDetailsLabel(null, async () => {
    await open({ ...signer, showSignerDetails: true });
    expect(checkbox(cfg.ui.settings.showSignerDetails).checked).toBe(true);
  });
});

test("a signer whose details are never public is not asked", async () => {
  await withDetailsLabel("Show my name with my post", async () => {
    await open(signer);
    expect(checkbox("Show my name with my post")).toBeUndefined();
    expect(checkbox(cfg.ui.settings.showSignerDetails)).toBeUndefined();
    expect(document.querySelector("form")).not.toBeNull();
  });
});
