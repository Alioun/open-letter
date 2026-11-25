import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { useAdminSession } from "../src/admin-session.js";
import {
  meetingChanges,
  meetingRequest,
  meetingValues,
  useMeetingForm,
} from "../src/meeting-form.js";
import { useMilestoneForm } from "../src/milestone-form.js";
import { useCampaignSubmission } from "../src/campaign-draft.js";
import { loginFailure } from "../src/AdminLogin.jsx";
import CampaignTestLanguage from "../src/CampaignTestLanguage.jsx";
import EmailSetup, { DeliveryProblems } from "../src/EmailSetup.jsx";
import SessionSettings from "../src/SessionSettings.jsx";
import {
  ZoomRegistrationList,
  zoomRegistrationsPath,
} from "../src/ZoomRegistrations.jsx";

let root;
let browser;
let restore;
let current;

beforeEach(() => {
  browser = new Window({ url: "https://example.invalid/#zoom" });
  const globals = {
    window: browser,
    document: browser.document,
    navigator: browser.navigator,
    HTMLElement: browser.HTMLElement,
    Element: browser.Element,
    Node: browser.Node,
    Event: browser.Event,
    MouseEvent: browser.MouseEvent,
    MutationObserver: browser.MutationObserver,
    getComputedStyle: browser.getComputedStyle.bind(browser),
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
    localStorage: browser.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: globalThis.fetch,
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

test("saving a replacement reports success while active delivery is paused", async () => {
  const active = { provider: "resend", from: "old@example.org" };
  const candidate = {
    provider: "mailbox.org",
    from: "sender@example.org",
    user: "main@example.org",
    hasCredential: true,
  };
  const state = {
    source: "admin",
    revision: 2,
    active,
    candidate,
    ready: false,
    failure: { category: "authentication", protocol: 401 },
  };
  const api = async (path, options) => {
    expect(path).toBe("/api/admin/email");
    if (!options) return Response.json(state);
    expect(JSON.parse(options.body).action).toBe("save");
    return Response.json({ ...state, revision: 3 });
  };
  await act(async () => root.render(<EmailSetup api={api} />));
  await act(async () => {
    document
      .querySelector("form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(
    document.querySelector("form .email-action-feedback").textContent,
  ).toBe("Versandprofil gespeichert. Sende jetzt eine Testnachricht.");
  expect(document.body.textContent).toContain(
    "Aktueller Versand: Anmeldung fehlgeschlagen",
  );
});

test("closing unclear deliveries without resending waits for a confirmation that names the count", async () => {
  const actions = [];
  const questions = [];
  let answer = false;
  const confirm = async (message, options) => {
    questions.push({ message, ...options });
    return answer;
  };
  const state = {
    messages: [{ status: "unresolved", count: 3 }],
    queue: { available: true, failed: 0 },
  };
  await act(async () =>
    root.render(
      <DeliveryProblems
        state={state}
        onAction={(...action) => actions.push(action)}
        feedback={() => null}
        confirm={confirm}
      />,
    ),
  );
  const close = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Ohne erneuten Versand abschließen",
  );
  await act(async () => close.click());
  expect(actions).toEqual([]);
  expect(questions[0]).toMatchObject({ danger: true });
  expect(questions[0].message).toContain("3 Nachrichten");
  answer = true;
  await act(async () => close.click());
  expect(actions).toEqual([["reconcile-all", { resolution: "delivered" }]]);
});

async function mount(useForm) {
  function Harness() {
    current = useForm();
    return null;
  }
  await act(async () => root.render(<Harness />));
}

const change = async (action) => act(async () => action(current));
const submit = () => ({ preventDefault() {} });
const savedMeeting = () => ({
  revision: 3,
  eventAt: "2026-11-22T04:23:02.559Z",
  link: "https://example.invalid/meeting",
  linkOffsetHours: 24,
  reminderOffsetHours: 2,
  showDelegierter: false,
  mode: "online",
  durationMin: 90,
  location: { name: "", address: "", mapsUrl: "" },
  mailings: [],
});

function meetingServer() {
  let saved = savedMeeting();
  const writes = [];
  let post;
  const api = async (path, options = {}) => {
    if (path === "/api/admin/zoom-mailings") return Response.json(saved);
    if (path === "/api/admin/zoom-settings") {
      const request = JSON.parse(options.body);
      writes.push(request);
      if (post) return post(request);
      saved = {
        ...saved,
        revision: saved.revision + 1,
        eventAt: request.eventAt,
        link: request.zoomLink,
        linkOffsetHours: request.linkOffsetHours,
        reminderOffsetHours: request.reminderOffsetHours,
        showDelegierter: request.showDelegierter,
        mode: request.mode,
        durationMin: request.durationMin,
        location: {
          name: request.locationName,
          address: request.locationAddress,
          mapsUrl: request.locationMapsUrl,
        },
      };
      return Response.json({
        revision: saved.revision,
        eventAt: saved.eventAt,
      });
    }
    if (path === "/api/admin/stats")
      return Response.json({
        zoomCount: 2,
        audienceLanguages: { zoom: { en: 2 } },
      });
    if (path === "/api/admin/templates") return Response.json([]);
    throw new Error(`Unexpected fake API path ${path}`);
  };
  return {
    api,
    writes,
    get saved() {
      return saved;
    },
    set saved(next) {
      saved = next;
    },
    set post(handler) {
      post = handler;
    },
  };
}

test("meeting fields compare by key and preserve the exact saved timestamp in unrelated edits", () => {
  const saved = savedMeeting();
  const values = {
    ...meetingValues(saved),
    durationMin: "90",
    locationName: "Local hall",
  };
  expect(meetingChanges(values, saved)).toEqual([
    { key: "locationName", label: "Ort", mine: "Local hall", current: "" },
  ]);
  expect(meetingRequest(values, saved)).toEqual({
    expectedRevision: 3,
    eventAt: "2026-11-22T04:23:02.559Z",
    zoomLink: "https://example.invalid/meeting",
    linkOffsetHours: 24,
    reminderOffsetHours: 2,
    showDelegierter: false,
    mode: "online",
    locationName: "Local hall",
    locationAddress: "",
    locationMapsUrl: "",
    durationMin: 90,
  });
});

test("meeting refresh preserves dirty inputs and discard restores the latest saved record", async () => {
  const server = meetingServer();
  await mount(() => useMeetingForm({ api: server.api, enabled: true }));
  expect(current.dirty).toBe(false);
  await change((form) => form.update("durationMin", "90"));
  expect(current.dirty).toBe(false);
  await change((form) => form.update("locationName", "My local hall"));
  server.saved = { ...server.saved, revision: 4, durationMin: 45 };
  await change((form) => form.read.reload());
  expect(current.values.locationName).toBe("My local hall");
  expect(current.values.durationMin).toBe("90");
  expect(current.saved.revision).toBe(3);
  expect(current.dirty).toBe(true);
  await change((form) => form.reset());
  expect(current.values.locationName).toBe("");
  expect(current.values.durationMin).toBe(45);
  expect(current.saved.revision).toBe(4);
  expect(current.dirty).toBe(false);
  server.saved = { ...server.saved, revision: 5, durationMin: null };
  await change((form) => form.read.reload());
  expect(current.values.durationMin).toBe(90);
});

test("401 and reauthentication preserve meeting and milestone inputs without retrying a save", async () => {
  const server = meetingServer();
  let rejectSave = true;
  globalThis.fetch = async (path, options = {}) => {
    if (path === "/api/admin/milestones")
      return Response.json({ milestones: [100, 300] });
    if (path === "/api/admin/zoom-settings" && rejectSave) {
      rejectSave = false;
      return Response.json({}, { status: 401 });
    }
    return server.api(path, options);
  };
  localStorage.setItem("open_letter_admin_token", "fixture-token");
  await mount(() => {
    const session = useAdminSession();
    const meeting = useMeetingForm({
      api: session.api,
      enabled: session.status === "active",
    });
    const milestones = useMilestoneForm(session.api);
    useEffect(() => {
      if (session.status === "active")
        session
          .api("/api/admin/milestones")
          .then((r) => r.json())
          .then(milestones.load);
    }, [session.status]);
    return { session, meeting, milestones };
  });
  await change(({ meeting, milestones }) => {
    meeting.update("locationName", "Unsent local hall");
    milestones.setInput("125, 500");
  });
  await change(({ meeting }) => meeting.save(submit()));
  expect(current.session.status).toBe("expired");
  expect(current.session.token).toBe("fixture-token");
  expect(current.meeting.values.locationName).toBe("Unsent local hall");
  expect(current.meeting.dirty).toBe(true);
  expect(current.milestones.input).toBe("125, 500");
  expect(current.milestones.dirty).toBe(true);
  expect(current.meeting.status).toContain("Eingaben bleiben erhalten");
  await change(({ session }) => session.signIn("replacement-fixture-token"));
  expect(current.session.status).toBe("active");
  expect(current.meeting.values.locationName).toBe("Unsent local hall");
  expect(current.milestones.input).toBe("125, 500");
  expect(server.writes).toEqual([]);
  await change(({ meeting }) => meeting.save(submit()));
  expect(server.writes).toHaveLength(1);
  expect(server.writes[0].locationName).toBe("Unsent local hall");
  expect(server.writes[0].eventAt).toBe("2026-11-22T04:23:02.559Z");
  expect(current.meeting.dirty).toBe(false);
  expect(current.meeting.status).toBe("ok");
  await change(({ meeting, milestones, session }) => {
    meeting.endSession();
    milestones.endSession();
    session.signOut();
  });
  expect(current.meeting.saved).toBeNull();
  expect(current.meeting.read.data).toBeNull();
  expect(current.meeting.values.locationName).toBe("");
  expect(current.milestones.input).toBe("");
  expect(current.milestones.loaded).toBe(false);
  await change(({ session }) => session.signIn("third-fixture-token"));
  expect(current.meeting.values.locationName).toBe("Unsent local hall");
  expect(current.meeting.dirty).toBe(false);
  expect(current.milestones.input).toBe("100, 300");
  expect(current.milestones.dirty).toBe(false);
});

test("meeting conflict comparison restores saved values or rebases local values before a separate save", async () => {
  const server = meetingServer();
  await mount(() => useMeetingForm({ api: server.api, enabled: true }));
  await change((form) => form.update("durationMin", "120"));
  server.saved = { ...server.saved, revision: 4, durationMin: 45 };
  server.post = () =>
    Response.json({ error: "Neuere Einstellungen" }, { status: 409 });
  await change((form) => form.save(submit()));
  expect(current.conflict.revision).toBe(4);
  expect(current.changes).toEqual([
    { key: "durationMin", label: "Dauer in Minuten", mine: 120, current: 45 },
  ]);
  await change((form) => form.continueLocal());
  expect(server.writes).toHaveLength(1);
  expect(current.saved.revision).toBe(4);
  expect(current.values.durationMin).toBe("120");
  expect(current.dirty).toBe(true);
  server.post = null;
  await change((form) => form.save(submit()));
  expect(server.writes[1].expectedRevision).toBe(4);
  expect(current.saved.revision).toBe(5);
  expect(current.dirty).toBe(false);
  await change((form) => form.update("durationMin", "180"));
  server.saved = { ...server.saved, revision: 6, durationMin: 60 };
  server.post = () => Response.json({}, { status: 409 });
  await change((form) => form.save(submit()));
  await change((form) => form.acceptSaved());
  expect(current.values.durationMin).toBe(60);
  expect(current.conflict).toBeNull();
  expect(current.status).toBeNull();
  expect(current.dirty).toBe(false);
  expect(server.writes).toHaveLength(3);
});

test("canceling delivery approval retains meeting inputs without writing settings", async () => {
  const server = meetingServer();
  const reviews = [];
  await mount(() =>
    useMeetingForm({
      api: server.api,
      enabled: true,
      confirmDelivery: async (review) => {
        reviews.push(review);
        return false;
      },
    }),
  );
  await change((form) =>
    form.update("zoomLink", "https://example.invalid/local-link"),
  );
  await change((form) => form.save(submit()));
  expect(reviews).toHaveLength(1);
  expect(reviews[0].audience.count).toBe(2);
  expect(server.writes).toEqual([]);
  expect(current.values.zoomLink).toBe("https://example.invalid/local-link");
  expect(current.dirty).toBe(true);
  expect(current.status).toBeNull();
});

test("logout prevents a late meeting acknowledgement from restoring a discarded form", async () => {
  const server = meetingServer();
  const response = Promise.withResolvers();
  server.post = () => response.promise;
  let enabled = true;
  await mount(() => useMeetingForm({ api: server.api, enabled }));
  await change((form) => form.update("locationName", "Discard this hall"));
  let pending;
  await change((form) => {
    pending = form.save(submit());
  });
  expect(current.status).toBe("saving");
  enabled = false;
  await change((form) => form.endSession());
  await act(async () => {
    response.resolve(
      Response.json({ revision: 4, eventAt: server.saved.eventAt }),
    );
    await pending;
  });
  expect(current.saved).toBeNull();
  expect(current.values.locationName).toBe("");
  expect(current.status).toBeNull();
  expect(current.dirty).toBe(false);
});

test("milestone refresh preserves edits and reset clears discarded validation feedback", async () => {
  const writes = [];
  await mount(() =>
    useMilestoneForm(async (_path, options) => {
      const { milestones } = JSON.parse(options.body);
      writes.push(milestones);
      return Response.json({ milestones });
    }),
  );
  await change((form) => form.load({ milestones: [100, 300] }));
  await change((form) => form.setInput("-10, invalid"));
  await change((form) => form.save(submit()));
  expect(current.error).toContain("positive Zahlen");
  await change((form) => form.load({ milestones: [200, 600] }));
  expect(current.input).toBe("-10, invalid");
  expect(current.error).toContain("positive Zahlen");
  await change((form) => form.reset());
  expect(current.input).toBe("200, 600");
  expect(current.error).toBe("");
  expect(current.dirty).toBe(false);
  await change((form) => form.setInput("250, 750"));
  await change((form) => form.save(submit()));
  expect(writes).toEqual([[250, 750]]);
  expect(current.dirty).toBe(false);
  expect(current.status).toBe("ok");
});

test("a milestone save cannot resurrect discarded inputs after session end", async () => {
  const response = Promise.withResolvers();
  await mount(() => useMilestoneForm(async () => response.promise));
  await change((form) => form.load({ milestones: [100] }));
  await change((form) => form.setInput("250"));
  let pending;
  await change((form) => {
    pending = form.save(submit());
  });
  await change((form) => form.endSession());
  await act(async () => {
    response.resolve(Response.json({ milestones: [250] }));
    await pending;
  });
  expect(current.loaded).toBe(false);
  expect(current.input).toBe("");
  expect(current.error).toBe("");
  expect(current.status).toBeNull();
});

test("campaign preview errors only appear for their original language and message context", async () => {
  const props = {
    api: async () => {
      throw new Error("Fixture preview error");
    },
    language: "en",
    onLanguage() {},
    templateId: 8,
    subject: "Original subject",
    translations: {},
    templates: [
      {
        id: 8,
        name: "Newsletter",
        subject: "Default subject",
        html_body: "<p>Original</p>",
      },
    ],
  };
  await act(async () => root.render(<CampaignTestLanguage {...props} />));
  const previewButton = [...document.querySelectorAll("button")].find(
    (button) => button.textContent.includes("Vorschau für"),
  );
  await act(async () => previewButton.click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Fixture preview error",
  );
  for (const patch of [
    { language: "de" },
    { subject: "Changed subject" },
    { templates: [{ ...props.templates[0], html_body: "<p>Changed</p>" }] },
  ]) {
    await act(async () =>
      root.render(<CampaignTestLanguage {...props} {...patch} />),
    );
    expect(document.querySelector('[role="alert"]')).toBeNull();
  }
  await act(async () => root.render(<CampaignTestLanguage {...props} />));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Fixture preview error",
  );
});

test("meeting save waits for successful current delivery approval and blocks failed review reads", async () => {
  const server = meetingServer();
  let unavailable = true;
  const reviews = [];
  const api = async (path, options) =>
    path === "/api/admin/stats" && unavailable
      ? Response.json({}, { status: 503 })
      : server.api(path, options);
  await mount(() =>
    useMeetingForm({
      api,
      enabled: true,
      confirmDelivery: async (review) => {
        reviews.push(review);
        return true;
      },
    }),
  );
  await change((form) =>
    form.update("zoomLink", "https://example.invalid/approved-link"),
  );
  await change((form) => form.save(submit()));
  expect(reviews).toEqual([]);
  expect(server.writes).toEqual([]);
  expect(current.status).toContain("Es wurde nichts gespeichert");
  expect(current.dirty).toBe(true);
  unavailable = false;
  await change((form) => form.save(submit()));
  expect(reviews).toHaveLength(1);
  expect(reviews[0].audience.count).toBe(2);
  expect(server.writes).toHaveLength(1);
  expect(server.saved.link).toBe("https://example.invalid/approved-link");
  expect(current.dirty).toBe(false);
});

test("meeting saves stay blocked after an initial failed settings read", async () => {
  let writes = 0;
  const api = async (_path, options) => {
    if (options?.method === "POST") writes++;
    return Response.json({}, { status: 503 });
  };
  await mount(() =>
    useMeetingForm({
      enabled: true,
      api,
    }),
  );
  expect(current.read.error).toBe(true);
  expect(current.saved).toBeNull();
  await change((form) => form.save(submit()));
  expect(writes).toBe(0);
});

test("milestone authentication failures retain inputs and require an explicit later save", async () => {
  let writes = 0;
  let authorized = false;
  await mount(() =>
    useMilestoneForm(async (_path, options) => {
      writes++;
      return authorized
        ? Response.json(JSON.parse(options.body))
        : Response.json(
            { error: "Sitzung abgelaufen. Eingaben bleiben erhalten." },
            { status: 401 },
          );
    }),
  );
  await change((form) => form.load({ milestones: [100] }));
  await change((form) => form.setInput("200, 500"));
  await change((form) => form.save(submit()));
  expect(current.input).toBe("200, 500");
  expect(current.dirty).toBe(true);
  expect(current.error).toContain("Sitzung abgelaufen");
  authorized = true;
  await change((form) => form.load({ milestones: [150] }));
  expect(writes).toBe(1);
  expect(current.input).toBe("200, 500");
  await change((form) => form.save(submit()));
  expect(writes).toBe(2);
  expect(current.status).toBe("ok");
  expect(current.dirty).toBe(false);
});

test("a draft that became a campaign cannot be sent a second time until a new message is started", async () => {
  const key = "campaign-submission-fixture";
  const requests = [];
  const api = async (path, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json({ id: 12, status: "scheduled" }, { status: 201 });
  };
  const body = {
    template_id: "4",
    subject: "Update",
    scheduled_at: "2026-12-01T10:00:00.000Z",
    send_now: false,
    audience: "newsletter",
  };
  await mount(() => useCampaignSubmission(key));
  expect(current.submitted).toBeNull();

  expect(
    (await change((form) => form.submit(api, body, async () => true))).id,
  ).toBe(12);
  expect(current.submitted).toEqual({ id: 12, outcome: "scheduled" });

  // "Jetzt senden" on the untouched form used to create a second campaign.
  expect(
    await change((form) =>
      form.submit(api, { ...body, send_now: true }, async () => true),
    ),
  ).toBeNull();
  expect(requests).toHaveLength(1);

  // A reload still knows the draft was sent.
  await act(async () => root.unmount());
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await mount(() => useCampaignSubmission(key));
  expect(current.submitted).toEqual({ id: 12, outcome: "scheduled" });

  await change((form) => form.reset());
  expect(current.submitted).toBeNull();
  await change((form) =>
    form.submit(api, { ...body, subject: "Next" }, async () => true),
  );
  expect(requests).toHaveLength(2);
  expect(requests[1].request_key).not.toBe(requests[0].request_key);
});

test("an unconfirmed send order keeps its key through every later attempt of the same draft", async () => {
  const requests = [];
  let online = false;
  const api = async (path, options) => {
    requests.push(JSON.parse(options.body));
    if (!online) throw new TypeError("offline");
    return Response.json({ id: 3, status: "scheduled" }, { status: 201 });
  };
  const body = { template_id: "4", subject: "Update", send_now: false };
  await mount(() => useCampaignSubmission("campaign-retry-fixture"));

  let failure;
  await change((form) =>
    form
      .submit(api, body, async () => true)
      .catch((error) => {
        failure = error;
      }),
  );
  expect(failure.message).toContain("Prüfe den Versandverlauf");
  expect(current.submitted).toBeNull();

  online = true;
  await change((form) =>
    form.submit(api, { ...body, send_now: true }, async () => true),
  );
  expect(requests.map((request) => request.request_key)).toEqual([
    requests[0].request_key,
    requests[0].request_key,
  ]);
  expect(current.submitted).toEqual({ id: 3, outcome: "due" });
});

test("a rate-limited login says how long to wait instead of blaming the password", () => {
  const answer = (status, headers) =>
    loginFailure(new Response("", { status, headers }));
  expect(answer(401)).toContain("Prüfe dein Passwort");
  expect(answer(429, { "Retry-After": "840" })).toBe(
    "Zu viele Anmeldeversuche. Versuche es in 14 Minuten erneut.",
  );
  expect(answer(429, { "Retry-After": "45" })).toBe(
    "Zu viele Anmeldeversuche. Versuche es in einer Minute erneut.",
  );
  expect(answer(429)).toBe(
    "Zu viele Anmeldeversuche. Versuche es später erneut.",
  );
  expect(answer(500)).not.toContain("Passwort");
});

test("signing everyone out asks first, and only a confirmed request ends the session here", async () => {
  const requests = [];
  let answer = false;
  let status = 503;
  let done = 0;
  const asked = [];
  await act(async () =>
    root.render(
      <SessionSettings
        api={async (path, options) => {
          requests.push([path, options.method]);
          return Response.json(
            status === 200 ? { ok: true } : { error: "Gerade nicht möglich." },
            { status },
          );
        }}
        askConfirmation={async (message, options) => {
          asked.push(options);
          return answer;
        }}
        onDone={() => done++}
      />,
    ),
  );
  const press = () =>
    act(async () =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "Überall abmelden")
        .click(),
    );

  await press();
  expect(asked[0]).toMatchObject({
    title: "Überall abmelden?",
    confirmLabel: "Überall abmelden",
    danger: true,
  });
  expect(requests).toEqual([]);

  answer = true;
  await press();
  expect(requests).toEqual([["/api/admin/logout-everywhere", "POST"]]);
  expect(document.querySelector('[role="alert"]').textContent).toBe(
    "Gerade nicht möglich.",
  );
  expect(done).toBe(0);

  status = 200;
  await press();
  expect(done).toBe(1);
});

test("a meeting registration is removed only after the danger confirmation, and the list reloads", async () => {
  const people = [
    {
      id: 7,
      name: "Falsch Angemeldet",
      email: "falsch@example.org",
      delegierter: false,
      created_at: "2026-11-20T10:00:00.000Z",
    },
    {
      id: 8,
      name: "Bleibt Dabei",
      email: "bleibt@example.org",
      delegierter: false,
      created_at: "2026-11-20T11:00:00.000Z",
    },
  ];
  const requests = [];
  const asked = [];
  let answer = false;
  let reloads = 0;
  const list = () => (
    <ZoomRegistrationList
      api={async (path, options) => {
        requests.push([path, options.method]);
        return Response.json({ ok: true });
      }}
      askConfirmation={async (message, options) => {
        asked.push({ message, ...options });
        return answer;
      }}
      read={{
        data: { registrations: people, total: 2, delegates: 0, matches: 2 },
        error: false,
        loading: false,
        reload: () => reloads++,
      }}
      page={0}
      onPage={() => {}}
      search=""
      onSearch={() => {}}
      showDelegierter={false}
      regionLabel={null}
    />
  );
  await act(async () => root.render(list()));
  const remove = () =>
    act(async () =>
      document
        .querySelector(
          'table button[aria-label="Anmeldung von Falsch Angemeldet entfernen"]',
        )
        .click(),
    );

  await remove();
  expect(asked[0]).toMatchObject({
    title: "Anmeldung entfernen?",
    confirmLabel: "Anmeldung entfernen",
    danger: true,
  });
  expect(asked[0].message).toContain("Falsch Angemeldet");
  expect(asked[0].message).toContain("Unterschrift und Newsletter bleiben");
  expect(requests).toEqual([]);

  answer = true;
  await remove();
  expect(requests).toEqual([["/api/admin/zoom-registrations/7", "DELETE"]]);
  expect(reloads).toBe(1);
  expect(document.querySelector('[role="status"]').textContent).toBe(
    "Die Anmeldung von Falsch Angemeldet wurde entfernt.",
  );
});

test("the registration search travels in the page address, encoded", () => {
  expect(zoomRegistrationsPath(2)).toBe(
    "/api/admin/zoom-registrations?limit=100&offset=200",
  );
  expect(zoomRegistrationsPath(0, "müller & co")).toBe(
    "/api/admin/zoom-registrations?limit=100&offset=0&search=m%C3%BCller%20%26%20co",
  );
});
