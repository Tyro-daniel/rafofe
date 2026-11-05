const express = require("express");
const { z } = require("zod");
const { query, withTransaction } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { logAudit } = require("../middleware/audit");
const { buildAmortizationSchedule } = require("../utils/amortization");
const { buildDisbursementEntries, isBalanced } = require("../utils/ledger");
const { notify } = require("../services/notifications");
const emailService = require("../services/emailService");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

const DECLINE_REASON_LABELS = {
  insufficient_income: "Insufficient income",
  incomplete_documents: "Incomplete documents",
  failed_kyc: "Failed KYC/identity check",
  existing_delinquency: "Existing delinquency on record",
  amount_exceeds_policy: "Amount exceeds policy limit",
  other: "Other",
};
const DECLINE_REASON_CODES = Object.keys(DECLINE_REASON_LABELS);

router.get("/products/public", asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, name, monthly_rate_pct, min_amount, max_amount, min_tenure_months, max_tenure_months
     FROM loan_products WHERE is_active = TRUE ORDER BY id`
  );
  res.json(result.rows);
}));

router.get("/products", requireAuth, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, name, monthly_rate_pct, min_amount, max_amount, min_tenure_months, max_tenure_months
     FROM loan_products WHERE is_active = TRUE ORDER BY id`
  );
  res.json(result.rows);
}));

const applicationSchema = z.object({
  loanProductId: z.number().int().positive(),
  amountRequested: z.number().positive(),
  purpose: z.string().min(3).max(255),
  tenureMonths: z.number().int().positive(),
});

router.post(
  "/applications", requireAuth, requireRole("customer"),
  asyncHandler(async (req, res) => {
    const parsed = applicationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }

    // EMAIL VERIFICATION GATE: a customer can log in and browse before
    // verifying, but cannot submit an actual loan application until
    // their email is confirmed — this is the enforcement point for the
    // "verified before sensitive actions" design decision (see
    // auth.routes.js register handler for the full reasoning).
    const requester = await query("SELECT email_verified, full_name, email FROM users WHERE id = $1", [req.user.id]);
    if (!requester.rows[0]?.email_verified) {
      return res.status(403).json({
        error: "Please verify your email address before applying for a loan. Check your inbox for a verification link, or request a new one.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    const { loanProductId, amountRequested, purpose, tenureMonths } = parsed.data;

    const productResult = await query("SELECT * FROM loan_products WHERE id = $1 AND is_active = TRUE", [loanProductId]);
    const product = productResult.rows[0];
    if (!product) return res.status(404).json({ error: "Loan product not found or inactive" });

    if (amountRequested < product.min_amount || amountRequested > product.max_amount) {
      return res.status(400).json({ error: `Amount must be between ${product.min_amount} and ${product.max_amount} for this product` });
    }
    if (tenureMonths < product.min_tenure_months || tenureMonths > product.max_tenure_months) {
      return res.status(400).json({ error: `Tenure must be between ${product.min_tenure_months} and ${product.max_tenure_months} months for this product` });
    }

    const userResult = await query("SELECT marital_status FROM users WHERE id = $1", [req.user.id]);
    const spousalConsentRequired = userResult.rows[0]?.marital_status === "married_in_community";

    const result = await query(
      `INSERT INTO loan_applications (user_id, loan_product_id, amount_requested, purpose, tenure_months, spousal_consent_required)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, loanProductId, amountRequested, purpose, tenureMonths, spousalConsentRequired]
    );
    const application = result.rows[0];

    await notify(req.user.id, "in_app", "application_submitted", "Your loan application has been submitted and is pending review.");

    // Event 3: Loan Application Received
    const applicant = requester.rows[0];
    emailService.sendLoanApplicationReceived(
      { id: req.user.id, email: applicant.email, fullName: applicant.full_name },
      application,
      product.name
    );

    res.status(201).json(application);
  })
);

router.get("/applications/mine", requireAuth, requireRole("customer"), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT a.*, p.name AS product_name, p.monthly_rate_pct
     FROM loan_applications a JOIN loan_products p ON p.id = a.loan_product_id
     WHERE a.user_id = $1 ORDER BY a.created_at DESC`,
    [req.user.id]
  );
  res.json(result.rows);
}));

router.get("/applications", requireAuth, requireRole("loan_officer", "admin"), asyncHandler(async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = "";
  if (status) { params.push(status); where = "WHERE a.status = $1"; }
  const result = await query(
    `SELECT a.*, u.full_name AS applicant_name, u.email AS applicant_email, p.name AS product_name
     FROM loan_applications a JOIN users u ON u.id = a.user_id JOIN loan_products p ON p.id = a.loan_product_id
     ${where} ORDER BY a.created_at DESC`,
    params
  );
  res.json(result.rows);
}));

router.get("/applications/:id", requireAuth, requireRole("loan_officer", "admin"), asyncHandler(async (req, res) => {
  const appResult = await query(
    `SELECT a.*, u.full_name AS applicant_name, u.email AS applicant_email, u.phone, u.marital_status,
            p.name AS product_name, p.monthly_rate_pct, p.penalty_rate_pct
     FROM loan_applications a JOIN users u ON u.id = a.user_id JOIN loan_products p ON p.id = a.loan_product_id
     WHERE a.id = $1`,
    [req.params.id]
  );
  if (appResult.rows.length === 0) return res.status(404).json({ error: "Application not found" });
  const application = appResult.rows[0];
  const docsResult = await query(
    "SELECT id, doc_type, status, original_name, uploaded_at FROM documents WHERE user_id = $1 ORDER BY uploaded_at DESC",
    [application.user_id]
  );
  res.json({ ...application, documents: docsResult.rows });
}));

router.patch(
  "/applications/:id/decision", requireAuth, requireRole("loan_officer", "admin"),
  asyncHandler(async (req, res) => {
    const { decision, declineReasonCode, declineNotes, startDate } = req.body;

    if (!["approved", "declined"].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approved' or 'declined'" });
    }
    if (decision === "declined" && !DECLINE_REASON_CODES.includes(declineReasonCode)) {
      return res.status(400).json({ error: `declineReasonCode must be one of: ${DECLINE_REASON_CODES.join(", ")}` });
    }

    const output = await withTransaction(async (client) => {
      const appResult = await client.query(
        `SELECT a.*, u.full_name AS applicant_name, u.email AS applicant_email,
                p.monthly_rate_pct, p.penalty_rate_pct
         FROM loan_applications a
         JOIN users u ON u.id = a.user_id
         JOIN loan_products p ON p.id = a.loan_product_id
         WHERE a.id = $1 FOR UPDATE`,
        [req.params.id]
      );
      const application = appResult.rows[0];
      if (!application) throw httpError(404, "Application not found");
      if (application.status !== "submitted" && application.status !== "under_review") {
        throw httpError(409, `Application is already '${application.status}' and cannot be re-decided`);
      }
      if (decision === "approved" && application.spousal_consent_required && !application.spousal_consent_provided) {
        throw httpError(422, "Spousal consent is required for this applicant before approval (Botswana Microlending Regulations)");
      }

      const applicantForEmail = { id: application.user_id, email: application.applicant_email, fullName: application.applicant_name };

      if (decision === "declined") {
        const updated = await client.query(
          `UPDATE loan_applications SET status = 'declined', decline_reason_code = $1, decline_notes = $2, reviewed_by = $3, reviewed_at = now()
           WHERE id = $4 RETURNING *`,
          [declineReasonCode, declineNotes || null, req.user.id, req.params.id]
        );
        await logAudit(client, {
          actorId: req.user.id, action: "application_declined", entityType: "loan_application",
          entityId: Number(req.params.id), before: application, after: updated.rows[0], ip: req.ip,
        });
        await notify(application.user_id, "in_app", "application_declined", `Your loan application was declined: ${declineReasonCode}`);

        // Event 5: Loan Rejected
        emailService.sendLoanRejected(applicantForEmail, updated.rows[0], DECLINE_REASON_LABELS[declineReasonCode]);

        return { application: updated.rows[0] };
      }

      const disbursementDate = startDate ? new Date(startDate) : new Date();

      const acctResult = await client.query(
        `INSERT INTO loan_accounts (application_id, user_id, principal, monthly_rate_pct, tenure_months, penalty_rate_pct, start_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          application.id, application.user_id, application.amount_requested, application.monthly_rate_pct,
          application.tenure_months, application.penalty_rate_pct, disbursementDate.toISOString().slice(0, 10),
        ]
      );
      const loanAccount = acctResult.rows[0];

      const schedule = buildAmortizationSchedule(
        Number(application.amount_requested), Number(application.monthly_rate_pct), application.tenure_months, disbursementDate
      );

      for (const row of schedule) {
        await client.query(
          `INSERT INTO schedule_entries (loan_account_id, installment_no, due_date, opening_balance, principal_due, interest_due, total_due, closing_balance)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [loanAccount.id, row.installmentNo, row.dueDate, row.openingBalance, row.principalDue, row.interestDue, row.totalDue, row.closingBalance]
        );
      }

      const txnResult = await client.query(
        `INSERT INTO transactions (loan_account_id, txn_type, amount, recorded_by, notes)
         VALUES ($1, 'disbursement', $2, $3, 'Loan disbursed on approval') RETURNING id`,
        [loanAccount.id, application.amount_requested, req.user.id]
      );
      const transactionId = txnResult.rows[0].id;

      const entries = buildDisbursementEntries(loanAccount.id, transactionId, Number(application.amount_requested));
      if (!isBalanced(entries)) throw httpError(500, "Internal error: disbursement ledger entries do not balance");

      for (const e of entries) {
        await client.query(
          `INSERT INTO ledger_entries (loan_account_id, transaction_id, account_name, entry_type, amount) VALUES ($1, $2, $3, $4, $5)`,
          [e.loan_account_id, e.transaction_id, e.account_name, e.entry_type, e.amount]
        );
      }

      const updatedApp = await client.query(
        `UPDATE loan_applications SET status = 'approved', reviewed_by = $1, reviewed_at = now() WHERE id = $2 RETURNING *`,
        [req.user.id, req.params.id]
      );

      await logAudit(client, {
        actorId: req.user.id, action: "application_approved", entityType: "loan_application",
        entityId: Number(req.params.id), before: application, after: { application: updatedApp.rows[0], loanAccount }, ip: req.ip,
      });
      await notify(application.user_id, "in_app", "application_approved", `Your loan of ${application.amount_requested} has been approved and disbursed.`);

      // Event 4 + Event 6: Loan Approved, then Loan Disbursed. Sent as
      // two distinct emails per the required event list, even though in
      // this system approval and disbursement happen atomically in the
      // same transaction — a customer sees them as two separate,
      // meaningful confirmations (a decision, then money movement).
      emailService.sendLoanApproved(applicantForEmail, updatedApp.rows[0], loanAccount);
      emailService.sendLoanDisbursed(applicantForEmail, loanAccount);

      return { application: updatedApp.rows[0], loanAccount, schedule };
    });

    res.json(output);
  })
);

router.post("/applications/:id/agreement/sign", requireAuth, requireRole("customer"), asyncHandler(async (req, res) => {
  const result = await query(`SELECT * FROM loan_applications WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
  const application = result.rows[0];
  if (!application) return res.status(404).json({ error: "Application not found" });
  if (application.status !== "approved") return res.status(409).json({ error: "Only approved applications can be signed" });
  if (application.spousal_consent_required && !application.spousal_consent_provided) {
    return res.status(422).json({ error: "Spousal consent document must be uploaded and verified before signing" });
  }
  const updated = await query(
    `UPDATE loan_applications SET agreement_signed = TRUE, agreement_signed_at = now() WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  res.json(updated.rows[0]);
}));

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

module.exports = router;
