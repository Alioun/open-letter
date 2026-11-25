// What the admin page asks of the signer routes, without any markup.
import { signerDateRange } from "./signer-filters.js";

export const SIGNER_PAGE_SIZE = 50;
export const SIGNER_PAGE_SIZE_PHONE = 20;

// filters: { search, from, to, visibility } with from/to as "yyyy-mm-dd".
export function signerListPath(filters, page, pageSize = SIGNER_PAGE_SIZE) {
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String(page * pageSize),
  });
  const search = (filters.search || "").trim();
  if (search) params.set("search", search);
  const range = signerDateRange("custom", filters.from, filters.to);
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  if (filters.visibility) params.set("public", filters.visibility);
  return `/api/admin/signers?${params}`;
}

export function isSignerList(data) {
  return (
    Number.isInteger(data?.total) &&
    Array.isArray(data.signers) &&
    data.signers.every(
      (signer) =>
        Number.isInteger(signer?.id) && typeof signer.name === "string",
    )
  );
}

const post = (api, path, body = {}) =>
  api(path, { method: "POST", body: JSON.stringify(body) });

async function errorOf(response) {
  try {
    return (await response.json()).error || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

// "removed" with the other sign-ups of the mailbox, or "gone".
export async function removeSigner(api, signer) {
  const response = await post(api, `/api/admin/signers/${signer.id}/remove`);
  if (response.status === 404) return { outcome: "gone", variants: [] };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const { variants = [] } = await response.json();
  return { outcome: "removed", variants };
}

export async function removeSigners(api, ids) {
  const response = await post(api, "/api/admin/signers/remove", { ids });
  if (!response.ok) throw new Error(await errorOf(response));
  return response.json();
}

export async function eraseSigner(api, signer) {
  const response = await post(api, `/api/admin/signers/${signer.id}/erase`);
  if (response.status === 404) return "gone";
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return "erased";
}

export async function unblockSigner(api, email) {
  const response = await post(api, "/api/admin/signers/unblock", { email });
  if (response.status === 400) return "invalid";
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()).unblocked ? "unblocked" : "not-blocked";
}

// Queues a mail to the person: "resend-confirmation" or "newsletter-request".
// Resolves to { delayed } or rejects with the server's German message.
export async function sendSignerMail(api, id, kind) {
  const response = await post(api, `/api/admin/signers/${id}/${kind}`);
  if (!response.ok) throw new Error(await errorOf(response));
  return { delayed: Boolean((await response.json()).emailDelayed) };
}

export async function lookupAddress(api, email) {
  const response = await post(api, "/api/admin/signers/lookup", { email });
  if (response.status === 400) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const EDITABLE = [
  "name",
  "signerFunction",
  "occupation",
  "kreisverband",
  "lang",
  "showPublicly",
  "showSignerDetails",
  "newsletter",
];

export function editForm(signer) {
  return Object.fromEntries(
    EDITABLE.map((field) => [
      field,
      typeof signer[field] === "boolean" ? signer[field] : signer[field] || "",
    ]),
  );
}

// Only what the form changed. Details cannot be public without the name.
export function signerPatch(signer, form) {
  const before = editForm(signer);
  const after = {
    ...form,
    showSignerDetails: form.showPublicly && form.showSignerDetails,
  };
  return Object.fromEntries(
    EDITABLE.filter((field) => after[field] !== before[field]).map((field) => [
      field,
      after[field],
    ]),
  );
}

// Putting the name or the details on the public list for someone who had
// them off takes the person's consent.
export function needsConsent(patch) {
  return patch.showPublicly === true || patch.showSignerDetails === true;
}

export async function saveSigner(api, id, patch, consent) {
  const response = await api(`/api/admin/signers/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ ...patch, ...consent }),
  });
  if (!response.ok) throw new Error(await errorOf(response));
  return (await response.json()).signer;
}

// Fetches a CSV with the session and hands it to the browser as a download.
export async function downloadCsv(api, path) {
  const response = await api(path);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const name =
    /filename="([^"]+)"/.exec(
      response.headers.get("content-disposition") || "",
    )?.[1] || "export.csv";
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return name;
}
