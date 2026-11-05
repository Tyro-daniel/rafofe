const express = require("express");
const { query, withTransaction } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { logAudit } = require("../middleware/audit");
const { calculatePenalty, round2 } = require("../utils/amortization");
const { buildRepaymentEntries, buildPenaltyEntries, buildWriteOffEntries, isBalanced } = require("../utils/ledger");
const { notify } = require("../services/notifications");
const emailService = require("../services/emailService");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

async function loadAccountForRequester(accountId, requester) {
  const result = await query("SELECT * FROM loan_accounts WHERE id = $1", [accountId]);
  const account = result.rows[0];
  if (!account) return null;
  if (requester.role === "customer" && account.user_id !== requester.id) return "forbidden";
  return account;
}

router.get("/accounts/mine", requireAuth, requireRole("customer"), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT la.*,
            (SELECT COUNT(*) FROM schedule_entries se WHERE se.loan_account_id = la.id AND se.status = 'overdue') AS overdue_count
     FROM loan_accounts la WHERE la.user_id = $1 ORDER BY la.created_at DESC`,
    [req.user.id]
  );
  res.json(result.rows);
}));

router.get("/accounts/:id", requireAuth, asyncHandler(async (req, res) => {
  const account = await loadAccountForRequester(req.params.id, req.user);
  if (account === "forbidden") return res.status(403).json({ error: "Not your loan account" });
  if (!account) return res.status(404).json({ error: "Loan account not found" });
  res.json(account);
}));

router.get("/accounts/:id/schedule", requireAuth, asyncHandler(async (req, res) => {
  const account = await loadAccountForRequester(req.params.id, req.user);
  if (account === "forbidden") return res.status(403).json({ error: "Not your loan account" });
  if (!account) return res.status(404).json({ error: "Loan account not found" });
  const result = await query("SELECT * FROM schedule_entries WHERE loan_account_id = $1 ORDER BY installment_no", [req.params.id]);
  res.json(result.rows);
}));

router.get("/accounts/:id/statement", requireAuth, asyncHandler(async (req, res) => {
  const account = await loadAccountForRequester(req.params.id, req.user);
  if (account === "forbidden") return res.status(403).json({ error: "Not your loan account" });
  if (!account) return res.status(404).json({ error: "Loan account not found" });

  const [schedule, transactions, ledger] = await Promise.all([
    query("SELECT * FROM schedule_entries WHERE loan_account_id = $1 ORDER BY installment_no", [req.params.id]),
    query("SELECT * FROM transactions WHERE loan_account_id = $1 ORDER BY created_at", [req.params.id]),
    query("SELECT * FROM ledger_entries WHERE loan_account_id = $1 ORDER BY created_at", [req.params.id]),
  ]);

  const totalPaid = transactions.rows.filter((t) => t.txn_type === "repayment").reduce((s, t) => s + Number(t.amount), 0);
  const outstandingPrincipal = schedule.rows.length > 0 ? Number(schedule.rows[schedule.rows.length - 1].closing_balance) : 0;

  res.json({
    account, schedule: schedule.rows, transactions: transactions.rows, ledgerEntries: ledger.rows,
    summary: { totalPaid: round2(totalPaid), outstandingPrincipal },
  });
}));

router.post("/accounts/:id/repayments", requireAuth, requireRole("loan_officer", "admin"), asyncHandler(async (req, res) => {
  const { amount } = req.body;
  if (!(amount > 0)) return res.status(400).json({ error: "amount must be > 0" });

  const result = await withTransaction(async (client) => {
    const acctResult = await client.query(
      `SELECT la.*, u.full_name AS borrower_name, u.email AS borrower_email
       FROM loan_accounts la JOIN users u ON u.id = la.user_id
       WHERE la.id = $1 FOR UPDATE`,
      [req.params.id]
    );
    const account = acctResult.rows[0];
    if (!account) throw httpError(404, "Loan account not found");
    if (account.status === "closed") throw httpError(409, "Loan is already closed");

    const dueEntries = await client.query(
      `SELECT * FROM schedule_entries WHERE loan_account_id = $1 AND status IN ('upcoming','due','partially_paid','overdue') ORDER BY installment_no FOR UPDATE`,
      [req.params.id]
    );

    let remaining = round2(amount);
    let principalApplied = 0;
    let interestApplied = 0;
    const touchedInstallments = [];

    for (const entry of dueEntries.rows) {
      if (remaining <= 0) break;
      const owedOnThis = round2(Number(entry.total_due));
      const payThis = Math.min(remaining, owedOnThis);
      const ratio = owedOnThis > 0 ? payThis / owedOnThis : 0;
      const principalPart = round2(Number(entry.principal_due) * ratio);
      const interestPart = round2(payThis - principalPart);

      principalApplied = round2(principalApplied + principalPart);
      interestApplied = round2(interestApplied + interestPart);
      remaining = round2(remaining - payThis);

      const fullyPaid = payThis >= owedOnThis - 0.01;
      const newStatus = fullyPaid ? "paid" : "partially_paid";
      touchedInstallments.push({ id: entry.id, newStatus });
      await client.query("UPDATE schedule_entries SET status = $1 WHERE id = $2", [newStatus, entry.id]);
    }

    const txnResult = await client.query(
      `INSERT INTO transactions (loan_account_id, txn_type, amount, principal_portion, interest_portion, recorded_by, notes)
       VALUES ($1, 'repayment', $2, $3, $4, $5, $6) RETURNING id`,
      [req.params.id, round2(amount), principalApplied, interestApplied, req.user.id, "Repayment recorded by officer"]
    );
    const transactionId = txnResult.rows[0].id;

    const entries = buildRepaymentEntries(Number(req.params.id), transactionId, principalApplied, interestApplied);
    if (!isBalanced(entries)) throw httpError(500, "Internal error: repayment ledger entries do not balance");
    for (const e of entries) {
      await client.query(
        `INSERT INTO ledger_entries (loan_account_id, transaction_id, account_name, entry_type, amount) VALUES ($1, $2, $3, $4, $5)`,
        [e.loan_account_id, e.transaction_id, e.account_name, e.entry_type, e.amount]
      );
    }

    const remainingUnpaid = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM schedule_entries WHERE loan_account_id = $1 AND status != 'paid'`, [req.params.id]
    );
    let justClosed = false;
    if (remainingUnpaid.rows[0].cnt === 0) {
      await client.query("UPDATE loan_accounts SET status = 'closed' WHERE id = $1", [req.params.id]);
      justClosed = true;
    }

    await logAudit(client, {
      actorId: req.user.id, action: "repayment_recorded", entityType: "loan_account",
      entityId: Number(req.params.id), after: { amount, principalApplied, interestApplied, touchedInstallments }, ip: req.ip,
    });
    await notify(account.user_id, "in_app", "payment_received", `We received your payment of ${amount}. Thank you.`);

    // Event 9: Loan Fully Settled — fires exactly at the moment the last
    // outstanding installment is paid off, reusing the closure check
    // that already existed in this handler rather than a separate poll.
    if (justClosed) {
      emailService.sendLoanFullySettled(
        { id: account.user_id, email: account.borrower_email, fullName: account.borrower_name },
        account
      );
    }

    return { transactionId, principalApplied, interestApplied, unallocatedOverpayment: remaining };
  });

  res.status(201).json(result);
}));

router.post("/accounts/:id/penalties", requireAuth, requireRole("loan_officer", "admin"), asyncHandler(async (req, res) => {
  const { monthsLate } = req.body;
  if (!(monthsLate > 0)) return res.status(400).json({ error: "monthsLate must be > 0" });

  const result = await withTransaction(async (client) => {
    const acctResult = await client.query("SELECT * FROM loan_accounts WHERE id = $1 FOR UPDATE", [req.params.id]);
    const account = acctResult.rows[0];
    if (!account) throw httpError(404, "Loan account not found");

    const scheduleResult = await client.query(
      "SELECT closing_balance FROM schedule_entries WHERE loan_account_id = $1 ORDER BY installment_no DESC LIMIT 1", [req.params.id]
    );
    const outstandingPrincipal = Number(scheduleResult.rows[0]?.closing_balance || account.principal);

    const priorPenalties = await client.query(
      `SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE loan_account_id = $1 AND txn_type = 'penalty'`, [req.params.id]
    );

    const penaltyAmount = calculatePenalty(outstandingPrincipal, monthsLate, Number(account.penalty_rate_pct), Number(priorPenalties.rows[0].total));
    if (penaltyAmount <= 0) {
      return { penaltyAmount: 0, note: "Regulatory cap already reached — no further penalty can be charged on this loan" };
    }

    const txnResult = await client.query(
      `INSERT INTO transactions (loan_account_id, txn_type, amount, recorded_by, notes) VALUES ($1, 'penalty', $2, $3, $4) RETURNING id`,
      [req.params.id, penaltyAmount, req.user.id, `Late penalty for ${monthsLate} month(s) overdue`]
    );
    const transactionId = txnResult.rows[0].id;

    const entries = buildPenaltyEntries(Number(req.params.id), transactionId, penaltyAmount);
    if (!isBalanced(entries)) throw httpError(500, "Internal error: penalty ledger entries do not balance");
    for (const e of entries) {
      await client.query(
        `INSERT INTO ledger_entries (loan_account_id, transaction_id, account_name, entry_type, amount) VALUES ($1, $2, $3, $4, $5)`,
        [e.loan_account_id, e.transaction_id, e.account_name, e.entry_type, e.amount]
      );
    }

    await client.query("UPDATE loan_accounts SET status = 'delinquent' WHERE id = $1 AND status = 'active'", [req.params.id]);
    await logAudit(client, {
      actorId: req.user.id, action: "penalty_charged", entityType: "loan_account",
      entityId: Number(req.params.id), after: { penaltyAmount, monthsLate }, ip: req.ip,
    });

    return { penaltyAmount, transactionId };
  });

  res.status(201).json(result);
}));

router.post("/accounts/:id/write-off", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: "reason is required for a write-off" });

  const result = await withTransaction(async (client) => {
    const acctResult = await client.query("SELECT * FROM loan_accounts WHERE id = $1 FOR UPDATE", [req.params.id]);
    const account = acctResult.rows[0];
    if (!account) throw httpError(404, "Loan account not found");
    if (account.status === "closed" || account.status === "written_off") {
      throw httpError(409, `Loan is already '${account.status}'`);
    }

    const scheduleResult = await client.query(
      "SELECT closing_balance FROM schedule_entries WHERE loan_account_id = $1 ORDER BY installment_no DESC LIMIT 1", [req.params.id]
    );
    const outstanding = Number(scheduleResult.rows[0]?.closing_balance || 0);
    if (outstanding <= 0) throw httpError(409, "No outstanding balance to write off");

    const txnResult = await client.query(
      `INSERT INTO transactions (loan_account_id, txn_type, amount, recorded_by, notes) VALUES ($1, 'write_off', $2, $3, $4) RETURNING id`,
      [req.params.id, outstanding, req.user.id, reason]
    );
    const transactionId = txnResult.rows[0].id;

    const entries = buildWriteOffEntries(Number(req.params.id), transactionId, outstanding);
    for (const e of entries) {
      await client.query(
        `INSERT INTO ledger_entries (loan_account_id, transaction_id, account_name, entry_type, amount) VALUES ($1, $2, $3, $4, $5)`,
        [e.loan_account_id, e.transaction_id, e.account_name, e.entry_type, e.amount]
      );
    }

    await client.query("UPDATE loan_accounts SET status = 'written_off' WHERE id = $1", [req.params.id]);
    await client.query("UPDATE schedule_entries SET status = 'paid', closing_balance = 0 WHERE loan_account_id = $1 AND status != 'paid'", [req.params.id]);

    await logAudit(client, {
      actorId: req.user.id, action: "loan_written_off", entityType: "loan_account",
      entityId: Number(req.params.id), after: { amount: outstanding, reason }, ip: req.ip,
    });

    return { writtenOffAmount: outstanding };
  });

  res.status(201).json(result);
}));

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

module.exports = router;
