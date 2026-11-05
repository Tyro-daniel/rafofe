package bw.co.refofe.lms.service;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.Map;
import java.time.ZoneId;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class LoanReminderScheduler {
    private final JdbcTemplate jdbc;
    private final LoanNotificationService notifications;
    private final ActivityAuditService activityAuditService;
    private final ZoneId zone;

    public LoanReminderScheduler(
            JdbcTemplate jdbc,
            LoanNotificationService notifications,
            ActivityAuditService activityAuditService,
            @Value("${app.loan-reminders.zone:Africa/Gaborone}") String zone) {
        this.jdbc = jdbc;
        this.notifications = notifications;
        this.activityAuditService = activityAuditService;
        this.zone = ZoneId.of(zone);
    }

    @Scheduled(cron = "${app.loan-reminders.cron:0 0 8 * * *}", zone = "${app.loan-reminders.zone:Africa/Gaborone}")
    public void sendRepaymentReminders() {
        LocalDate today = LocalDate.now(zone);
        sendForDate(today.plusDays(7), "payment_reminder", "payment-reminder-7-days");
        sendForDate(today.minusDays(1), "overdue_notice", "overdue-notice-1-day");
    }

    private void sendForDate(LocalDate dueDate, String eventType, String eventKeyPrefix) {
        var entries = jdbc.queryForList("""
                SELECT la.id AS loan_id, la.user_id, u.full_name, se.id AS installment_id,
                       se.due_date, se.total_due - se.amount_paid AS amount_due
                FROM schedule_entries se
                JOIN loan_accounts la ON la.id = se.loan_account_id
                JOIN users u ON u.id = la.user_id
                LEFT JOIN user_preferences p ON p.user_id = u.id
                WHERE (
                        se.due_date = ?
                        OR (? = 'overdue_notice' AND se.due_date <= ?)
                        OR EXISTS (
                            SELECT 1 FROM notification_deliveries nd
                            WHERE nd.event_key = ? || ':installment:' || se.id
                              AND nd.status = 'failed'
                        )
                  )
                  AND se.status != 'paid'
                  AND la.status IN ('active', 'delinquent') AND u.is_active = TRUE
                  AND COALESCE(p.notify_repayment_reminders, TRUE) = TRUE
                ORDER BY la.id, se.installment_no
                """, dueDate, eventType, dueDate, eventKeyPrefix);
        for (Map<String, Object> entry : entries) {
            long loanId = ((Number) entry.get("loan_id")).longValue();
            long userId = ((Number) entry.get("user_id")).longValue();
            long installmentId = ((Number) entry.get("installment_id")).longValue();
            String amount = String.valueOf(entry.get("amount_due"));
            String formattedDate = dueDate.format(DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.ENGLISH));
            String key = eventKeyPrefix + ":installment:" + installmentId;
            notifications.sendLoanEvent(userId, key, eventType, loanId,
                    Map.of("amount", amount, "dueDate", formattedDate, "installmentId", String.valueOf(installmentId)));
            activityAuditService.recordSystemEvent("scheduled_notification_processed", "installment",
                    installmentId, Map.of("eventType", eventType, "loanId", loanId));
        }
    }
}
