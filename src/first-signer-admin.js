// What the admin page asks of the first-signer routes, without any markup.

async function send(api, path, method, body) {
  const response = await api(path, {
    method,
    body: JSON.stringify(body ?? {}),
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    // no body
  }
  if (!response.ok)
    throw Object.assign(new Error(data.error || `HTTP ${response.status}`), {
      status: response.status,
    });
  return data;
}

export function isFirstSignerList(data) {
  return (
    typeof data?.revision === "string" &&
    Array.isArray(data.ordered) &&
    Array.isArray(data.marked)
  );
}

// `position`: a number from 1, "last", or null to take it away.
export const setPosition = (api, id, position) =>
  send(api, `/api/admin/signers/${id}/position`, "POST", { position });

export const setMark = (api, id, marked) =>
  send(api, `/api/admin/signers/${id}/first-signer`, "POST", { marked });

export const saveOrder = (api, ids, revision) =>
  send(api, "/api/admin/first-signers/order", "PUT", { ids, revision });

export const addByHand = (api, entry) =>
  send(api, "/api/admin/first-signers", "POST", entry);

export const linkDuplicate = (api, handId, signerId) =>
  send(api, "/api/admin/first-signers/link", "POST", { handId, signerId });

export async function duplicatesOf(api, id) {
  const response = await api(`/api/admin/signers/${id}/duplicates`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()).duplicates;
}

export const previewImport = (api, csv, order) =>
  send(api, "/api/admin/first-signers/import/preview", "POST", { csv, order });

export const applyImport = (api, request) =>
  send(api, "/api/admin/first-signers/import", "POST", request);

// The order list while it is being edited: `items` moved, removed or added
// and not yet saved.
export function moveItem(items, from, to) {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export const sameOrder = (a, b) =>
  a.length === b.length && a.every((item, index) => item.id === b[index].id);

// The badges of a signature in the admin lists.
export function firstSignerBadges(signer) {
  return [
    signer.firstSigner && "Erstunterzeichner*in",
    signer.position != null && `Position ${signer.position}`,
    signer.handAdded && "Von Hand eingetragen",
    signer.possibleDuplicate && "Mögliches Duplikat",
  ].filter(Boolean);
}
