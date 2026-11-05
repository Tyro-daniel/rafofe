const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  // A background/idle client threw an error. Log and let the process
  // supervisor (nodemon/pm2/docker) restart if this becomes fatal.
  console.error("Unexpected PostgreSQL pool error:", err);
});

/** Run a single query. Use this for anything that doesn't need a transaction. */
function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run a callback inside a single transaction. The callback receives a
 * client with the same .query(text, params) signature. Commits on
 * success, rolls back on any thrown error.
 *
 * Used for anything that must be atomic — e.g. approving a loan
 * (creates loan_account + schedule_entries + disbursement ledger
 * entries together), or recording a repayment (transaction +
 * paired ledger rows + schedule_entry update).
 */
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
