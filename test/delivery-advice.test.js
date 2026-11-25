import { expect, test } from "bun:test";
import {
  failedMailSummary,
  temporaryFailureAdvice,
} from "../src/delivery-advice.js";

const smtp = { provider: "smtp", host: "smtp.example.org", port: 587 };

test("a connection failure names the server, the port, when it began and what to do", () => {
  const advice = temporaryFailureAdvice(
    {
      category: "temporary-delivery",
      code: "ESOCKET",
      protocol: null,
      at: "2026-11-23T08:05:00.000Z",
    },
    smtp,
  );
  expect(advice.heading).toBe("Der Server erreicht den E-Mail-Versand nicht");
  expect(advice.text).toContain("Seit 23.11.2026, 09:05");
  expect(advice.text).toContain("smtp.example.org, Port 587");
  expect(advice.steps[0]).toContain("Verbindung prüfen und Test senden");
  expect(advice.steps[1]).toContain("Port 587");
  expect(advice.steps).toHaveLength(2);
  expect(advice.meanwhile).toContain("werden Unterschriften weiter angenommen");
});

test("Resend outages point at its status page, provider refusals at the provider", () => {
  const resend = temporaryFailureAdvice(
    { category: "temporary-delivery", code: "ETIMEDOUT" },
    { provider: "resend" },
  );
  expect(resend.text).toContain("Resend (api.resend.com)");
  expect(resend.steps[1]).toContain("status.resend.com");

  const refused = temporaryFailureAdvice(
    { category: "temporary-delivery", protocol: 451, code: null },
    smtp,
  );
  expect(refused.heading).toBe(
    "Der E-Mail-Anbieter nimmt gerade keine Nachrichten an",
  );
  expect(refused.text).toContain("Antwort 451");
  expect(
    temporaryFailureAdvice({ category: "authentication" }, smtp),
  ).toBeNull();
});

test("failed mails are listed by kind with their consequence and what can be sent again", () => {
  const summary = failedMailSummary(
    {
      byKind: [
        { kind: "verification", count: 18 },
        { kind: "deletion", count: 1 },
        { kind: "mystery", count: 6 },
      ],
      firstAt: "2026-11-22T13:00:00.000Z",
      lastAt: "2026-11-23T07:30:00.000Z",
      retryable: 12,
      retryableHours: 24,
    },
    25,
  );
  expect(summary.lines).toEqual([
    "18 Bestätigungsmails zu neuen Unterschriften",
    "1 Link zum Löschen einer Unterschrift",
    "6 sonstige E-Mails",
  ]);
  expect(summary.effects).toHaveLength(2);
  expect(summary.effects[0]).toContain("Bestätigungslink nicht bekommen");
  expect(summary.span).toBe(
    "Aufgegeben zwischen 22.11.2026, 14:00 und 23.11.2026, 08:30.",
  );
  expect(summary.retry).toBe(
    "12 davon lassen sich noch einmal senden; die übrigen sind älter als 24 Stunden.",
  );
  expect(failedMailSummary({ byKind: [], retryable: 0 }, 3).retry).toBe(
    "Alle sind älter als 24 Stunden und lassen sich nicht mehr senden.",
  );
});
