import { expect, test } from "bun:test";
import { signerDateRange } from "../src/signer-filters.js";

test("reversed recipient date ranges require correction instead of an empty query result", () => {
  const range = signerDateRange("custom", "2026-11-10", "2026-11-08");
  expect(range.error).toBe(
    'Das Startdatum liegt nach dem Enddatum. Wähle unter "Bis" denselben oder einen späteren Tag. Deine Auswahl bleibt erhalten.',
  );
  expect(range.from).toBeUndefined();
  expect(range.to).toBeUndefined();
});

test("a one-day recipient filter includes the entire local calendar day", () => {
  expect(signerDateRange("custom", "2026-11-08", "2026-11-08")).toEqual({
    from: new Date("2026-11-08T00:00:00").toISOString(),
    to: new Date("2026-11-08T23:59:59.999").toISOString(),
  });
});

test("recipient date filters allow either open boundary and preset ranges", () => {
  expect(signerDateRange("custom", "2026-11-08")).toEqual({
    from: new Date("2026-11-08T00:00:00").toISOString(),
    to: null,
  });
  expect(signerDateRange("custom", "", "2026-11-08")).toEqual({
    from: null,
    to: new Date("2026-11-08T23:59:59.999").toISOString(),
  });
  expect(signerDateRange("alle", "2026-11-10", "2026-11-08")).toEqual({
    from: null,
    to: null,
  });
  const now = Date.parse("2026-11-09T12:00:00Z");
  expect(signerDateRange("24h", "", "", now)).toEqual({
    from: "2026-11-08T12:00:00.000Z",
    to: null,
  });
  expect(signerDateRange("7d", "", "", now)).toEqual({
    from: "2026-11-02T12:00:00.000Z",
    to: null,
  });
});
