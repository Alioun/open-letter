export const MAILING_LEASE_MS = 10 * 60 * 1000;
export const MAX_MAILING_ATTEMPTS = 5;
const RETRY_BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000];

export const meetingKey = (kind, generation) =>
  generation === 0 ? kind : `generation:${generation}:${kind}`;
export const meetingMailing = (kind, generation) =>
  generation === 0 ? `zoom-${kind}` : `zoom:${generation}:${kind}`;
export const meetingScope = (kind, config, recipient) =>
  config.generation === 0 && kind !== "confirmation"
    ? `zoom-${kind}:${config.eventAtIso}:${kind === "reminder" ? recipient.email : recipient.id}`
    : `${meetingMailing(kind, config.generation)}:${recipient.id}`;

export function createMeetingRepository(connection) {
  const now = () => new Date().toISOString();
  async function generation({ connection: reader = connection } = {}) {
    const row = await reader
      .query("SELECT value FROM app_settings WHERE key='zoom_generation'")
      .get();
    return Number(row?.value || 0);
  }
  async function forGeneration(
    expected,
    operation,
    { connection: writer = connection } = {},
  ) {
    return writer.transaction(
      async () => {
        if ((await generation({ connection: writer })) !== expected)
          return false;
        await operation(writer);
        return true;
      },
      { immediate: true },
    );
  }
  return {
    generation,
    isCurrent: async (expected, options) =>
      (await generation(options)) === expected,
    forGeneration,
    async claim(kind, expected) {
      let claimed = false;
      await forGeneration(expected, async () => {
        const row = await connection
          .query(
            `INSERT INTO zoom_event_mailings (kind,status,attempts,updated_at)
           VALUES (?,'sending',1,?) ON CONFLICT(kind) DO UPDATE
           SET status='sending', attempts=attempts+1, updated_at=excluded.updated_at
           WHERE (status='failed' AND (updated_at IS NULL OR updated_at < CASE attempts
             WHEN 0 THEN ? WHEN 1 THEN ? WHEN 2 THEN ? WHEN 3 THEN ? ELSE ? END))
             OR (status='sending' AND (updated_at IS NULL OR updated_at < ?))
           RETURNING kind`,
          )
          .get(
            meetingKey(kind, expected),
            now(),
            now(),
            ...RETRY_BACKOFF_MS.map((ms) =>
              new Date(Date.now() - ms).toISOString(),
            ),
            new Date(Date.now() - MAILING_LEASE_MS).toISOString(),
          );
        claimed = Boolean(row);
      });
      return claimed;
    },
    async touch(kind, expected) {
      await forGeneration(expected, () =>
        connection
          .query(
            "UPDATE zoom_event_mailings /* public-neutral */ SET updated_at=? WHERE kind=? AND status='sending'",
          )
          .run(now(), meetingKey(kind, expected)),
      );
    },
    async mark(kind, expected, status, count = null, failure = null) {
      await forGeneration(expected, () =>
        connection
          .query(
            `UPDATE zoom_event_mailings SET status=CASE WHEN ?='failed' AND attempts>=? THEN 'aborted' ELSE ? END,
         recipient_count=?, failure=?, sent_at=CASE WHEN ?='sent' THEN ? ELSE sent_at END,
         updated_at=? WHERE kind=?`,
          )
          .run(
            status,
            MAX_MAILING_ATTEMPTS,
            status,
            count,
            failure ? JSON.stringify(failure) : null,
            status,
            now(),
            now(),
            meetingKey(kind, expected),
          ),
      );
    },
    async defer(kind, expected, failure = null) {
      await forGeneration(expected, () =>
        connection
          .query(
            `UPDATE zoom_event_mailings /* public-neutral */ SET status='failed',
         attempts=MAX(0,attempts-1),failure=?,updated_at=? WHERE kind=?`,
          )
          .run(
            failure ? JSON.stringify(failure) : null,
            now(),
            meetingKey(kind, expected),
          ),
      );
    },
    async list(expected = undefined) {
      return connection.transaction(async () => {
        expected ??= await generation();
        const rows = await connection
          .query(
            `SELECT kind,status,recipient_count,sent_at,updated_at,attempts,failure
           FROM zoom_event_mailings WHERE kind IN (?,?) ORDER BY kind`,
          )
          .all(meetingKey("link", expected), meetingKey("reminder", expected));
        return rows.map((row) => ({
          ...row,
          kind: row.kind === meetingKey("link", expected) ? "link" : "reminder",
          failure: row.failure ? JSON.parse(row.failure) : null,
        }));
      });
    },
    async delivered(kind, expected) {
      const rows = await connection
        .query("SELECT email FROM mailing_deliveries WHERE mailing=?")
        .all(meetingMailing(kind, expected));
      return new Set(rows.map((row) => row.email));
    },
    async count(kind, expected) {
      const row = await connection
        .query("SELECT COUNT(*) AS n FROM mailing_deliveries WHERE mailing=?")
        .get(meetingMailing(kind, expected));
      return row.n;
    },
  };
}
