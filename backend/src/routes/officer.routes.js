const express = require("express");
const bcrypt = require("bcryptjs");
const { query } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.get("/dashboard/summary", requireAuth, requireRole("loan_officer", "admin"), asyncHandler(async (req, res) => {
  const [pendingApps, activeLoans, delinquentLoans, portfolioResult, disbursedResult, collectedResult] = await Promise.all([
    query(`SELECT COUNT(*)::int AS cnt FROM loan_applications WHERE status IN ('submitted','under_review')`),
    query(`SELECT COUNT(*)::int AS cnt FROM loan_accounts WHERE status = 'active'`),
    query(`SELECT COUNT(*)::int AS cnt FROM loan_accounts WHERE status = 'delinquent'`),
    query(`
      SELECT COALESCE(SUM(se.opening_balance), 0) AS outstanding
      FROM schedule_entries se
      JOIN (SELECT loan_account_id, MIN(installment_no) AS next_due_no FROM schedule_entries WHERE status != 'paid' GROUP BY loan_account_id) next_due
        ON next_due.loan_account_id = se.loan_account_id AND next_due.next_due_no = se.installment_no
      JOIN loan_accounts la ON la.id = se.loan_account_id
      WHERE la.status IN ('active','delinquent')
    `),
    query(`SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE txn_type = 'disbursement'`),
    query(`SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE txn_type = 'repayment'`),
  ]);

  res.json({
    pendingApplications: pendingApps.rows[0].cnt,
    activeLoans: activeLoans.rows[0].cnt,
    delinquentLoans: delinquentLoans.rows[0].cnt,
    outstandingPortfolio: Number(portfolioResult.rows[0].outstanding),
    totalDisbursed: Number(disbursedResult.rows[0].total),
    totalCollected: Number(collectedResult.rows[0].total),
  });
}));

router.get("/reports/portfolio-at-risk", requireAuth, requireRole("loan_officer", "admin"), asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT la.id AS loan_account_id, u.full_name AS borrower, u.email, la.principal, la.status,
           COUNT(se.id) FILTER (WHERE se.status = 'overdue') AS overdue_installments,
           COALESCE(SUM(se.total_due) FILTER (WHERE se.status = 'overdue'), 0) AS overdue_amount
    FROM loan_accounts la JOIN users u ON u.id = la.user_id LEFT JOIN schedule_entries se ON se.loan_account_id = la.id
    WHERE la.status IN ('active', 'delinquent')
    GROUP BY la.id, u.full_name, u.email
    HAVING COUNT(se.id) FILTER (WHERE se.status = 'overdue') > 0
    ORDER BY overdue_amount DESC
  `);
  res.json(result.rows);
}));

router.get("/reports/aging", requireAuth, requireRole("loan_officer", "admin"), asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT se.id AS schedule_entry_id, la.id AS loan_account_id, u.full_name AS borrower,
           se.due_date, se.total_due, (CURRENT_DATE - se.due_date) AS days_overdue,
           CASE WHEN (CURRENT_DATE - se.due_date) <= 30 THEN '0-30'
                WHEN (CURRENT_DATE - se.due_date) <= 60 THEN '31-60'
                WHEN (CURRENT_DATE - se.due_date) <= 90 THEN '61-90'
                ELSE '90+' END AS bucket
    FROM schedule_entries se JOIN loan_accounts la ON la.id = se.loan_account_id JOIN users u ON u.id = la.user_id
    WHERE se.status IN ('due', 'overdue', 'partially_paid') AND se.due_date < CURRENT_DATE
    ORDER BY days_overdue DESC
  `);
  res.json(result.rows);
}));

router.get("/reports/disbursement-vs-collections", requireAuth, requireRole("loan_officer", "admin"), asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT date_trunc('month', created_at)::date AS month,
           SUM(amount) FILTER (WHERE txn_type = 'disbursement') AS disbursed,
           SUM(amount) FILTER (WHERE txn_type = 'repayment') AS collected
    FROM transactions GROUP BY 1 ORDER BY 1
  `);
  res.json(result.rows);
}));

// Email log — compliance/troubleshooting visibility for staff. Filterable
// by event type, status, or a specific user, so support staff can answer
// "did the customer actually receive their approval email" without
// needing direct database access.
router.get("/email-log", requireAuth, requireRole("loan_officer", "admin"), asyncHandler(async (req, res) => {
  const { eventType, status, userId } = req.query;
  const conditions = [];
  const params = [];
  if (eventType) { params.push(eventType); conditions.push(`event_type = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
  if (userId) { params.push(userId); conditions.push(`user_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await query(
    `SELECT id, user_id, recipient_email, recipient_name, event_type, subject, related_entity_type, related_entity_id,
            status, error_message, retry_count, sent_at, created_at
     FROM email_log ${where} ORDER BY created_at DESC LIMIT 200`,
    params
  );
  res.json(result.rows);
}));

router.get("/complaints", requireAuth, requireRole("loan_officer", "admin"), asyncHandler(async (req, res) => {
  const result = await query(`SELECT c.*, u.full_name AS complainant FROM complaints c JOIN users u ON u.id = c.user_id ORDER BY c.created_at DESC`);
  res.json(result.rows);
}));

router.patch("/complaints/:id", requireAuth, requireRole("loan_officer", "admin"), asyncHandler(async (req, res) => {
  const { status, assignedTo } = req.body;
  const valid = ["open", "in_progress", "resolved", "escalated_nbfira"];
  if (status && !valid.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${valid.join(", ")}` });
  }
  const result = await query(
    `UPDATE complaints SET status = COALESCE($1, status), assigned_to = COALESCE($2, assigned_to),
       resolved_at = CASE WHEN $1 = 'resolved' THEN now() ELSE resolved_at END
     WHERE id = $3 RETURNING *`,
    [status || null, assignedTo || null, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "Complaint not found" });
  res.json(result.rows[0]);
}));

router.post("/users", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const { email, password, fullName, role } = req.body;
  if (!["loan_officer", "admin"].includes(role)) {
    return res.status(400).json({ error: "role must be 'loan_officer' or 'admin'" });
  }
  if (!email || !password || !fullName) {
    return res.status(400).json({ error: "email, password, and fullName are all required" });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await query(
    `INSERT INTO users (email, password_hash, role, full_name, email_verified) VALUES ($1, $2, $3, $4, TRUE) RETURNING id, email, role, full_name, created_at`,
    [email, passwordHash, role, fullName]
  );
  res.status(201).json(result.rows[0]);
}));

module.exports = router;
