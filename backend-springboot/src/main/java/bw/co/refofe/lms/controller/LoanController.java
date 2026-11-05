package bw.co.refofe.lms.controller;

import bw.co.refofe.lms.api.ApiException;
import bw.co.refofe.lms.security.AuthSupport;
import bw.co.refofe.lms.security.AuthenticatedUser;
import bw.co.refofe.lms.service.LoanSchedule;
import bw.co.refofe.lms.service.LoanNotificationService;
import jakarta.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/loans")
public class LoanController {
    private static final Map<String, String> DECLINE_REASONS = Map.of(
            "insufficient_income", "Insufficient income",
            "incomplete_documents", "Incomplete documents",
            "failed_kyc", "Failed KYC/identity check",
            "existing_delinquency", "Existing delinquency on record",
            "amount_exceeds_policy", "Amount exceeds policy limit",
            "other", "Other");
    private final JdbcTemplate jdbc;
    private final AuthSupport authSupport;
    private final LoanNotificationService loanNotifications;

    public LoanController(JdbcTemplate jdbc, AuthSupport authSupport, LoanNotificationService loanNotifications) {
        this.jdbc = jdbc;
        this.authSupport = authSupport;
        this.loanNotifications = loanNotifications;
    }

    @GetMapping("/products/public")
    public List<Map<String, Object>> publicProducts() {
        return jdbc.queryForList("""
                SELECT id, name, monthly_rate_pct, min_amount, max_amount, min_tenure_months, max_tenure_months
                FROM loan_products WHERE is_active = TRUE ORDER BY id
                """);
    }

    @GetMapping("/products")
    public List<Map<String, Object>> products(HttpServletRequest request) {
        authSupport.requireUser(request);
        return publicProducts();
    }

    @PostMapping("/applications")
    @Transactional
    public Map<String, Object> createApplication(
            HttpServletRequest request, @RequestBody Map<String, Object> body) {
        AuthenticatedUser user = authSupport.requireRole(request, "customer");
        long kycCaseId = positiveLong(body.get("kycCaseId"), "kycCaseId");
        long productId = positiveLong(body.get("loanProductId"), "loanProductId");
        BigDecimal amount = positiveAmount(body.get("amountRequested"));
        String purpose = text(body.get("purpose"), "purpose");
        int tenure = Math.toIntExact(positiveLong(body.get("tenureMonths"), "tenureMonths"));
        if (purpose.length() < 3 || purpose.length() > 255) throw ApiException.badRequest("purpose must be 3–255 characters");

        Map<String, Object> requester = jdbc.queryForMap(
                "SELECT email_verified, marital_status, phone FROM users WHERE id = ?", user.id());
        if (!Boolean.TRUE.equals(requester.get("email_verified"))) {
            throw ApiException.forbidden("Please verify your email address before applying for a loan. Check your inbox for a verification link, or request a new one.");
        }
        Map<String, Object> kycCase;
        try {
            kycCase = jdbc.queryForMap("""
                    SELECT * FROM kyc_cases
                    WHERE id = ? AND user_id = ? AND status = 'approved'
                    """, kycCaseId, user.id());
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.conflict("KYC must be approved before submitting a loan application");
        }
        if (jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM loan_applications WHERE kyc_case_id = ?)",
                Boolean.class, kycCaseId)) {
            throw ApiException.conflict("This approved KYC has already been used for a loan application");
        }
        List<String> requiredDocumentTypes = new java.util.ArrayList<>(
                List.of("national_id", "proof_of_address", "payslip", "bank_statement"));
        boolean spousalConsent = Boolean.TRUE.equals(kycCase.get("spousal_consent_required"));
        if (spousalConsent) requiredDocumentTypes.add("spousal_consent");
        List<Map<String, Object>> latestDocuments = jdbc.queryForList("""
                SELECT DISTINCT ON (doc_type) doc_type, status
                FROM documents WHERE kyc_case_id = ?
                ORDER BY doc_type, uploaded_at DESC, id DESC
                """, kycCaseId);
        Map<String, String> documentStates = new HashMap<>();
        for (Map<String, Object> document : latestDocuments) {
            documentStates.put(String.valueOf(document.get("doc_type")), String.valueOf(document.get("status")));
        }
        List<String> unverifiedDocuments = requiredDocumentTypes.stream()
                .filter(type -> !"verified".equals(documentStates.get(type))).toList();
        if (!unverifiedDocuments.isEmpty()) {
            throw ApiException.conflict("KYC documents must all be verified: " + String.join(", ", unverifiedDocuments));
        }
        Map<String, Object> product = product(productId);
        BigDecimal minAmount = decimal(product.get("min_amount"));
        BigDecimal maxAmount = decimal(product.get("max_amount"));
        if (amount.compareTo(minAmount) < 0 || amount.compareTo(maxAmount) > 0) {
            throw ApiException.badRequest("Amount must be between " + minAmount + " and " + maxAmount + " for this product");
        }
        int minTenure = ((Number) product.get("min_tenure_months")).intValue();
        int maxTenure = ((Number) product.get("max_tenure_months")).intValue();
        if (tenure < minTenure || tenure > maxTenure) {
            throw ApiException.badRequest("Tenure must be between " + minTenure + " and " + maxTenure + " months for this product");
        }
        Map<String, Object> application = jdbc.queryForMap(
                """
                INSERT INTO loan_applications
                  (user_id, kyc_case_id, loan_product_id, amount_requested, purpose, tenure_months,
                   spousal_consent_required, spousal_consent_provided)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
                """, user.id(), kycCaseId, productId, amount, purpose, tenure, spousalConsent, spousalConsent);
        jdbc.update("""
                INSERT INTO notifications
                  (user_id, channel, trigger_type, message, reference_type, reference_id)
                VALUES (?, 'in_app', 'application_submitted',
                        'Your loan application has been submitted and is pending review.',
                        'application', ?)
                """, user.id(), application.get("id"));
        return application;
    }

    @GetMapping("/applications/mine")
    public List<Map<String, Object>> myApplications(HttpServletRequest request) {
        AuthenticatedUser user = authSupport.requireRole(request, "customer");
        return jdbc.queryForList("""
                SELECT a.*, p.name AS product_name, p.monthly_rate_pct
                FROM loan_applications a JOIN loan_products p ON p.id = a.loan_product_id
                WHERE a.user_id = ? ORDER BY a.created_at DESC
                """, user.id());
    }

    @GetMapping("/applications/mine/{id}")
    public Map<String, Object> myApplication(HttpServletRequest request, @PathVariable long id) {
        AuthenticatedUser user = authSupport.requireRole(request, "customer");
        try {
            return jdbc.queryForMap("""
                    SELECT a.*, p.name AS product_name, p.monthly_rate_pct,
                           la.id AS loan_account_id
                    FROM loan_applications a
                    JOIN loan_products p ON p.id = a.loan_product_id
                    LEFT JOIN loan_accounts la ON la.application_id = a.id
                    WHERE a.id = ? AND a.user_id = ?
                    """, id, user.id());
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.notFound("Application not found");
        }
    }

    @GetMapping("/applications")
    public List<Map<String, Object>> staffApplications(
            HttpServletRequest request, @RequestParam(required = false) String status) {
        authSupport.requireRole(request, "loan_officer", "admin");
        if (status == null || status.isBlank()) {
            return jdbc.queryForList("""
                    SELECT a.*, u.full_name AS applicant_name, u.email AS applicant_email, p.name AS product_name
                    FROM loan_applications a JOIN users u ON u.id = a.user_id
                    JOIN loan_products p ON p.id = a.loan_product_id ORDER BY a.created_at DESC
                    """);
        }
        return jdbc.queryForList("""
                SELECT a.*, u.full_name AS applicant_name, u.email AS applicant_email, p.name AS product_name
                FROM loan_applications a JOIN users u ON u.id = a.user_id
                JOIN loan_products p ON p.id = a.loan_product_id WHERE a.status = ? ORDER BY a.created_at DESC
                """, status);
    }

    @GetMapping("/applications/{id}")
    public Map<String, Object> applicationDetail(HttpServletRequest request, @PathVariable long id) {
        authSupport.requireRole(request, "loan_officer", "admin");
        Map<String, Object> application;
        try {
            application = jdbc.queryForMap("""
                    SELECT a.*, u.full_name AS applicant_name, u.email AS applicant_email, u.phone, u.marital_status,
                           p.name AS product_name, p.monthly_rate_pct, p.penalty_rate_pct
                    FROM loan_applications a JOIN users u ON u.id = a.user_id
                    JOIN loan_products p ON p.id = a.loan_product_id WHERE a.id = ?
                    """, id);
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.notFound("Application not found");
        }
        Object kycCaseId = application.get("kyc_case_id");
        application.put("documents", kycCaseId == null
                ? jdbc.queryForList("""
                    SELECT id, doc_type, status, original_name, uploaded_at FROM documents
                    WHERE user_id = ? AND kyc_case_id IS NULL ORDER BY uploaded_at DESC
                    """, application.get("user_id"))
                : jdbc.queryForList("""
                    SELECT id, kyc_case_id, doc_type, status, original_name, uploaded_at FROM documents
                    WHERE kyc_case_id = ? ORDER BY uploaded_at DESC
                    """, kycCaseId));
        return application;
    }

    @PatchMapping("/applications/{id}/decision")
    @Transactional
    public Map<String, Object> decideApplication(
            HttpServletRequest request, @PathVariable long id, @RequestBody Map<String, Object> body) {
        AuthenticatedUser reviewer = authSupport.requireRole(request, "loan_officer", "admin");
        String decision = text(body.get("decision"), "decision");
        if (!List.of("approved", "declined").contains(decision)) {
            throw ApiException.badRequest("decision must be 'approved' or 'declined'");
        }
        String reasonCode = nullableText(body.get("declineReasonCode"));
        if (decision.equals("declined") && !DECLINE_REASONS.containsKey(reasonCode)) {
            throw ApiException.badRequest("declineReasonCode must be one of: " + String.join(", ", DECLINE_REASONS.keySet()));
        }

        Map<String, Object> application;
        try {
            application = jdbc.queryForMap("""
                    SELECT a.*, u.full_name AS applicant_name, u.email AS applicant_email,
                           p.monthly_rate_pct, p.penalty_rate_pct
                    FROM loan_applications a JOIN users u ON u.id = a.user_id
                    JOIN loan_products p ON p.id = a.loan_product_id
                    WHERE a.id = ? FOR UPDATE
                    """, id);
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.notFound("Application not found");
        }
        String status = String.valueOf(application.get("status"));
        if (!List.of("submitted", "under_review").contains(status)) {
            throw ApiException.conflict("Application is already '" + status + "' and cannot be re-decided");
        }
        Object applicationKycCaseId = application.get("kyc_case_id");
        if (decision.equals("approved") && applicationKycCaseId != null) {
            String kycStatus = jdbc.queryForObject(
                    "SELECT status FROM kyc_cases WHERE id = ?", String.class, applicationKycCaseId);
            if (!"approved".equals(kycStatus)) {
                throw ApiException.conflict("KYC must remain approved before a loan can be approved");
            }
            List<String> requiredTypes = new java.util.ArrayList<>(
                    List.of("national_id", "proof_of_address", "payslip", "bank_statement"));
            if (Boolean.TRUE.equals(application.get("spousal_consent_required"))) {
                requiredTypes.add("spousal_consent");
            }
            List<Map<String, Object>> latestKycDocuments = jdbc.queryForList("""
                    SELECT DISTINCT ON (doc_type) doc_type, status
                    FROM documents WHERE kyc_case_id = ?
                    ORDER BY doc_type, uploaded_at DESC, id DESC
                    """, applicationKycCaseId);
            Map<String, String> kycDocumentStates = new HashMap<>();
            for (Map<String, Object> document : latestKycDocuments) {
                kycDocumentStates.put(String.valueOf(document.get("doc_type")),
                        String.valueOf(document.get("status")));
            }
            List<String> unverified = requiredTypes.stream()
                    .filter(type -> !"verified".equals(kycDocumentStates.get(type))).toList();
            if (!unverified.isEmpty()) {
                throw ApiException.conflict("KYC documents are no longer all verified: "
                        + String.join(", ", unverified));
            }
        }
        if (decision.equals("approved") && Boolean.TRUE.equals(application.get("spousal_consent_required"))
                && !Boolean.TRUE.equals(application.get("spousal_consent_provided"))) {
            throw new ApiException(org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY,
                    "Spousal consent is required for this applicant before approval (Botswana Microlending Regulations)");
        }

        if (decision.equals("declined")) {
            Map<String, Object> updated = jdbc.queryForMap("""
                    UPDATE loan_applications
                    SET status = 'declined', decline_reason_code = ?, reviewed_by = ?, reviewed_at = now()
                    WHERE id = ? RETURNING *
                    """, reasonCode, reviewer.id(), id);
            jdbc.update("""
                    INSERT INTO notifications
                      (user_id, channel, trigger_type, message, reference_type, reference_id)
                    VALUES (?, 'in_app', 'application_declined', ?, 'application', ?)
                    """, application.get("user_id"), "Your loan application was declined: " + reasonCode, id);
            return Map.of("application", updated);
        }

        LocalDate startDate = parseStartDate(body.get("startDate"));
        BigDecimal principal = decimal(application.get("amount_requested"));
        BigDecimal rate = decimal(application.get("monthly_rate_pct"));
        int tenure = ((Number) application.get("tenure_months")).intValue();
        BigDecimal penaltyRate = decimal(application.get("penalty_rate_pct"));
        Map<String, Object> account = jdbc.queryForMap("""
                INSERT INTO loan_accounts (application_id, user_id, principal, monthly_rate_pct, tenure_months, penalty_rate_pct, start_date)
                VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *
                """, id, application.get("user_id"), principal, rate, tenure, penaltyRate, startDate);
        long accountId = ((Number) account.get("id")).longValue();
        List<Map<String, Object>> schedule = LoanSchedule.build(principal, rate, tenure, startDate);
        for (Map<String, Object> row : schedule) {
            jdbc.update("""
                    INSERT INTO schedule_entries
                      (loan_account_id, installment_no, due_date, opening_balance, principal_due, interest_due, total_due, closing_balance)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, accountId, row.get("installment_no"), row.get("due_date"), row.get("opening_balance"),
                    row.get("principal_due"), row.get("interest_due"), row.get("total_due"), row.get("closing_balance"));
        }
        Long transactionId = jdbc.queryForObject("""
                INSERT INTO transactions (loan_account_id, txn_type, amount, recorded_by, notes)
                VALUES (?, 'disbursement', ?, ?, 'Loan disbursed on approval') RETURNING id
                """, Long.class, accountId, principal, reviewer.id());
        addLedgerEntries(accountId, transactionId, List.of(
                new LedgerEntry("loan_receivable", "debit", principal),
                new LedgerEntry("cash", "credit", principal)));
        Map<String, Object> updatedApplication = jdbc.queryForMap("""
                UPDATE loan_applications SET status = 'approved', reviewed_by = ?, reviewed_at = now()
                WHERE id = ? RETURNING *
                """, reviewer.id(), id);
        loanNotifications.sendLoanEvent(((Number) application.get("user_id")).longValue(),
                "loan-approved:" + accountId, "loan_approved", accountId,
                Map.of("applicationId", String.valueOf(id), "amount", principal.toPlainString()));
        Map<String, Object> output = new HashMap<>();
        output.put("application", updatedApplication);
        output.put("loanAccount", account);
        output.put("schedule", schedule);
        return output;
    }

    @PostMapping("/applications/{id}/agreement/sign")
    @Transactional
    public Map<String, Object> signAgreement(HttpServletRequest request, @PathVariable long id) {
        AuthenticatedUser customer = authSupport.requireRole(request, "customer");
        Map<String, Object> application;
        try {
            application = jdbc.queryForMap("SELECT * FROM loan_applications WHERE id = ? AND user_id = ?", id, customer.id());
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.notFound("Application not found");
        }
        if (!"approved".equals(application.get("status"))) throw ApiException.conflict("Only approved applications can be signed");
        if (Boolean.TRUE.equals(application.get("spousal_consent_required"))
                && !Boolean.TRUE.equals(application.get("spousal_consent_provided"))) {
            throw new ApiException(org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY,
                    "Spousal consent document must be uploaded and verified before signing");
        }
        return jdbc.queryForMap("""
                UPDATE loan_applications SET agreement_signed = TRUE, agreement_signed_at = now()
                WHERE id = ? RETURNING *
                """, id);
    }

    @GetMapping("/accounts/mine")
    public List<Map<String, Object>> myAccounts(HttpServletRequest request) {
        AuthenticatedUser user = authSupport.requireRole(request, "customer");
        return jdbc.queryForList("""
                SELECT la.*,
                       (SELECT COUNT(*) FROM schedule_entries se WHERE se.loan_account_id = la.id AND se.status = 'overdue') AS overdue_count
                FROM loan_accounts la WHERE la.user_id = ? ORDER BY la.created_at DESC
                """, user.id());
    }

    @GetMapping("/accounts/{id}")
    public Map<String, Object> loanAccount(HttpServletRequest request, @PathVariable long id) {
        return accountFor(request, id);
    }

    @GetMapping("/accounts/{id}/schedule")
    public List<Map<String, Object>> schedule(HttpServletRequest request, @PathVariable long id) {
        accountFor(request, id);
        return jdbc.queryForList("SELECT * FROM schedule_entries WHERE loan_account_id = ? ORDER BY installment_no", id);
    }

    @GetMapping("/accounts/{id}/statement")
    public Map<String, Object> statement(HttpServletRequest request, @PathVariable long id) {
        Map<String, Object> account = accountFor(request, id);
        List<Map<String, Object>> schedule = jdbc.queryForList(
                "SELECT * FROM schedule_entries WHERE loan_account_id = ? ORDER BY installment_no", id);
        List<Map<String, Object>> transactions = jdbc.queryForList(
                "SELECT * FROM transactions WHERE loan_account_id = ? ORDER BY created_at", id);
        List<Map<String, Object>> ledgerEntries = jdbc.queryForList(
                "SELECT * FROM ledger_entries WHERE loan_account_id = ? ORDER BY created_at", id);
        BigDecimal paid = transactions.stream()
                .filter(row -> "repayment".equals(row.get("txn_type")))
                .map(row -> decimal(row.get("amount"))).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal outstandingPrincipal = schedule.stream()
                .filter(row -> !"paid".equals(row.get("status")))
                .map(row -> decimal(row.get("principal_due")).subtract(decimal(row.get("principal_paid"))))
                .reduce(BigDecimal.ZERO, BigDecimal::add).setScale(2, RoundingMode.HALF_UP);
        return Map.of("account", account, "schedule", schedule, "transactions", transactions,
                "ledgerEntries", ledgerEntries,
                "summary", Map.of("totalPaid", paid.setScale(2, RoundingMode.HALF_UP), "outstandingPrincipal", outstandingPrincipal));
    }

    private Map<String, Object> accountFor(HttpServletRequest request, long id) {
        AuthenticatedUser requester = authSupport.requireUser(request);
        Map<String, Object> account;
        try {
            account = jdbc.queryForMap("SELECT * FROM loan_accounts WHERE id = ?", id);
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.notFound("Loan account not found");
        }
        if ("customer".equals(requester.role())
                && ((Number) account.get("user_id")).longValue() != requester.id()) {
            throw ApiException.forbidden("Not your loan account");
        }
        return account;
    }

    private Map<String, Object> product(long id) {
        try {
            return jdbc.queryForMap("SELECT * FROM loan_products WHERE id = ? AND is_active = TRUE", id);
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.notFound("Loan product not found or inactive");
        }
    }

    private void addLedgerEntries(long accountId, Long transactionId, List<LedgerEntry> entries) {
        for (LedgerEntry entry : entries) {
            jdbc.update("""
                    INSERT INTO ledger_entries (loan_account_id, transaction_id, account_name, entry_type, amount)
                    VALUES (?, ?, ?, ?, ?)
                    """, accountId, transactionId, entry.accountName(), entry.entryType(), entry.amount());
        }
    }

    private static LocalDate parseStartDate(Object value) {
        if (value == null || String.valueOf(value).isBlank()) return LocalDate.now();
        try {
            return LocalDate.parse(String.valueOf(value));
        } catch (java.time.DateTimeException error) {
            throw ApiException.badRequest("startDate must be a valid ISO date");
        }
    }

    private static long positiveLong(Object value, String field) {
        try {
            long result = value instanceof Number number ? number.longValue() : Long.parseLong(String.valueOf(value));
            if (result > 0 && (!(value instanceof Number number) || number.doubleValue() == result)) return result;
        } catch (NumberFormatException ignored) {
            throw ApiException.badRequest(field + " must be a positive integer");
        }
        throw ApiException.badRequest(field + " must be a positive integer");
    }

    private static BigDecimal positiveAmount(Object value) {
        try {
            BigDecimal amount = new BigDecimal(String.valueOf(value));
            if (amount.signum() > 0) return amount.setScale(2, RoundingMode.HALF_UP);
        } catch (NumberFormatException ignored) {
            throw ApiException.badRequest("amountRequested must be greater than zero");
        }
        throw ApiException.badRequest("amountRequested must be greater than zero");
    }

    private static String text(Object value, String field) {
        if (!(value instanceof String string) || string.isBlank()) throw ApiException.badRequest(field + " is required");
        return string.trim();
    }

    private static String nullableText(Object value) {
        return value instanceof String string && !string.isBlank() ? string.trim() : null;
    }

    private static BigDecimal decimal(Object value) {
        return value instanceof BigDecimal amount ? amount : new BigDecimal(String.valueOf(value));
    }

    private record LedgerEntry(String accountName, String entryType, BigDecimal amount) {
    }
}
