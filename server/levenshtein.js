/**
 * Levenshtein distance between two strings.
 */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Check if two KV names are likely typo variants of each other.
 * Uses both absolute distance and relative similarity.
 */
function areSimilar(a, b) {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();

  // Exact case-insensitive match → not an outlier, they're the same
  if (al === bl) return false;

  const dist = levenshtein(al, bl);
  const maxLen = Math.max(a.length, b.length);

  // Very short strings (≤5 chars): only distance 1 counts
  if (maxLen <= 5) return dist === 1;

  // Medium strings (6-12 chars): distance ≤ 2
  if (maxLen <= 12) return dist <= 2;

  // Longer strings: distance ≤ 3 but also check relative similarity > 80%
  return dist <= 3 && dist / maxLen < 0.2;
}

/**
 * Find groups of similar names using star topology.
 * Each group has a canonical entry (highest count) and outliers
 * that are directly similar to the canonical — no transitive chaining.
 *
 * @param {Array<Object>} items - Objects with a name field and count
 * @param {string} fieldName - Key to read the name from (default: "kreisverband")
 * @param {string|null} exclude - Value to exclude (default: "Ohne Kreisverband")
 * @returns {Array<{canonical: {name, count}, outliers: Array<{name, count, distance}>}>}
 */
export function findOutlierGroups(kvs, fieldName = "kreisverband", exclude = "Ohne Kreisverband", normalize = null) {
  const items = kvs
    .filter((kv) => kv[fieldName] && (!exclude || kv[fieldName] !== exclude))
    .map((kv) => ({ name: kv[fieldName], count: kv.count }))
    .sort((a, b) => b.count - a.count);

  const claimed = new Set();
  const groups = [];

  // For each item (by descending count), find lower-count items similar to it
  for (let i = 0; i < items.length; i++) {
    const canonical = items[i];
    if (claimed.has(canonical.name)) continue;

    const outliers = [];

    for (let j = i + 1; j < items.length; j++) {
      const candidate = items[j];
      if (claimed.has(candidate.name)) continue;

      if (normalize && normalize(canonical.name) === normalize(candidate.name)) continue;
      if (areSimilar(canonical.name, candidate.name)) {
        outliers.push({
          name: candidate.name,
          count: candidate.count,
          distance: levenshtein(
            canonical.name.toLowerCase(),
            candidate.name.toLowerCase(),
          ),
        });
        claimed.add(candidate.name);
      }
    }

    if (outliers.length > 0) {
      claimed.add(canonical.name);
      groups.push({
        canonical: { name: canonical.name, count: canonical.count },
        outliers,
      });
    }
  }

  return groups;
}
