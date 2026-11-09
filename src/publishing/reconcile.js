const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const templatesById = (templates = []) =>
  Object.fromEntries(templates.map((t) => [String(t.id), t]));
const faqPath = (path) =>
  path.length === 5 &&
  path[0] === "locales" &&
  path[2] === "blocks" &&
  path[4] === "items";
const questionIds = (items = []) => items.map((q) => q.id);
const questionsById = (items = []) =>
  Object.fromEntries(items.map((q) => [q.id, q]));

function completeOrder(primary, secondary, surviving) {
  const order = [...new Set(primary)].filter((id) => surviving.has(id));
  const fallback = [...new Set([...secondary, ...surviving])];
  for (let i = 0; i < fallback.length; i++) {
    const id = fallback[i];
    if (!surviving.has(id) || order.includes(id)) continue;
    const previous = fallback
      .slice(0, i)
      .reverse()
      .find((other) => order.includes(other));
    const next = fallback.slice(i + 1).find((other) => order.includes(other));
    const index =
      next && (!previous || order.indexOf(previous) < order.indexOf(next))
        ? order.indexOf(next)
        : previous
          ? order.indexOf(previous) + 1
          : order.length;
    order.splice(index, 0, id);
  }
  return order;
}

export function publicationChanges(before, after, path = []) {
  if (equal(before, after)) return [];
  if (faqPath(path) && (Array.isArray(before) || Array.isArray(after)))
    return publicationChanges(
      { byId: questionsById(before), order: questionIds(before) },
      { byId: questionsById(after), order: questionIds(after) },
      path,
    );
  if (
    path.length === 1 &&
    path[0] === "templates" &&
    (Array.isArray(before) || Array.isArray(after))
  )
    return publicationChanges(
      templatesById(before),
      templatesById(after),
      path,
    );
  if (object(before) && object(after))
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => !(path[0] === "templates" && key === "updated_at"))
      .flatMap((key) =>
        publicationChanges(before[key], after[key], [...path, key]),
      );
  return [{ key: JSON.stringify(path), path, current: before, local: after }];
}

export function reconcilePublication(base, local, current, choices = {}) {
  const conflicts = [];
  function merge(before, mine, theirs, path) {
    if (equal(mine, theirs)) return structuredClone(mine);
    if (base && equal(before, mine)) return structuredClone(theirs);
    if (base && equal(before, theirs)) return structuredClone(mine);
    if (faqPath(path) && (Array.isArray(mine) || Array.isArray(theirs))) {
      const questions = merge(
        questionsById(before),
        questionsById(mine),
        questionsById(theirs),
        [...path, "byId"],
      );
      const surviving = new Set(Object.keys(questions));
      const beforeOrder = questionIds(before),
        mineOrder = questionIds(mine),
        theirOrder = questionIds(theirs);
      const originalIds = new Set(
        beforeOrder.filter((id) => surviving.has(id)),
      );
      const localExisting = completeOrder(mineOrder, beforeOrder, originalIds);
      const currentExisting = completeOrder(
        theirOrder,
        beforeOrder,
        originalIds,
      );
      const originalExisting = beforeOrder.filter((id) => surviving.has(id));
      const localOrder = completeOrder(
        mineOrder,
        [...beforeOrder, ...theirOrder],
        surviving,
      );
      const currentOrder = completeOrder(
        theirOrder,
        [...beforeOrder, ...mineOrder],
        surviving,
      );
      let order;
      if (base && equal(localExisting, currentExisting))
        order = completeOrder(theirOrder, mineOrder, surviving);
      else if (base && equal(localExisting, originalExisting))
        order = currentOrder;
      else if (base && equal(currentExisting, originalExisting))
        order = localOrder;
      else if (equal(localOrder, currentOrder)) order = localOrder;
      else {
        const orderPath = [...path, "order"],
          key = JSON.stringify(orderPath);
        conflicts.push({
          key,
          path: orderPath,
          local: localOrder,
          current: currentOrder,
        });
        order = choices[key] === "current" ? currentOrder : localOrder;
      }
      return order.map((id) => questions[id]);
    }
    if (
      path.length === 1 &&
      path[0] === "templates" &&
      (Array.isArray(mine) || Array.isArray(theirs))
    ) {
      const merged = merge(
        templatesById(before),
        templatesById(mine),
        templatesById(theirs),
        path,
      );
      const order = [
        ...new Set([
          ...(theirs || []).map((t) => String(t.id)),
          ...(mine || []).map((t) => String(t.id)),
        ]),
      ];
      return order.filter((id) => merged[id]).map((id) => merged[id]);
    }
    if (path[0] === "templates" && path.at(-1) === "updated_at")
      return structuredClone(theirs ?? mine);
    const identityCollision =
      path[0] === "templates" &&
      path.length === 2 &&
      mine &&
      theirs &&
      mine.slug !== theirs.slug;
    if (
      !identityCollision &&
      object(mine) &&
      object(theirs) &&
      (!base || object(before))
    ) {
      const out = {};
      for (const key of new Set([
        ...Object.keys(mine),
        ...Object.keys(theirs),
        ...Object.keys(before || {}),
      ])) {
        const value = merge(before?.[key], mine[key], theirs[key], [
          ...path,
          key,
        ]);
        if (value !== undefined) out[key] = value;
      }
      return out;
    }
    const key = JSON.stringify(path);
    conflicts.push({ key, path, local: mine, current: theirs });
    return structuredClone(choices[key] === "current" ? theirs : mine);
  }
  return { document: merge(base, local, current, []), conflicts };
}

export function reconcileImport(existing, incoming, current, choices = {}) {
  const forStage = (stage) =>
    Object.fromEntries(
      Object.entries(choices)
        .filter(([key]) => key.startsWith(`${stage}:`))
        .map(([key, value]) => [key.slice(stage.length + 1), value]),
    );
  const workspace = reconcilePublication(
    existing.base,
    existing.document,
    current,
    forStage("workspace"),
  );
  const imported = reconcilePublication(
    incoming.base,
    incoming.document,
    workspace.document,
    forStage("file"),
  );
  return {
    document: imported.document,
    conflicts: [
      ...workspace.conflicts.map((c) => ({
        ...c,
        key: `workspace:${c.key}`,
        localLabel: "Bisheriger Browserentwurf",
        currentLabel: "Aktuell veröffentlicht",
      })),
      ...imported.conflicts.map((c) => ({
        ...c,
        key: `file:${c.key}`,
        localLabel: "Importierte Datei",
        currentLabel: "Vorhandener Entwurf",
      })),
    ],
  };
}
