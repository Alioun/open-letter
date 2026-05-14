import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export async function getSigners({ filter = "alle", search = "", limit = 18, offset = 0 }) {
  limit = Math.min(Math.max(1, limit), 100);
  offset = Math.max(0, offset);

  const conditions = [`s.verified = TRUE`, `s.show_publicly = TRUE`];
  const params = [];

  if (filter === "heute") {
    conditions.push(`s.created_at > NOW() - INTERVAL '24 hours'`);
  } else if (filter === "kv") {
    conditions.push(`s.kreisverband != ''`);
  }

  if (search.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    conditions.push(
      `(LOWER(s.name) LIKE $${params.length} OR LOWER(s.kreisverband) LIKE $${params.length})`
    );
  }

  const where = conditions.join(" AND ");

  const countResult = await sql.unsafe(
    `SELECT COUNT(*)::int AS total FROM signers s WHERE ${where}`,
    params
  );

  params.push(limit, offset);
  const signers = await sql.unsafe(
    `SELECT s.id, s.name, s.kreisverband, s.created_at
     FROM signers s
     WHERE ${where}
     ORDER BY s.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return { signers, total: countResult[0].total };
}

export async function getStats() {
  const [row] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE verified)::int AS total,
      COUNT(*) FILTER (WHERE verified AND created_at > NOW() - INTERVAL '24 hours')::int AS today,
      COUNT(*) FILTER (WHERE verified AND created_at > NOW() - INTERVAL '7 days')::int AS week,
      COUNT(DISTINCT kreisverband) FILTER (WHERE verified AND kreisverband != '')::int AS "kvCount"
    FROM signers
  `;
  return row;
}

export async function insertSigner({ name, email, kv, newsletter, showPublicly, token, expiresAt }) {
  const result = await sql`
    INSERT INTO signers (name, email, kreisverband, newsletter, show_publicly, verification_token, token_expires_at)
    VALUES (${name}, ${email}, ${kv}, ${newsletter}, ${showPublicly}, ${token}, ${expiresAt})
    ON CONFLICT (email) DO UPDATE
      SET name = EXCLUDED.name,
          kreisverband = EXCLUDED.kreisverband,
          newsletter = EXCLUDED.newsletter,
          show_publicly = EXCLUDED.show_publicly,
          verification_token = EXCLUDED.verification_token,
          token_expires_at = EXCLUDED.token_expires_at
      WHERE signers.verified = FALSE
    RETURNING id, verified
  `;
  if (result.length === 0) {
    return { ok: false, alreadyVerified: true };
  }
  return { ok: true, alreadyVerified: result[0].verified };
}

export async function confirmSigner(token) {
  const result = await sql`
    UPDATE signers
    SET verified = TRUE, verification_token = NULL, token_expires_at = NULL
    WHERE verification_token = ${token}
      AND verified = FALSE
      AND token_expires_at > NOW()
    RETURNING id
  `;
  return result.length > 0;
}

export async function healthCheck() {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function close() {
  await sql.end();
}
