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
import CampaignTestLanguage from "../src/CampaignTestLanguage.jsx";

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
