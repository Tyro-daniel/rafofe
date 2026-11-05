/**
 * Seeds the database with:
 *  - one admin account
 *  - one loan officer account
 *  - the two self-service loan products (Small and Medium)
 *
 * Run with: npm run seed (after `npm run migrate`)
 *
 * LOAN PRODUCT MODEL (Monthly Percentage Rate, flat-quoted, reducing
 * balance underneath — see backend/src/utils/amortization.js):
 *   - Small Micro Loan:  P500 – P10,000,   30% MPR  (P1,000 -> P300/month interest on the opening balance)
 *   - Medium Loan:       P10,000 – P15,000, 25% MPR
 *   - Large loans (> P15,000) are deliberately NOT a self-service
 *     product row at all — per the business requirement, these are
 *     arranged manually with a loan officer, not through the online
 *     application form. The frontend's Apply page directs customers to
 *     contact a loan officer once they need more than the Medium
 *     product's max (see frontend/src/pages/customer/ApplyForLoan.jsx).
 *
 * Idempotency: uses ON CONFLICT (name) DO UPDATE, which requires the
 * UNIQUE constraint on loan_products.name added in db/schema.sql's
 * upgrade-safety block. Running this script again (e.g. after changing
 * a rate) safely UPDATES the existing row instead of inserting a
 * duplicate — this was a real bug in an earlier version of this file
 * (no unique constraint existed, so ON CONFLICT never matched anything
 * and re-seeding silently duplicated product rows).
 *
 * UPGRADE NOTE: if your database still has the old "Standard Personal
 * Loan" product row (from before this rate-model change), the UPDATE
 * below renames it to "Medium Loan" in the same statement that fixes
 * its rate and amount range — so existing installs converge to the
 * correct state rather than ending up with both an old and a new row.
 */
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { pool } = require("../src/db");

async function seed() {
  const adminPasswordHash = await bcrypt.hash("Admin@12345", 12);
  const officerPasswordHash = await bcrypt.hash("Officer@12345", 12);

  await pool.query(
    `INSERT INTO users (email, password_hash, role, full_name, email_verified)
     VALUES ($1, $2, 'admin', 'System Administrator', TRUE) ON CONFLICT (email) DO NOTHING`,
    ["admin@lms.local", adminPasswordHash]
  );
  await pool.query(
    `INSERT INTO users (email, password_hash, role, full_name, email_verified)
     VALUES ($1, $2, 'loan_officer', 'Default Loan Officer', TRUE) ON CONFLICT (email) DO NOTHING`,
    ["officer@lms.local", officerPasswordHash]
  );

  // One-time upgrade step: if the pre-rename product row still exists
  // under its old name, rename it before the upsert below so the
  // ON CONFLICT (name) match lands on the right row instead of creating
  // a second "Medium Loan" alongside a stale "Standard Personal Loan".
  await pool.query(
    `UPDATE loan_products SET name = 'Medium Loan' WHERE name = 'Standard Personal Loan'`
  );

  await pool.query(
    `INSERT INTO loan_products (name, monthly_rate_pct, min_amount, max_amount, min_tenure_months, max_tenure_months, penalty_rate_pct)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (name) DO UPDATE SET monthly_rate_pct = EXCLUDED.monthly_rate_pct, min_amount = EXCLUDED.min_amount,
       max_amount = EXCLUDED.max_amount, min_tenure_months = EXCLUDED.min_tenure_months,
       max_tenure_months = EXCLUDED.max_tenure_months, penalty_rate_pct = EXCLUDED.penalty_rate_pct`,
    ["Small Micro Loan", 30.00, 500, 10000, 1, 6, 5.00]
  );

  await pool.query(
    `INSERT INTO loan_products (name, monthly_rate_pct, min_amount, max_amount, min_tenure_months, max_tenure_months, penalty_rate_pct)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (name) DO UPDATE SET monthly_rate_pct = EXCLUDED.monthly_rate_pct, min_amount = EXCLUDED.min_amount,
       max_amount = EXCLUDED.max_amount, min_tenure_months = EXCLUDED.min_tenure_months,
       max_tenure_months = EXCLUDED.max_tenure_months, penalty_rate_pct = EXCLUDED.penalty_rate_pct`,
    ["Medium Loan", 25.00, 10000, 15000, 3, 12, 5.00]
  );

  // The old seed data used the name "Short-Term Micro Loan" — if that
  // exact row exists from a prior seed run, fold it into "Small Micro
  // Loan" too rather than leaving two similar-but-differently-named rows.
  await pool.query(
    `DELETE FROM loan_products WHERE name = 'Short-Term Micro Loan' AND EXISTS (SELECT 1 FROM loan_products WHERE name = 'Small Micro Loan')`
  );

  console.log("Seed complete.");
  console.log("Admin login:   admin@lms.local / Admin@12345");
  console.log("Officer login: officer@lms.local / Officer@12345");
  console.log("Loan products: Small Micro Loan (30% MPR, P500-10,000), Medium Loan (25% MPR, P10,000-15,000)");
  console.log("(Change the seeded passwords immediately outside of local development.)");

  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
