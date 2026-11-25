import { expect, test } from "bun:test";
import {
  adminAreaFromHash,
  adminAreas,
  adminDocumentTitle,
  ADMIN_AREAS,
  SETTINGS_SECTIONS,
} from "../src/admin-navigation.js";

test("reload restores every admin area and every settings shortcut", () => {
  for (const area of ADMIN_AREAS)
    expect(adminAreaFromHash(`#${area}`)).toBe(area);
  for (const [id] of SETTINGS_SECTIONS)
    expect(adminAreaFromHash(`#${id}`)).toBe("settings");
  for (const hash of ["", "#unknown", "#statistics-heading-extra"])
    expect(adminAreaFromHash(hash)).toBe("overview");
});

test("the Zoom area stays even while the public meeting sign-up is off", () => {
  const areas = adminAreas().map((area) => area.id);
  expect(areas).toContain("zoom");
  expect(adminAreaFromHash("#zoom", areas)).toBe("zoom");
});

test("each area names the browser tab after itself", () => {
  const areas = adminAreas();
  expect(areas.find((area) => area.id === "signers").label).toBe(
    "Empfänger auswählen",
  );
  expect(adminDocumentTitle(areas[0].title)).toBe("Übersicht · Verwaltung");
});
