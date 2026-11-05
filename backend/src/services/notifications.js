const { query } = require("../db");

/**
 * MVP notification "sender": writes a row to the notifications table and
 * marks it sent immediately. No real SMS/email provider is wired up yet —
 * see README "Moving to production" for how to plug in a real gateway
 * (e.g. an SMS aggregator with Botswana coverage + a transactional email
 * provider) without changing any call sites, since every caller just
 * awaits notify(userId, channel, triggerType, message).
 */
async function notify(userId, channel, triggerType, message) {
  try {
    await query(
      `INSERT INTO notifications (user_id, channel, trigger_type, message, delivery_status)
       VALUES ($1, $2, $3, $4, 'sent')`,
      [userId, channel, triggerType, message]
    );
  } catch (err) {
    // Notifications must never fail the parent request (e.g. a loan
    // approval should succeed even if the notification write has a
    // transient issue) — log and move on.
    console.error("notify() failed:", err.message);
  }
}

module.exports = { notify };
