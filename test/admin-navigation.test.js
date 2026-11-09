import { expect, test } from "bun:test";
import {
  adminAreaFromHash,
  ADMIN_AREAS,
  SETTINGS_SECTIONS,
} from "../src/admin-navigation.js";

test("reload restores every admin area and every settings shortcut", () => {
  for (const area of ADMIN_AREAS)
    expect(adminAreaFromHash(`#${area}`)).toBe(area);
  for (const [id] of SETTINGS_SECTIONS)
    expect(adminAreaFromHash(`#${id}`)).toBe("settings");
  for (const hash of ["", "#unknown", "#statistics-heading-extra"])
    expect(adminAreaFromHash(hash)).toBe("copy");
});
