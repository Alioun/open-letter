// What a row of the public list prints under the name.
import { expect, test } from "bun:test";
import cfg from "../config/letter.config.js";
import { regionLabels } from "../config/region.js";
import { signerRowSubtitle } from "../config/signer-details.js";

const region = regionLabels(cfg);
const row = (features, signer) =>
  signerRowSubtitle(
    { ...cfg, features: { ...cfg.features, ...features } },
    region,
    signer,
  ).text;

test("a row never says a signer has no region when the region may just not be public", () => {
  // The form asks: only my name, or my name with my details.
  const choice = { publicSignerDetails: true, kreisverbandField: true };
  expect(row(choice, { kreisverband: "" })).toBe("");
  expect(row(choice, { kreisverband: "Hamburg" })).toBe(
    region.rowPrefix + "Hamburg",
  );
  expect(
    row(choice, {
      kreisverband: "Hamburg",
      signerFunction: "Sprecherin",
      organisation: "Klinikum",
    }),
  ).toBe("Sprecherin · Klinikum");
});

test("a letter with the one checkbox prints the region, or that there is none, as before", () => {
  const plain = { publicSignerDetails: false, publicFirstSignerDetails: false };
  expect(row(plain, { kreisverband: "Berlin" })).toBe(
    region.rowPrefix + "Berlin",
  );
  expect(row(plain, { kreisverband: "" })).toBe(region.none);

  // Details for first signers only: the region line as before, and none at
  // all when the letter does not ask for a region.
  const firstOnly = { ...plain, publicFirstSignerDetails: true };
  expect(
    row({ ...firstOnly, kreisverbandField: true }, { kreisverband: "" }),
  ).toBe(region.none);
  expect(
    row({ ...firstOnly, kreisverbandField: false }, { kreisverband: "Alt" }),
  ).toBe("");
});
