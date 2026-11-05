/**
 * Event 7: Payment Reminder.
 *
 * Meant to be run on a schedule (e.g. daily via cron), NOT as part of
 * the always-running Express server — there's no built-in job scheduler
 * in this stack, and a standalone script invoked by cron is the
 * simplest, most transparent way to run a daily task without adding a
 * new dependency (node-cron, agenda, etc.) that would need its own
 * always-on process.
 *
 * Run manually:      npm run send-reminders
 * Run via cron (example, 8am daily):
 *   0 8 * * * cd /path/to/backend && /usr/bin/node scripts/sendPaymentReminders.js >> /var/log/lms-reminders.log 2>&1
 *
 * Finds installments due within REMINDER_WINDOW_DAYS that have not
 * already had a reminder sent for THIS specific installment within the
 * last 24 hours (dedup via email_log, keyed on related_entity_type =
 * 'schedule_entry' — so re-running this script twice in one day, or a
 * cron misfire, never double-sends the same reminder).
 */
require("dotenv").config();
const { pool, query } = require("../src/db");
const emailService = require("../src/services/emailService");

const REMINDER_WINDOW_DAYS = 3;

async function run() {
  const dueEntries = await query(
    `SELECT se.*, la.user_id, la.id AS loan_account_id, u.full_name, u.email
     FROM schedule_entries se
     JOIN loan_accounts la ON la.id = se.loan_account_id
     JOIN users u ON u.id = la.user_id
     WHERE se.status IN ('upcoming', 'due')
       AND se.due_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + ($1 || ' days')::interval)
       AND la.status IN ('active', 'delinquent')
     ORDER BY se.due_date`,
    [REMINDER_WINDOW_DAYS]
  );

  console.log(`Found ${dueEntries.rows.length} installment(s) within the ${REMINDER_WINDOW_DAYS}-day reminder window.`);

  let sent = 0;
  let skipped = 0;

  for (const entry of dueEntries.rows) {
    const alreadySent = await query(
      `SELECT id FROM email_log
       WHERE event_type = 'payment_reminder' AND related_entity_type = 'schedule_entry' AND related_entity_id = $1
         AND created_at > now() - INTERVAL '24 hours'
       LIMIT 1`,
      [entry.id]
    );
    if (alreadySent.rows.length > 0) {
      skipped++;
      continue;
    }

    const result = await emailService.sendPaymentReminder(
      { id: entry.user_id, email: entry.email, fullName: entry.full_name },
      { id: entry.loan_account_id },
      entry
    );

    // The email service's own sendEmail() function does NOT stamp
    // related_entity onto payment_reminder rows with the schedule_entry
    // id (it uses loan_account by default in the template function) —
    // patch that specific row here so the dedup query above can find it
    // next run. See note in emailService.js sendPaymentReminder().
    if (result.logId) {
      await query(`UPDATE email_log SET related_entity_type = 'schedule_entry', related_entity_id = $1 WHERE id = $2`, [entry.id, result.logId]);
    }

    if (result.success) sent++;
    console.log(`  Installment #${entry.installment_no} (loan #${entry.loan_account_id}, ${entry.email}): ${result.success ? "sent" : "FAILED - " + result.error}`);
  }

  console.log(`Done. Sent: ${sent}, skipped (already reminded in last 24h): ${skipped}, total candidates: ${dueEntries.rows.length}.`);
  await pool.end();
}

run().catch((err) => {
  console.error("sendPaymentReminders failed:", err);
  process.exit(1);
});
