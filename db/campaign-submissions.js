export async function ensureCampaignSubmissionKeys(connection) {
  const columns = await connection.query("PRAGMA table_info(campaigns)").all();
  for (const column of ["request_key", "request_hash"])
    if (!columns.some((item) => item.name === column))
      await connection.run(`ALTER TABLE campaigns ADD COLUMN ${column} TEXT`);
  await connection.run(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_request_key ON campaigns(request_key) WHERE request_key IS NOT NULL",
  );
}
