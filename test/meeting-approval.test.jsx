import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import MeetingDeliveryReview, {
  meetingDeliveryImpact,
} from "../src/MeetingDeliveryReview.jsx";

const now = Date.parse("2026-11-08T12:00:00Z");
const saved = {
  eventAt: "2026-11-09T12:00:00.123Z",
  link: "https://example.invalid/meeting",
  linkOffsetHours: 24,
  reminderOffsetHours: 2,
  mailings: [
    { kind: "link", status: "sent" },
    { kind: "reminder", status: "aborted" },
  ],
};
const proposed = {
  eventAt: saved.eventAt,
  zoomLink: saved.link,
  linkOffsetHours: saved.linkOffsetHours,
  reminderOffsetHours: saved.reminderOffsetHours,
};

test("unrelated meeting edits preserve delivery approval; timing and link edits expose delivery impact", () => {
  expect(
    meetingDeliveryImpact(saved, { ...proposed, durationMin: 45 }, now),
  ).toBeNull();
  expect(
    meetingDeliveryImpact(
      saved,
      { ...proposed, zoomLink: ` ${saved.link} ` },
      now,
    ),
  ).toBeNull();
  const impact = meetingDeliveryImpact(
    saved,
    { ...proposed, reminderOffsetHours: 48 },
    now,
  );
  expect(impact.reset).toBe(false);
  expect(impact.mailings.map((m) => m.state)).toEqual(["sent", "stopped"]);
  expect(
    meetingDeliveryImpact(
      saved,
      { ...proposed, zoomLink: "https://example.invalid/new" },
      now,
    ),
  ).not.toBeNull();
});

test("a changed meeting date restarts completed mailings and identifies open mailing windows", () => {
  const impact = meetingDeliveryImpact(
    saved,
    { ...proposed, eventAt: "2026-11-08T13:00:00Z" },
    now,
  );
  expect(impact.reset).toBe(true);
  expect(impact.mailings.map((m) => m.state)).toEqual(["due", "due"]);
  expect(impact.mailings[0].startsAt).toBe("2026-11-07T13:00:00.000Z");
  const missingLink = meetingDeliveryImpact(
    saved,
    { ...proposed, eventAt: "2026-11-08T13:00:00Z", zoomLink: "" },
    now,
  );
  expect(missingLink.mailings.map((m) => m.state)).toEqual(["no-link", "due"]);
  const later = meetingDeliveryImpact(
    saved,
    { ...proposed, eventAt: "2026-11-10T13:00:00Z" },
    now,
  );
  expect(later.mailings.map((m) => m.state)).toEqual([
    "scheduled",
    "scheduled",
  ]);
  const past = meetingDeliveryImpact(
    saved,
    { ...proposed, eventAt: "2026-11-07T13:00:00Z" },
    now,
  );
  expect(past.mailings.map((m) => m.state)).toEqual(["ended", "ended"]);
});

test("meeting approval names repeat delivery, current language counts, fallback and immediate dispatch", () => {
  const html = renderToStaticMarkup(
    <MeetingDeliveryReview
      impact={meetingDeliveryImpact(
        saved,
        { ...proposed, eventAt: "2026-11-08T13:00:00Z" },
        now,
      )}
      audience={{
        count: 36,
        byLanguage: { en: 20, de: 16 },
        checkedAt: new Date(now),
      }}
      defaultLanguage="en"
      templates={[{ slug: "zoom_link.de" }]}
      ready={false}
    />,
  );
  for (const text of [
    "erneut bekommen",
    "36",
    "EN: 20",
    "DE: 16",
    "Vorlage DE",
    "Vorlage der Standardsprache (EN)",
    "unmittelbar nach dem Speichern",
    "pausiert",
    "Die Zahlen können sich bis zum Versand ändern",
  ])
    expect(html).toContain(text);
});
