/**
 * Automatic overdue status transition + Event 8: Overdue Notice.
 *
 * Two responsibilities, deliberately combined in one daily job because
 * they're causally linked (a notice should fire exactly when — and
 * because — an installment becomes overdue):
 *
 *   1. STATUS TRANSITION: nothing elsewhere in this codebase ever moves
 *      a schedule_entry from 'upcoming'/'due'/'partially_paid' to
 *      'overdue' — that transition is purely time-based (an installment
 *      becomes overdue the moment its due_date passes without full
 *      payment), so it has to be driven by a scheduled job rather than
 *      a user action or API call. This script is that job's home.
 *   2. NOTIFICATION: once transitioned (or already sitting overdue from
 *      a prior run), send the customer an overdue notice — deduplicated
 *      so a customer doesn't get a fresh "overdue" email every single
 *      time this script runs if it's scheduled more than once a day.
 *
 * Run manually:      npm run send-overdue
 * Run via cron (example, 9am daily, after payment reminders):
 *   0 9 * * * cd /path/to/backend && /usr/bin/node scripts/sendOverdueNotices.js >> /var/log/lms-overdue.log 2>&1
 */
require("dotenv").config();
const { pool, query } = require("../src/db");
const emailService = require("../src/services/emailService");

const RENOTIFY_AFTER_HOURS = 20; // avoid re-sending if the job runs more than once a day

async function run() {
  // --- Step 1: transition any past-due, not-yet-fully-paid installments ---
  const transitioned = await query(
    `UPDATE schedule_entries
     SET status = 'overdue'
     WHERE due_date < CURRENT_DATE AND status IN ('upcoming', 'due', 'partially_paid')
     RETURNING id, loan_account_id, installment_no`
  );
  console.log(`Transitioned ${transitioned.rows.length} installment(s) to 'overdue'.`);

  // Mark the parent loan account delinquent too, mirroring the same
  // status the manual /penalties endpoint already sets — keeps the two
  // paths (automatic detection vs. an officer manually charging a
  // penalty) consistent with each other rather than diverging.
  if (transitioned.rows.length > 0) {
    const accountIds = [...new Set(transitioned.rows.map((r) => r.loan_account_id))];
    await query(
      `UPDATE loan_accounts SET status = 'delinquent' WHERE id = ANY($1::int[]) AND status = 'active'`,
      [accountIds]
    );
  }

  // --- Step 2: notify on every currently-overdue installment, deduplicated ---
  const overdueEntries = await query(
    `SELECT se.*, la.user_id, la.id AS loan_account_id, u.full_name, u.email,
            (CURRENT_DATE - se.due_date) AS days_overdue
     FROM schedule_entries se
     JOIN loan_accounts la ON la.id = se.loan_account_id
     JOIN users u ON u.id = la.user_id
     WHERE se.status = 'overdue' AND la.status IN ('active', 'delinquent')
     ORDER BY se.due_date`
  );

  console.log(`Found ${overdueEntries.rows.length} currently-overdue installment(s) to consider notifying.`);

  let sent = 0;
  let skipped = 0;

  for (const entry of overdueEntries.rows) {
    const alreadyNotified = await query(
      `SELECT id FROM email_log
       WHERE event_type = 'overdue_notice' AND related_entity_type = 'schedule_entry' AND related_entity_id = $1
         AND created_at > now() - ($2 || ' hours')::interval
       LIMIT 1`,
      [entry.id, RENOTIFY_AFTER_HOURS]
    );
    if (alreadyNotified.rows.length > 0) {
      skipped++;
      continue;
    }

    const result = await emailService.sendOverdueNotice(
      { id: entry.user_id, email: entry.email, fullName: entry.full_name },
      { id: entry.loan_account_id },
      entry,
      entry.days_overdue
    );

    if (result.logId) {
      await query(`UPDATE email_log SET related_entity_type = 'schedule_entry', related_entity_id = $1 WHERE id = $2`, [entry.id, result.logId]);
    }

    if (result.success) sent++;
    console.log(`  Installment #${entry.installment_no} (loan #${entry.loan_account_id}, ${entry.days_overdue}d overdue, ${entry.email}): ${result.success ? "sent" : "FAILED - " + result.error}`);
  }

  console.log(`Done. Sent: ${sent}, skipped (already notified in last ${RENOTIFY_AFTER_HOURS}h): ${skipped}, total overdue: ${overdueEntries.rows.length}.`);
  await pool.end();
}

run().catch((err) => {
  console.error("sendOverdueNotices failed:", err);
  process.exit(1);
});
