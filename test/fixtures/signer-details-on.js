// Preload for HTTP tests of a letter that asks for organisation and function
// separately and shows them next to the names of people who agreed: the
// example letter with those features switched on.
import letter from "../../config/letters/example/index.js";
if (process.env.HTTP_FIXTURE_SIGNER_DETAILS !== "1")
  throw new Error("Only for the HTTP test fixture");
letter.features = {
  ...letter.features,
  occupationField: true,
  publicSignerDetails: true,
  publicFirstSignerDetails: true,
};
letter.sign.fields.occupation.label = "Organisation";
letter.sign.fields.signerFunction = {
  label: "Funktion",
  optionalLabel: " optional",
  placeholder: "",
  filterLabel: "Funktionen",
  emptyLabel: "Noch keine Funktionen angegeben.",
};
