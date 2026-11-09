import { createHmac } from "node:crypto";

export function emailHmac(email) {
  const key = process.env.DATABASE_ENCRYPTION_KEY || "";
  if (!key)
    throw new Error("DATABASE_ENCRYPTION_KEY is required for the erasure log");
  const hmacKey = createHmac("sha256", key).update("erasure-log").digest();
  return createHmac("sha256", hmacKey)
    .update(String(email).trim().toLowerCase())
    .digest("hex");
}
