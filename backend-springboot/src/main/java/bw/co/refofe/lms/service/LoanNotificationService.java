package bw.co.refofe.lms.service;

import java.util.HashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LoanNotificationService {
    private static final Logger LOGGER = LoggerFactory.getLogger(LoanNotificationService.class);
    private final JdbcTemplate jdbc;
    private final EmailService emailService;

    public LoanNotificationService(JdbcTemplate jdbc, EmailService emailService) {
        this.jdbc = jdbc;
        this.emailService = emailService;
    }

    @Transactional
    public void sendLoanEvent(long userId, String eventKey, String eventType, long loanId,
            Map<String, String> values) {
        Map<String, Object> user = jdbc.queryForMap("""
                SELECT u.id, u.email, u.full_name,
                       COALESCE(p.notify_application_updates, TRUE) AS notify_application_updates,
                       COALESCE(p.notify_repayment_reminders, TRUE) AS notify_repayment_reminders
                FROM users u LEFT JOIN user_preferences p ON p.user_id = u.id
                WHERE u.id = ?
                """, userId);
        Map<String, Object> template = jdbc.queryForMap("""
                SELECT email_enabled, email_subject, email_body
                FROM notification_templates WHERE event_type = ?
                """, eventType);

        boolean reminder = eventType.equals("payment_reminder") || eventType.equals("overdue_notice");
        boolean preferenceEnabled = Boolean.TRUE.equals(user.get(
                reminder ? "notify_repayment_reminders" : "notify_application_updates"));

        Map<String, String> placeholders = new HashMap<>(values);
        placeholders.put("fullName", String.valueOf(user.get("full_name")));
        placeholders.put("loanId", String.valueOf(loanId));
        String subject = render(String.valueOf(template.get("email_subject")), placeholders);
        String emailBody = render(String.valueOf(template.get("email_body")), placeholders);

        if (preferenceEnabled) deliverInApp(user, eventKey, eventType, emailBody, loanId);
        else return;
        if (Boolean.TRUE.equals(template.get("email_enabled"))) {
            deliverEmail(user, eventKey, eventType, loanId, subject, emailBody);
        }
    }

    private void deliverEmail(Map<String, Object> user, String eventKey, String eventType, long loanId,
            String subject, String body) {
        if (!claimDelivery(eventKey, "email", eventType, user, body)) return;
        boolean sent = emailService.sendLoanNotification(user, eventType, subject, body, loanId);
        finishDelivery(eventKey, "email", sent ? "sent" : "failed",
                sent ? null : "Email delivery failed; see email_log for details", null);
        if (!sent) LOGGER.warn("Email notification delivery failed for event {} and key {}", eventType, eventKey);
    }

    private void deliverInApp(
            Map<String, Object> user, String eventKey, String eventType, String message, long loanId) {
        if (!claimDelivery(eventKey, "in_app", eventType, user, message)) return;
        jdbc.update("""
                INSERT INTO notifications
                  (user_id, channel, trigger_type, message, delivery_status, reference_type, reference_id)
                VALUES (?, 'in_app', ?, ?, 'sent', 'loan', ?)
                """, user.get("id"), eventType, message, loanId);
        finishDelivery(eventKey, "in_app", "sent", null, null);
    }

    private boolean claimDelivery(String eventKey, String channel, String eventType,
            Map<String, Object> user, String message) {
        jdbc.queryForList("SELECT pg_advisory_xact_lock(hashtext(?))", eventKey + ":" + channel);
        Integer sent = jdbc.queryForObject("""
                SELECT COUNT(*) FROM notification_deliveries
                WHERE event_key = ? AND channel = ? AND status = 'sent'
                """, Integer.class, eventKey, channel);
        if (sent != null && sent > 0) return false;
        jdbc.update("""
                INSERT INTO notification_deliveries (event_key, channel, user_id, event_type, message, status)
                VALUES (?, ?, ?, ?, ?, 'queued')
                ON CONFLICT (event_key, channel) DO UPDATE
                SET message = EXCLUDED.message, status = 'queued', error_message = NULL,
                    provider_message_id = NULL, created_at = now()
                """, eventKey, channel, user.get("id"), eventType, message);
        return true;
    }

    private void finishDelivery(String eventKey, String channel, String status, String error, String providerMessageId) {
        jdbc.update("""
                UPDATE notification_deliveries
                SET status = ?, error_message = ?, provider_message_id = ?,
                    sent_at = CASE WHEN ? = 'sent' THEN now() ELSE NULL END
                WHERE event_key = ? AND channel = ?
                """, status, truncate(error, 1000), providerMessageId, status, eventKey, channel);
    }

    private static String render(String template, Map<String, String> values) {
        String result = template;
        for (Map.Entry<String, String> entry : values.entrySet()) {
            result = result.replace("{" + entry.getKey() + "}", entry.getValue());
        }
        return result;
    }

    private static String truncate(String value, int maxLength) {
        if (value == null) return null;
        return value.length() <= maxLength ? value : value.substring(0, maxLength);
    }
}
