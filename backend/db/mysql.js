// db/mysql.js
const mysql = require("mysql2/promise");

let pool;

function createPoolFromEnv() {
  // Prefer a single DATABASE_URL env var (format: mysql://user:pass@host:port/database)
  if (process.env.DATABASE_URL) {
    console.info("[db] using DATABASE_URL from env");
    return mysql.createPool(process.env.DATABASE_URL);
  }

  // Otherwise fall back to individual MYSQL_* vars
  const cfg = {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "railtrans_expo",
    port: process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  };
  console.info("[db] using MYSQL_* env vars", { host: cfg.host, database: cfg.database, port: cfg.port, user: cfg.user ? "***" : null });
  return mysql.createPool(cfg);
}

function getPool() {
  if (!pool) pool = createPoolFromEnv();
  return pool;
}

async function closePool() {
  if (pool) await pool.end();
}

// Convenience: test connection and log useful info
async function testConnection() {
  try {
    const p = getPool();
    const conn = await p.getConnection();
    await conn.ping();
    conn.release();
    console.info("[db] connection test succeeded");
    return true;
  } catch (err) {
    console.error("[db] connection test failed:", err.message || err);
    return false;
  }
}

module.exports = { getPool, closePool, testConnection };