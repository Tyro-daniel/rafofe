package bw.co.refofe.lms.controller;

import bw.co.refofe.lms.api.ApiException;
import bw.co.refofe.lms.security.AuthSupport;
import bw.co.refofe.lms.security.AuthenticatedUser;
import bw.co.refofe.lms.service.PhoneNumber;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@RestController
@RequestMapping("/settings")
public class SettingsController {
    private final JdbcTemplate jdbc;
    private final AuthSupport authSupport;
    private final ObjectMapper objectMapper;

    public SettingsController(JdbcTemplate jdbc, AuthSupport authSupport, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.authSupport = authSupport;
        this.objectMapper = objectMapper;
    }

    @GetMapping("/me")
    public Map<String, Object> mySettings(HttpServletRequest request) {
        AuthenticatedUser user = authSupport.requireRole(request, "customer", "loan_officer");
        ensurePreferences(user.id());
        return jdbc.queryForMap("""
                SELECT u.id, u.full_name AS "fullName", u.email, u.phone, u.email_verified AS "emailVerified",
                       p.preferred_contact_method AS "preferredContactMethod", p.language, p.text_size AS "textSize",
                       p.notify_repayment_reminders AS "notifyRepaymentReminders",
                       p.notify_application_updates AS "notifyApplicationUpdates",
                       p.notify_statements AS "notifyStatements",
                       p.notify_new_applications AS "notifyNewApplications",
                       p.notify_overdue_payments AS "notifyOverduePayments",
                       p.notify_assigned_complaints AS "notifyAssignedComplaints",
                       p.notify_kyc_reviews AS "notifyKycReviews",
                       p.default_application_filter AS "defaultApplicationFilter",
                       p.application_sort AS "applicationSort",
                       p.dashboard_layout AS "dashboardLayout"
                FROM users u JOIN user_preferences p ON p.user_id = u.id
                WHERE u.id = ?
                """, user.id());
    }

    @PatchMapping("/me")
    @Transactional
    public Map<String, Object> updateMySettings(
            HttpServletRequest request, @RequestBody Map<String, Object> body) {
        AuthenticatedUser user = authSupport.requireRole(request, "customer", "loan_officer");
        String fullName = requiredString(body, "fullName");
        String email = requiredString(body, "email").toLowerCase(Locale.ROOT);
        String phone = nullableString(body, "phone");
        if ("customer".equals(user.role()) && phone != null) phone = PhoneNumber.toE164(phone);
        String contactMethod = requiredString(body, "preferredContactMethod");
        String language = requiredString(body, "language");
        String textSize = requiredString(body, "textSize");
        String applicationFilter = requiredString(body, "defaultApplicationFilter");
        String applicationSort = requiredString(body, "applicationSort");
        String dashboardLayout = requiredString(body, "dashboardLayout");

        if (fullName.length() < 2) throw ApiException.badRequest("Full name must be at least 2 characters");
        if (!email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) {
            throw ApiException.badRequest("A valid email address is required");
        }
        if (phone != null && phone.length() > 20) throw ApiException.badRequest("Phone number is too long");
        requireChoice(contactMethod, List.of("email"), "preferredContactMethod");
        requireChoice(language, List.of("en", "tn"), "language");
        requireChoice(textSize, List.of("small", "normal", "large"), "textSize");
        requireChoice(applicationFilter, List.of("all", "submitted", "under_review"), "defaultApplicationFilter");
        requireChoice(applicationSort, List.of("newest", "oldest", "amount_high", "amount_low"), "applicationSort");
        requireChoice(dashboardLayout, List.of("comfortable", "compact"), "dashboardLayout");

        String currentEmail = jdbc.queryForObject("SELECT email FROM users WHERE id = ?", String.class, user.id());
        boolean emailChanged = !email.equalsIgnoreCase(currentEmail);
        jdbc.update("""
                UPDATE users SET full_name = ?, email = ?, phone = ?,
                    email_verified = CASE WHEN ? THEN FALSE ELSE email_verified END,
                    email_verification_token_hash = CASE WHEN ? THEN NULL ELSE email_verification_token_hash END,
                    email_verification_expires_at = CASE WHEN ? THEN NULL ELSE email_verification_expires_at END
                WHERE id = ?
                """, fullName, email, phone, emailChanged, emailChanged, emailChanged, user.id());
        ensurePreferences(user.id());
        jdbc.update("""
                UPDATE user_preferences
                SET preferred_contact_method = 'email', language = ?, text_size = ?,
                    notify_repayment_reminders = ?, notify_application_updates = ?, notify_statements = ?,
                    notify_new_applications = ?, notify_overdue_payments = ?, notify_assigned_complaints = ?,
                    notify_kyc_reviews = ?, default_application_filter = ?, application_sort = ?,
                    dashboard_layout = ?, updated_at = now()
                WHERE user_id = ?
                """,
                language, textSize,
                requiredBoolean(body, "notifyRepaymentReminders"),
                requiredBoolean(body, "notifyApplicationUpdates"),
                requiredBoolean(body, "notifyStatements"),
                requiredBoolean(body, "notifyNewApplications"),
                requiredBoolean(body, "notifyOverduePayments"),
                requiredBoolean(body, "notifyAssignedComplaints"),
                requiredBoolean(body, "notifyKycReviews"),
                applicationFilter, applicationSort, dashboardLayout, user.id());
        return mySettings(request);
    }

    @GetMapping("/admin/notifications")
    public List<Map<String, Object>> notificationSettings(HttpServletRequest request) {
        authSupport.requireRole(request, "admin");
        return jdbc.queryForList("""
                SELECT event_type AS "eventType", display_name AS "displayName",
                       email_enabled AS "emailEnabled", sms_enabled AS "smsEnabled",
                       email_subject AS "emailSubject", email_body AS "emailBody", sms_body AS "smsBody",
                       updated_at AS "updatedAt"
                FROM notification_templates ORDER BY display_name
                """);
    }

    @PatchMapping("/admin/notifications/{eventType}")
    @Transactional
    public Map<String, Object> updateNotificationSetting(
            HttpServletRequest request,
            @PathVariable String eventType,
            @RequestBody Map<String, Object> body) {
        AuthenticatedUser admin = authSupport.requireRole(request, "admin");
        Map<String, Object> before;
        try {
            before = jdbc.queryForMap("""
                    SELECT event_type AS "eventType", display_name AS "displayName",
                           email_enabled AS "emailEnabled", sms_enabled AS "smsEnabled",
                           email_subject AS "emailSubject", email_body AS "emailBody", sms_body AS "smsBody"
                    FROM notification_templates WHERE event_type = ? FOR UPDATE
                    """, eventType);
        } catch (EmptyResultDataAccessException error) {
            throw ApiException.notFound("Notification event not found");
        }
        boolean emailEnabled = requiredBoolean(body, "emailEnabled");
        String emailSubject = requiredString(body, "emailSubject");
        String emailBody = requiredString(body, "emailBody");
        if (emailSubject.length() > 255 || emailBody.length() > 5000) {
            throw ApiException.badRequest("Email subject or email body exceeds the allowed length");
        }
        jdbc.update("""
                UPDATE notification_templates
                SET email_enabled = ?, sms_enabled = FALSE, email_subject = ?, email_body = ?,
                    updated_by = ?, updated_at = now()
                WHERE event_type = ?
                """, emailEnabled, emailSubject, emailBody, admin.id(), eventType);
        Map<String, Object> after = jdbc.queryForMap("""
                SELECT event_type AS "eventType", display_name AS "displayName",
                       email_enabled AS "emailEnabled", sms_enabled AS "smsEnabled",
                       email_subject AS "emailSubject", email_body AS "emailBody", sms_body AS "smsBody"
                FROM notification_templates WHERE event_type = ?
                """, eventType);
        jdbc.update("""
                INSERT INTO audit_logs (actor_id, action, entity_type, before_value, after_value, ip_address)
                VALUES (?, 'updated_notification_settings', 'notification_template', CAST(? AS jsonb), CAST(? AS jsonb), ?)
                """, admin.id(), json(before), json(after), clientAddress(request));
        return after;
    }

    @GetMapping("/admin/history")
    public Map<String, Object> settingsHistory(
            HttpServletRequest request,
            @RequestParam(defaultValue = "0") int offset,
            @RequestParam(defaultValue = "100") int limit) {
        authSupport.requireRole(request, "admin");
        if (offset < 0 || limit < 1 || limit > 200) {
            throw ApiException.badRequest("Activity log pagination values are invalid");
        }
        List<Map<String, Object>> entries = jdbc.queryForList("""
                SELECT a.id, a.action, a.entity_type AS "entityType",
                       a.before_value::text AS "beforeValue", a.after_value::text AS "afterValue",
                       a.entity_id AS "entityId", a.ip_address AS "ipAddress",
                       a.created_at AS "createdAt", COALESCE(u.full_name, 'System') AS "actorName",
                       u.email AS "actorEmail"
                FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
                ORDER BY a.created_at DESC, a.id DESC
                LIMIT ? OFFSET ?
                """, limit, offset);
        Integer total = jdbc.queryForObject("SELECT COUNT(*) FROM audit_logs", Integer.class);
        return Map.of("entries", entries, "total", total == null ? 0 : total);
    }

    @GetMapping(value = "/admin/history.csv", produces = "text/csv")
    public ResponseEntity<StreamingResponseBody> downloadActivityHistory(HttpServletRequest request) {
        authSupport.requireRole(request, "admin");
        StreamingResponseBody stream = output -> {
            BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(output, StandardCharsets.UTF_8));
            writer.write('\uFEFF');
            writer.write("\"Timestamp\",\"Actor\",\"Email\",\"Action\",\"Entity\",\"Entity ID\",\"IP address\",\"Before\",\"After\"\r\n");
            jdbc.query("""
                    SELECT a.created_at, COALESCE(u.full_name, 'System'), u.email, a.action, a.entity_type,
                           a.entity_id, a.ip_address, a.before_value::text, a.after_value::text
                    FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
                    ORDER BY a.created_at DESC, a.id DESC
                    """, result -> {
                try {
                    writer.write(csv(result.getTimestamp(1)));
                    writer.write(',');
                    writer.write(csv(result.getString(2)));
                    writer.write(',');
                    writer.write(csv(result.getString(3)));
                    writer.write(',');
                    writer.write(csv(result.getString(4)));
                    writer.write(',');
                    writer.write(csv(result.getString(5)));
                    writer.write(',');
                    writer.write(csv(result.getObject(6)));
                    writer.write(',');
                    writer.write(csv(result.getString(7)));
                    writer.write(',');
                    writer.write(csv(result.getString(8)));
                    writer.write(',');
                    writer.write(csv(result.getString(9)));
                    writer.write("\r\n");
                } catch (IOException error) {
                    throw new UncheckedIOException(error);
                }
            });
            writer.flush();
        };
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"activity-log.csv\"")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(stream);
    }

    private static String csv(Object value) {
        String text = value == null ? "" : value.toString();
        if (!text.isEmpty() && "=+-@\t\r".indexOf(text.charAt(0)) >= 0) text = "'" + text;
        return "\"" + text.replace("\"", "\"\"") + "\"";
    }

    private void ensurePreferences(long userId) {
        jdbc.update("INSERT INTO user_preferences (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING", userId);
    }

    private String json(Map<String, Object> value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Unable to serialize settings audit record", error);
        }
    }

    private static String clientAddress(HttpServletRequest request) {
        return request.getRemoteAddr();
    }

    private static String requiredString(Map<String, Object> body, String key) {
        if (!(body.get(key) instanceof String value) || value.isBlank()) {
            throw ApiException.badRequest(key + " is required");
        }
        return value.trim();
    }

    private static String nullableString(Map<String, Object> body, String key) {
        Object value = body.get(key);
        if (value == null) return null;
        if (!(value instanceof String text)) throw ApiException.badRequest(key + " must be text");
        String trimmed = text.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static boolean requiredBoolean(Map<String, Object> body, String key) {
        if (!(body.get(key) instanceof Boolean value)) throw ApiException.badRequest(key + " must be true or false");
        return value;
    }

    private static void requireChoice(String value, List<String> choices, String field) {
        if (!choices.contains(value)) throw ApiException.badRequest(field + " has an invalid value");
    }
}
