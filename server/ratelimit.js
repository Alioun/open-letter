const windows = new Map();
// Window length per key, so cleanup only drops timestamps that have actually
// aged out of that key's window (timestamps are request times, always past).
const windowSizes = new Map();

const CLEANUP_INTERVAL = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, entries] of windows) {
    const cutoff = now - (windowSizes.get(key) ?? 0);
    const alive = entries.filter((ts) => ts > cutoff);
    if (alive.length === 0) {
      windows.delete(key);
      windowSizes.delete(key);
    } else windows.set(key, alive);
  }
}, CLEANUP_INTERVAL).unref();

export function checkRateLimit(ip, key, maxRequests, windowMs) {
  const id = `${key}:${ip}`;
  const now = Date.now();
  const cutoff = now - windowMs;

  const entries = (windows.get(id) || []).filter((ts) => ts > cutoff);
  if (entries.length >= maxRequests) {
    const oldest = entries[0];
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
    return { allowed: false, retryAfter };
  }

  entries.push(now);
  windows.set(id, entries);
  windowSizes.set(id, windowMs);
  return { allowed: true, retryAfter: 0 };
}
