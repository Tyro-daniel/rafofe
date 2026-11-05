package bw.co.refofe.lms.controller;

import bw.co.refofe.lms.api.ApiException;
import bw.co.refofe.lms.security.AuthSupport;
import jakarta.servlet.http.HttpServletRequest;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/officer")
public class OfficerController {
    private static final List<String> COMPLAINT_STATUSES =
            List.of("open", "in_progress", "resolved", "escalated_nbfira");
    private final JdbcTemplate jdbc;
    private final AuthSupport authSupport;
    private final PasswordEncoder passwordEncoder;

    public OfficerController(JdbcTemplate jdbc, AuthSupport authSupport, PasswordEncoder passwordEncoder) {
        this.jdbc = jdbc;
        this.authSupport = authSupport;
        this.passwordEncoder = passwordEncoder;
    }

    @GetMapping("/dashboard/summary")
    public Map<String, Object> dashboard(HttpServletRequest request) {
        authSupport.requireRole(request, "loan_officer", "admin");
        Map<String, Object> output = new HashMap<>();
        output.put("pendingApplications", count("SELECT COUNT(*) FROM loan_applications WHERE status IN ('submitted','under_review')"));
        output.put("activeLoans", count("SELECT COUNT(*) FROM loan_accounts WHERE status = 'active'"));
        output.put("delinquentLoans", count("SELECT COUNT(*) FROM loan_accounts WHERE status = 'delinquent'"));
        output.put("outstandingPortfolio", jdbc.queryForObject("""
                SELECT COALESCE(SUM(se.principal_due - se.principal_paid), 0)
                FROM schedule_entries se JOIN loan_accounts la ON la.id = se.loan_account_id
                WHERE la.status IN ('active','delinquent')
                  AND se.status != 'paid'
                """, java.math.BigDecimal.class));
        output.put("totalDisbursed", jdbc.queryForObject(
                "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE txn_type = 'disbursement'", java.math.BigDecimal.class));
        output.put("totalCollected", jdbc.queryForObject(
                "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE txn_type = 'repayment'", java.math.BigDecimal.class));
        return output;
    }

    @GetMapping("/reports/portfolio-at-risk")
    public List<Map<String, Object>> portfolioAtRisk(HttpServletRequest request) {
        authSupport.requireRole(request, "loan_officer", "admin");
        return jdbc.queryForList("""
                SELECT la.id AS loan_account_id, u.full_name AS borrower, u.email, la.principal, la.status,
                       COUNT(se.id) FILTER (WHERE se.status = 'overdue') AS overdue_installments,
                       COALESCE(SUM(se.total_due - se.amount_paid) FILTER (WHERE se.status = 'overdue'), 0) AS overdue_amount
                FROM loan_accounts la JOIN users u ON u.id = la.user_id
                LEFT JOIN schedule_entries se ON se.loan_account_id = la.id
                WHERE la.status IN ('active', 'delinquent')
                GROUP BY la.id, u.full_name, u.email
                HAVING COUNT(se.id) FILTER (WHERE se.status = 'overdue') > 0
                ORDER BY overdue_amount DESC
                """);
    }

    @GetMapping("/reports/aging")
    public List<Map<String, Object>> aging(HttpServletRequest request) {
        authSupport.requireRole(request, "loan_officer", "admin");
        return jdbc.queryForList("""
                SELECT se.id AS schedule_entry_id, la.id AS loan_account_id, u.full_name AS borrower,
                       se.due_date, (se.total_due - se.amount_paid) AS total_due, (CURRENT_DATE - se.due_date) AS days_overdue,
                       CASE WHEN (CURRENT_DATE - se.due_date) <= 30 THEN '0-30'
                            WHEN (CURRENT_DATE - se.due_date) <= 60 THEN '31-60'
                            WHEN (CURRENT_DATE - se.due_date) <= 90 THEN '61-90'
                            ELSE '90+' END AS bucket
                FROM schedule_entries se JOIN loan_accounts la ON la.id = se.loan_account_id
                JOIN users u ON u.id = la.user_id
                WHERE se.status IN ('due', 'overdue', 'partially_paid') AND se.due_date < CURRENT_DATE
                ORDER BY days_overdue DESC
                """);
    }

    @GetMapping("/reports/disbursement-vs-collections")
    public List<Map<String, Object>> disbursementVsCollections(HttpServletRequest request) {
        authSupport.requireRole(request, "loan_officer", "admin");
        return jdbc.queryForList("""
                SELECT date_trunc('month', created_at)::date AS month,
                       SUM(amount) FILTER (WHERE txn_type = 'disbursement') AS disbursed,
                       SUM(amount) FILTER (WHERE txn_type = 'repayment') AS collected
                FROM transactions GROUP BY 1 ORDER BY 1
                """);
    }

    @GetMapping("/complaints")
    public List<Map<String, Object>> complaints(HttpServletRequest request) {
        authSupport.requireRole(request, "loan_officer", "admin");
        return jdbc.queryForList("""
                SELECT c.*, u.full_name AS complainant FROM complaints c
                JOIN users u ON u.id = c.user_id ORDER BY c.created_at DESC
                """);
    }

    @PatchMapping("/complaints/{id}")
    @Transactional
    public Map<String, Object> updateComplaint(
            HttpServletRequest request, @PathVariable long id, @RequestBody Map<String, Object> body) {
        authSupport.requireRole(request, "loan_officer", "admin");
        String status = body.get("status") instanceof String value ? value : null;
        if (status != null && !COMPLAINT_STATUSES.contains(status)) {
            throw ApiException.badRequest("status must be one of: " + String.join(", ", COMPLAINT_STATUSES));
        }
        Object assignedTo = body.get("assignedTo");
        if (assignedTo instanceof String value && value.isBlank()) assignedTo = null;
        try {
            return jdbc.queryForMap("""
                    UPDATE complaints SET status = COALESCE(?, status), assigned_to = COALESCE(?, assigned_to),
                      resolved_at = CASE WHEN ? = 'resolved' THEN now() ELSE resolved_at END
                    WHERE id = ? RETURNING *
                    """, status, assignedTo, status, id);
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.notFound("Complaint not found");
        }
    }

    @GetMapping("/email-log")
    public List<Map<String, Object>> emailLog(
            HttpServletRequest request,
            @RequestParam(required = false) String eventType,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Long userId) {
        authSupport.requireRole(request, "loan_officer", "admin");
        List<String> conditions = new ArrayList<>();
        List<Object> parameters = new ArrayList<>();
        if (eventType != null && !eventType.isBlank()) {
            conditions.add("event_type = ?");
            parameters.add(eventType);
        }
        if (status != null && !status.isBlank()) {
            conditions.add("status = ?");
            parameters.add(status);
        }
        if (userId != null) {
            conditions.add("user_id = ?");
            parameters.add(userId);
        }
        String where = conditions.isEmpty() ? "" : " WHERE " + String.join(" AND ", conditions);
        return jdbc.queryForList("""
                SELECT id, user_id, recipient_email, recipient_name, event_type, subject, related_entity_type,
                       related_entity_id, status, error_message, retry_count, sent_at, created_at
                FROM email_log
                """ + where + " ORDER BY created_at DESC LIMIT 200", parameters.toArray());
    }

    @org.springframework.web.bind.annotation.PostMapping("/users")
    @Transactional
    public Map<String, Object> createStaffUser(
            HttpServletRequest request, @RequestBody Map<String, Object> body) {
        authSupport.requireRole(request, "admin");
        String email = requiredString(body, "email");
        String password = requiredString(body, "password");
        String fullName = requiredString(body, "fullName");
        String role = requiredString(body, "role");
        if (!List.of("loan_officer", "admin").contains(role)) {
            throw ApiException.badRequest("role must be 'loan_officer' or 'admin'");
        }
        if (!email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$") || password.length() < 8) {
            throw ApiException.badRequest("Invalid input");
        }
        if (fullName.length() < 2) throw ApiException.badRequest("fullName must be at least 2 characters");
        return jdbc.queryForMap("""
                INSERT INTO users (email, password_hash, role, full_name, email_verified)
                VALUES (?, ?, ?, ?, TRUE) RETURNING id, email, role, full_name, created_at
                """, email.toLowerCase(java.util.Locale.ROOT), passwordEncoder.encode(password), role, fullName);
    }

    @GetMapping("/users")
    public List<Map<String, Object>> users(HttpServletRequest request) {
        authSupport.requireRole(request, "admin");
        return jdbc.queryForList("""
                SELECT id, email, role, full_name AS "fullName", phone,
                       is_active AS "isActive", email_verified AS "emailVerified", created_at AS "createdAt"
                FROM users
                ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'loan_officer' THEN 2 ELSE 3 END,
                         full_name, id
                """);
    }

    @PatchMapping("/users/{id}")
    @Transactional
    public Map<String, Object> updateUser(
            HttpServletRequest request, @PathVariable long id, @RequestBody Map<String, Object> body) {
        var currentAdmin = authSupport.requireRole(request, "admin");
        lockUserAdministration();
        String fullName = requiredString(body, "fullName");
        String email = requiredString(body, "email").toLowerCase(java.util.Locale.ROOT);
        String role = requiredString(body, "role");
        String phone = body.get("phone") instanceof String value && !value.isBlank()
                ? value.trim()
                : null;
        if (!email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) {
            throw ApiException.badRequest("A valid email address is required");
        }
        if (fullName.length() < 2) throw ApiException.badRequest("fullName must be at least 2 characters");
        if (!List.of("customer", "loan_officer", "admin").contains(role)) {
            throw ApiException.badRequest("role must be 'customer', 'loan_officer' or 'admin'");
        }

        Map<String, Object> existing;
        try {
            existing = jdbc.queryForMap(
                    "SELECT id, role, is_active, email FROM users WHERE id = ? FOR UPDATE", id);
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.notFound("User not found");
        }
        String existingRole = String.valueOf(existing.get("role"));
        boolean emailChanged = !email.equalsIgnoreCase(String.valueOf(existing.get("email")));
        if (currentAdmin.id() == id && !"admin".equals(role)) {
            throw ApiException.conflict("You cannot change your own administrator role");
        }
        if ("admin".equals(existingRole) && !"admin".equals(role)
                && Boolean.TRUE.equals(existing.get("is_active")) && activeAdminCount() <= 1) {
            throw ApiException.conflict("At least one active administrator must remain");
        }
        return jdbc.queryForMap("""
                UPDATE users SET full_name = ?, email = ?, phone = ?, role = ?,
                    email_verified = CASE WHEN ? THEN FALSE ELSE email_verified END,
                    email_verification_token_hash = CASE WHEN ? THEN NULL ELSE email_verification_token_hash END,
                    email_verification_expires_at = CASE WHEN ? THEN NULL ELSE email_verification_expires_at END
                WHERE id = ?
                RETURNING id, email, role, full_name AS "fullName", phone,
                          is_active AS "isActive", email_verified AS "emailVerified", created_at AS "createdAt"
                """, fullName, email, phone, role, emailChanged, emailChanged, emailChanged, id);
    }

    @PatchMapping("/users/{id}/status")
    @Transactional
    public Map<String, Object> setUserStatus(
            HttpServletRequest request, @PathVariable long id, @RequestBody Map<String, Object> body) {
        var currentAdmin = authSupport.requireRole(request, "admin");
        lockUserAdministration();
        if (!(body.get("isActive") instanceof Boolean isActive)) {
            throw ApiException.badRequest("isActive must be true or false");
        }
        Map<String, Object> existing;
        try {
            existing = jdbc.queryForMap(
                    "SELECT id, role, is_active FROM users WHERE id = ? FOR UPDATE", id);
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.notFound("User not found");
        }
        if (currentAdmin.id() == id && !isActive) {
            throw ApiException.conflict("You cannot deactivate your own account");
        }
        if ("admin".equals(existing.get("role")) && Boolean.TRUE.equals(existing.get("is_active"))
                && !isActive && activeAdminCount() <= 1) {
            throw ApiException.conflict("At least one active administrator must remain");
        }
        return jdbc.queryForMap("""
                UPDATE users SET is_active = ?
                WHERE id = ?
                RETURNING id, email, role, full_name AS "fullName", phone,
                          is_active AS "isActive", email_verified AS "emailVerified", created_at AS "createdAt"
                """, isActive, id);
    }

    private long activeAdminCount() {
        Long count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = TRUE", Long.class);
        return count == null ? 0 : count;
    }

    private void lockUserAdministration() {
        jdbc.execute("SELECT pg_advisory_xact_lock(231, 802)");
    }

    private Long count(String sql) {
        return jdbc.queryForObject(sql, Long.class);
    }

    private static String requiredString(Map<String, Object> body, String key) {
        if (!(body.get(key) instanceof String value) || value.isBlank()) {
            throw ApiException.badRequest(key + " is required");
        }
        return value.trim();
    }
}
