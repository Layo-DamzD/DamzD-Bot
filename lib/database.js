import pg from "pg";

const { Pool } = pg;

export function createDatabasePool(options = {}) {
  const connectionString = String(
    options.connectionString || process.env.DATABASE_URL || ""
  ).trim();

  if (!connectionString) return null;

  return new Pool({
    connectionString,
    max: Math.max(1, Math.min(20, Number(options.max) || 5)),
    connectionTimeoutMillis: Math.max(1000, Number(options.connectionTimeoutMillis) || 10000),
    idleTimeoutMillis: Math.max(1000, Number(options.idleTimeoutMillis) || 30000),
    keepAlive: true,
    allowExitOnIdle: true,
    ...(options.ssl ? { ssl: options.ssl } : {})
  });
}

export async function checkDatabaseConnection(pool) {
  if (!pool) return { configured: false, connected: false };
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    return { configured: true, connected: true };
  } finally {
    client.release();
  }
}
