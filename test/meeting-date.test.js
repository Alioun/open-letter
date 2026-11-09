import { expect, test } from "bun:test";
import { isoToLocalInput, meetingDateForSave } from "../src/meeting-date.js";

test("editing other meeting fields preserves seconds, milliseconds and the exact instant", () => {
  for (const saved of [
    "2026-11-22T04:23:02.559Z",
    "2026-10-25T01:30:45.123Z",
    "2026-03-29T01:30:00.001Z",
    "2026-11-22T04:23:02.559+02:30",
  ]) {
    expect(meetingDateForSave(isoToLocalInput(saved), saved)).toBe(
      new Date(saved).toISOString(),
    );
  }
});

test("an explicitly changed meeting date is saved and an absent date stays empty", () => {
  const original = "2026-11-22T04:23:02.559Z";
  const changed = isoToLocalInput("2026-11-23T04:23:00.000Z");
  expect(meetingDateForSave(changed, original)).toBe(
    "2026-11-23T04:23:00.000Z",
  );
  expect(isoToLocalInput(null)).toBe("");
  expect(isoToLocalInput("invalid")).toBe("");
});

test("meeting inputs use explicit German dates and a 24-hour clock, rejecting ambiguous and impossible dates", () => {
  const input = isoToLocalInput(new Date(2026, 10, 22, 18, 30));
  expect(input).toBe("22.11.2026, 18:30");
  expect(meetingDateForSave(input)).toBe(
    new Date(2026, 10, 22, 18, 30).toISOString(),
  );
  for (const invalid of [
    "11/22/2026, 06:30 PM",
    "31.02.2026, 18:30",
    "22.11.2026, 24:00",
    "22.11.2026, 18:60",
    "2026-11-22T18:30",
    "",
  ])
    expect(() => meetingDateForSave(invalid)).toThrow("TT.MM.JJJJ, HH:MM");
});
