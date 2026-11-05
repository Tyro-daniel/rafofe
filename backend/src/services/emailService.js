/**
 * Email service — every transactional email in the system goes through
 * sendEmail() at the bottom of this file, which is the ONLY place that
 * actually calls the SMTP transporter and writes to email_log. Every
 * specific event (registration, loan approved, etc.) is a thin function
 * that builds the subject/HTML and calls sendEmail() — this keeps the
 * "how do we actually send + log an email" logic in exactly one place.
 *
 * CREDENTIALS: read only from process.env (see backend/.env.example).
 * Never hardcoded, never logged, never included in any error message
 * that gets stored in email_log.error_message.
 *
 * FAILURE HANDLING: sendEmail() NEVER throws. A failed email must never
 * break the calling request — e.g. a loan approval must succeed and the
 * money must be disbursed even if the "Loan Approved" email happens to
 * fail to send. Failures are logged to email_log.status='failed' with
 * the error message, for troubleshooting, and to console.error.
 */
const nodemailer = require("nodemailer");
const { query } = require("../db");

const FROM_NAME = process.env.SMTP_FROM_NAME || "LMS";
const FROM_EMAIL = process.env.SMTP_FROM_EMAIL || "no-reply@example.com";
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:5173";

function buildTransporter() {
  const host = process.env.SMTP_HOST;
  if (!host) {
    // DEV-SAFE FALLBACK: no SMTP_HOST configured. Uses nodemailer's
    // built-in JSON transport, which never makes a real network call —
    // it just resolves successfully with the would-be message as JSON,
    // so local development works without real SMTP credentials. This
    // path still writes correctly to email_log, so the audit trail and
    // application logic can be fully exercised in dev/test without ever
    // sending a real email. NEVER rely on this in production — see
    // .env.example, which documents the real SMTP_* variables required.
    console.warn(
      "[emailService] No SMTP_HOST configured — using dev-safe JSON transport. " +
      "No real emails will be sent. Set SMTP_* variables in .env for real delivery."
    );
    return nodemailer.createTransport({ jsonTransport: true });
  }
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true", // true for port 465, false for STARTTLS on 587
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
}

const transporter = buildTransporter();

/** Escape user-supplied text before interpolating into HTML — prevents
 * HTML/script injection via a customer's own name, purpose text, etc. */
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(amount) {
  return "P " + Number(amount).toLocaleString("en-BW", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Shared branded HTML wrapper so every email looks consistent. */
/**
 * Shared branded HTML wrapper so every email looks consistent.
 *
 * CONTRACT: `heading` and `bodyHtml` are trusted raw HTML — this
 * function does NOT escape them (bodyHtml deliberately contains real
 * markup like <p>/<ul>/<li> tags, so escaping it as a whole would break
 * the layout). Callers are responsible for calling escapeHtml() on any
 * user-controlled VALUE before interpolating it into either string —
 * every event function below already does this correctly. Do not add
 * an escapeHtml() call here — a previous version of this file did
 * exactly that and double-escaped the one caller that already escapes
 * its own content, producing garbled "&amp;lt;" text in the sent email.
 */
function wrapTemplate({ heading, bodyHtml, ctaLabel, ctaUrl }) {
  const ctaHtml = ctaUrl
    ? `<p style="margin:24px 0;">
         <a href="${escapeHtml(ctaUrl)}" style="background:#0b4f3a;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">${escapeHtml(ctaLabel || "View details")}</a>
       </p>`
    : "";
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f7f5f0;font-family:Arial,Helvetica,sans-serif;color:#16211c;">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
      <h1 style="font-size:20px;color:#0b4f3a;margin:0 0 16px;">${heading}</h1>
      <div style="font-size:14px;line-height:1.6;color:#16211c;">${bodyHtml}</div>
      ${ctaHtml}
      <p style="font-size:12px;color:#8b988f;margin-top:32px;border-top:1px solid #e4e0d6;padding-top:16px;">
        This is an automated message. Please do not reply directly to this email.
        If you did not expect this message, please contact support.
      </p>
    </div>
  </body>
</html>`;
}

/**
 * Core send function. Writes a 'queued' row BEFORE attempting to send —
 * this way, even a hard crash mid-send still leaves an audit trail
 * showing intent to send, which matters for compliance ("did we try to
 * notify this customer?") independent of whether the send itself
 * succeeded.
 */
async function sendEmail({ userId = null, recipientEmail, recipientName = null, eventType, subject, html, relatedEntityType = null, relatedEntityId = null }) {
  let logId = null;
  try {
    const inserted = await query(
      `INSERT INTO email_log (user_id, recipient_email, recipient_name, event_type, subject, related_entity_type, related_entity_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'queued') RETURNING id`,
      [userId, recipientEmail, recipientName, eventType, subject, relatedEntityType, relatedEntityId]
    );
    logId = inserted.rows[0].id;
  } catch (logErr) {
    console.error("[emailService] Failed to write email_log row before send:", logErr.message);
  }

  try {
    const info = await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: recipientEmail,
      subject,
      html,
    });
    if (logId) {
      await query(
        `UPDATE email_log SET status = 'sent', sent_at = now(), provider_message_id = $1 WHERE id = $2`,
        [info.messageId || null, logId]
      ).catch((e) => console.error("[emailService] Failed to mark email_log sent:", e.message));
    }
    return { success: true, logId };
  } catch (sendErr) {
    console.error(`[emailService] Failed to send "${eventType}" to ${recipientEmail}:`, sendErr.message);
    if (logId) {
      await query(
        `UPDATE email_log SET status = 'failed', error_message = $1, retry_count = retry_count + 1 WHERE id = $2`,
        [String(sendErr.message).slice(0, 1000), logId]
      ).catch((e) => console.error("[emailService] Failed to mark email_log failed:", e.message));
    }
    // Deliberately does NOT throw or reject — see file header.
    return { success: false, error: sendErr.message, logId };
  }
}

// =====================================================================
// 1. Registration Confirmation
// =====================================================================
function sendRegistrationConfirmation(user) {
  const subject = "Welcome to LMS — your account has been created";
  const html = wrapTemplate({
    heading: `Welcome, ${escapeHtml(user.fullName)}`,
    bodyHtml: `<p>Thanks for creating an account with us. Your registration was successful.</p>
      <p>We've sent a separate email with a link to verify your address — please confirm it so you can apply for a loan.</p>`,
  });
  return sendEmail({
    userId: user.id, recipientEmail: user.email, recipientName: user.fullName,
    eventType: "registration_confirmation", subject, html,
    relatedEntityType: "user", relatedEntityId: user.id,
  });
}

// =====================================================================
// 2. Email Verification
// =====================================================================
function sendEmailVerification(user, rawToken) {
  const verifyUrl = `${APP_BASE_URL}/verify-email?token=${rawToken}`;
  const subject = "Verify your email address";
  const html = wrapTemplate({
    heading: "Verify your email",
    bodyHtml: `<p>Hi ${escapeHtml(user.fullName)}, please confirm this is your email address to activate your account.</p>
      <p>This link expires in 24 hours.</p>`,
    ctaLabel: "Verify my email",
    ctaUrl: verifyUrl,
  });
  return sendEmail({
    userId: user.id, recipientEmail: user.email, recipientName: user.fullName,
    eventType: "email_verification", subject, html,
    relatedEntityType: "user", relatedEntityId: user.id,
  });
}

// =====================================================================
// 3. Loan Application Received
// =====================================================================
function sendLoanApplicationReceived(user, application, productName) {
  const subject = `We've received your loan application (#${application.id})`;
  const html = wrapTemplate({
    heading: "Application received",
    bodyHtml: `<p>Hi ${escapeHtml(user.fullName)}, we've received your application for the ${escapeHtml(productName)}.</p>
      <ul>
        <li>Amount requested: ${money(application.amount_requested)}</li>
        <li>Term: ${escapeHtml(String(application.tenure_months))} months</li>
      </ul>
      <p>A loan officer will review it — you'll hear back, usually within one business day.</p>`,
  });
  return sendEmail({
    userId: user.id, recipientEmail: user.email, recipientName: user.fullName,
    eventType: "loan_application_received", subject, html,
    relatedEntityType: "loan_application", relatedEntityId: application.id,
  });
}

// =====================================================================
// 4. Loan Approved
// =====================================================================
function sendLoanApproved(user, application, loanAccount) {
  const subject = `Your loan has been approved (#${application.id})`;
  const html = wrapTemplate({
    heading: "Loan approved",
    bodyHtml: `<p>Good news, ${escapeHtml(user.fullName)} — your loan application has been approved.</p>
      <ul>
        <li>Principal: ${money(loanAccount.principal)}</li>
        <li>Rate: ${escapeHtml(String(loanAccount.monthly_rate_pct))}% MPR</li>
        <li>Term: ${escapeHtml(String(loanAccount.tenure_months))} months</li>
      </ul>`,
    ctaLabel: "View my repayment schedule",
    ctaUrl: `${APP_BASE_URL}/loans/${loanAccount.id}`,
  });
  return sendEmail({
    userId: user.id, recipientEmail: user.email, recipientName: user.fullName,
    eventType: "loan_approved", subject, html,
    relatedEntityType: "loan_application", relatedEntityId: application.id,
  });
}

// =====================================================================
// 5. Loan Rejected
// =====================================================================
function sendLoanRejected(user, application, reasonLabel) {
  const subject = `Update on your loan application (#${application.id})`;
  const html = wrapTemplate({
    heading: "Application decision",
    bodyHtml: `<p>Hi ${escapeHtml(user.fullName)}, after review we're unable to approve your loan application at this time.</p>
      <p>Reason: ${escapeHtml(reasonLabel)}</p>
      <p>If you have questions about this decision, please contact a loan officer.</p>`,
  });
  return sendEmail({
    userId: user.id, recipientEmail: user.email, recipientName: user.fullName,
    eventType: "loan_rejected", subject, html,
    relatedEntityType: "loan_application", relatedEntityId: application.id,
  });
}

// =====================================================================
// 6. Loan Disbursed
// =====================================================================
function sendLoanDisbursed(user, loanAccount) {
  const subject = `Your funds have been disbursed (loan #${loanAccount.id})`;
  const html = wrapTemplate({
    heading: "Funds disbursed",
    bodyHtml: `<p>Hi ${escapeHtml(user.fullName)}, ${money(loanAccount.principal)} has been disbursed for loan #${loanAccount.id}.</p>
      <p>Your first repayment is due one month from your disbursement date — check your repayment schedule for exact dates.</p>`,
    ctaLabel: "View my repayment schedule",
    ctaUrl: `${APP_BASE_URL}/loans/${loanAccount.id}`,
  });
  return sendEmail({
    userId: user.id, recipientEmail: user.email, recipientName: user.fullName,
    eventType: "loan_disbursed", subject, html,
    relatedEntityType: "loan_account", relatedEntityId: loanAccount.id,
  });
}

// =====================================================================
// 7. Payment Reminder
// =====================================================================
function sendPaymentReminder(user, loanAccount, scheduleEntry) {
  const subject = `Reminder: payment due ${scheduleEntry.due_date} (loan #${loanAccount.id})`;
  const html = wrapTemplate({
    heading: "Upcoming payment reminder",
    bodyHtml: `<p>Hi ${escapeHtml(user.fullName)}, this is a reminder that installment #${scheduleEntry.installment_no} on loan #${loanAccount.id} is due on ${escapeHtml(scheduleEntry.due_date)}.</p>
      <ul>
        <li>Amount due: ${money(scheduleEntry.total_due)}</li>
      </ul>`,
    ctaLabel: "View my loan",
    ctaUrl: `${APP_BASE_URL}/loans/${loanAccount.id}`,
  });
  return sendEmail({
    userId: user.id, recipientEmail: user.email, recipientName: user.fullName,
    eventType: "payment_reminder", subject, html,
    relatedEntityType: "loan_account", relatedEntityId: loanAccount.id,
  });
}

// =====================================================================
// 8. Overdue Notice
// =====================================================================
function sendOverdueNotice(user, loanAccount, scheduleEntry, daysOverdue) {
  const subject = `Payment overdue — ${daysOverdue} day(s) (loan #${loanAccount.id})`;
  const html = wrapTemplate({
    heading: "Payment overdue",
    bodyHtml: `<p>Hi ${escapeHtml(user.fullName)}, installment #${scheduleEntry.installment_no} on loan #${loanAccount.id} was due on ${escapeHtml(scheduleEntry.due_date)} and is now ${escapeHtml(String(daysOverdue))} day(s) overdue.</p>
      <ul>
        <li>Amount due: ${money(scheduleEntry.total_due)}</li>
      </ul>
      <p>A late payment penalty may apply, capped at 5% of your outstanding balance per month as required by NBFIRA regulations. Please make payment as soon as possible.</p>`,
    ctaLabel: "View my loan",
    ctaUrl: `${APP_BASE_URL}/loans/${loanAccount.id}`,
  });
  return sendEmail({
    userId: user.id, recipientEmail: user.email, recipientName: user.fullName,
    eventType: "overdue_notice", subject, html,
    relatedEntityType: "loan_account", relatedEntityId: loanAccount.id,
  });
}

// =====================================================================
// 9. Loan Fully Settled
// =====================================================================
function sendLoanFullySettled(user, loanAccount) {
  const subject = `Loan #${loanAccount.id} fully settled — thank you`;
  const html = wrapTemplate({
    heading: "Loan fully settled",
    bodyHtml: `<p>Hi ${escapeHtml(user.fullName)}, your loan #${loanAccount.id} has been fully repaid. Thank you for banking with us.</p>`,
  });
  return sendEmail({
    userId: user.id, recipientEmail: user.email, recipientName: user.fullName,
    eventType: "loan_fully_settled", subject, html,
    relatedEntityType: "loan_account", relatedEntityId: loanAccount.id,
  });
}

// =====================================================================
// 10. Password Reset (request + completion confirmation)
// =====================================================================
function sendPasswordResetRequested(user, rawToken) {
  const resetUrl = `${APP_BASE_URL}/reset-password?token=${rawToken}`;
  const subject = "Reset your password";
  const html = wrapTemplate({
    heading: "Password reset requested",
    bodyHtml: `<p>Hi ${escapeHtml(user.fullName)}, we received a request to reset your password. This link expires in 60 minutes.</p>
      <p>If you didn't request this, you can safely ignore this email — your password will not be changed.</p>`,
    ctaLabel: "Reset my password",
    ctaUrl: resetUrl,
  });
  return sendEmail({
    userId: user.id, recipientEmail: user.email, recipientName: user.fullName,
    eventType: "password_reset_requested", subject, html,
    relatedEntityType: "user", relatedEntityId: user.id,
  });
}

function sendPasswordResetCompleted(user) {
  const subject = "Your password was changed";
  const html = wrapTemplate({
    heading: "Password changed",
    bodyHtml: `<p>Hi ${escapeHtml(user.fullName)}, this confirms your password was just changed.</p>
      <p>If you did not make this change, please contact support immediately.</p>`,
  });
  return sendEmail({
    userId: user.id, recipientEmail: user.email, recipientName: user.fullName,
    eventType: "password_reset_completed", subject, html,
    relatedEntityType: "user", relatedEntityId: user.id,
  });
}

module.exports = {
  // Low-level primitive — prefer the specific event functions below in
  // application code; exported mainly so it can be tested directly and
  // for any future genuinely one-off email need.
  sendEmail,
  sendRegistrationConfirmation,
  sendEmailVerification,
  sendLoanApplicationReceived,
  sendLoanApproved,
  sendLoanRejected,
  sendLoanDisbursed,
  sendPaymentReminder,
  sendOverdueNotice,
  sendLoanFullySettled,
  sendPasswordResetRequested,
  sendPasswordResetCompleted,
};
