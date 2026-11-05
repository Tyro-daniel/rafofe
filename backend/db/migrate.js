/**
 * Applies db/schema.sql to the database pointed to by DATABASE_URL.
 * Idempotent: schema.sql uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS,
 * so running this multiple times is safe.
 *
 * Run with: npm run migrate
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool } = require("../src/db");

async function migrate() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");

  console.log("Applying schema.sql ...");
  await pool.query(sql);
  console.log("Schema applied successfully.");

  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
