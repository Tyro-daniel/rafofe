package bw.co.refofe.lms.controller;

import bw.co.refofe.lms.api.ApiException;
import bw.co.refofe.lms.security.AuthSupport;
import bw.co.refofe.lms.security.AuthenticatedUser;
import bw.co.refofe.lms.service.LoanNotificationService;
import jakarta.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/loans/accounts")
public class ServicingController {
    private final JdbcTemplate jdbc;
    private final AuthSupport authSupport;
    private final LoanNotificationService loanNotifications;

    public ServicingController(
            JdbcTemplate jdbc, AuthSupport authSupport, LoanNotificationService loanNotifications) {
        this.jdbc = jdbc;
        this.authSupport = authSupport;
        this.loanNotifications = loanNotifications;
    }

    @PostMapping("/{id}/repayments")
    @Transactional
    public Map<String, Object> recordRepayment(
            HttpServletRequest request, @PathVariable long id, @RequestBody Map<String, Object> body) {
        AuthenticatedUser officer = authSupport.requireRole(request, "loan_officer", "admin");
        BigDecimal amount = positiveAmount(body.get("amount"), "amount");
        Map<String, Object> account = lockedAccount(id);
        if ("closed".equals(account.get("status"))) throw ApiException.conflict("Loan is already closed");
        if ("written_off".equals(account.get("status"))) throw ApiException.conflict("Loan has been written off");

        List<Map<String, Object>> schedule = jdbc.queryForList("""
                SELECT * FROM schedule_entries
                WHERE loan_account_id = ? AND status IN ('upcoming','due','partially_paid','overdue')
                ORDER BY installment_no FOR UPDATE
                """, id);
        BigDecimal remaining = amount;
        BigDecimal principalApplied = BigDecimal.ZERO.setScale(2);
        BigDecimal interestApplied = BigDecimal.ZERO.setScale(2);
        List<Map<String, Object>> installments = new ArrayList<>();

        for (Map<String, Object> entry : schedule) {
            if (remaining.signum() <= 0) break;
            BigDecimal totalDue = decimal(entry.get("total_due"));
            BigDecimal alreadyPaid = decimal(entry.get("amount_paid"));
            BigDecimal outstanding = money(totalDue.subtract(alreadyPaid));
            if (outstanding.signum() <= 0) continue;
            BigDecimal payment = money(remaining.min(outstanding));
            BigDecimal principalLeft = money(decimal(entry.get("principal_due")).subtract(decimal(entry.get("principal_paid"))));
            BigDecimal interestLeft = money(decimal(entry.get("interest_due")).subtract(decimal(entry.get("interest_paid"))));
            BigDecimal principalPart;
            BigDecimal interestPart;
            if (payment.compareTo(outstanding) >= 0) {
                principalPart = principalLeft;
                interestPart = interestLeft;
            } else {
                principalPart = money(payment.multiply(principalLeft).divide(outstanding, 12, RoundingMode.HALF_UP));
                principalPart = principalPart.min(principalLeft);
                interestPart = money(payment.subtract(principalPart).min(interestLeft));
                if (principalPart.add(interestPart).compareTo(payment) < 0) {
                    principalPart = money(payment.subtract(interestPart).min(principalLeft));
                }
            }
            BigDecimal totalPaid = money(alreadyPaid.add(payment));
            String status = totalPaid.compareTo(totalDue.subtract(new BigDecimal("0.01"))) >= 0
                    ? "paid" : "partially_paid";
            jdbc.update("""
                    UPDATE schedule_entries
                    SET amount_paid = ?, principal_paid = ?, interest_paid = ?, status = ?
                    WHERE id = ?
                    """, totalPaid, money(decimal(entry.get("principal_paid")).add(principalPart)),
                    money(decimal(entry.get("interest_paid")).add(interestPart)), status, entry.get("id"));
            principalApplied = money(principalApplied.add(principalPart));
            interestApplied = money(interestApplied.add(interestPart));
            remaining = money(remaining.subtract(payment));
            installments.add(Map.of("id", entry.get("id"), "status", status, "paidAmount", totalPaid));
        }

        Long transactionId = jdbc.queryForObject("""
                INSERT INTO transactions
                  (loan_account_id, txn_type, amount, principal_portion, interest_portion, recorded_by, notes)
                VALUES (?, 'repayment', ?, ?, ?, ?, 'Repayment recorded by officer') RETURNING id
                """, Long.class, id, amount, principalApplied, interestApplied, officer.id());
        List<LedgerLine> ledger = new ArrayList<>();
        ledger.add(new LedgerLine("cash", "debit", amount));
        if (principalApplied.signum() > 0) ledger.add(new LedgerLine("loan_receivable", "credit", principalApplied));
        if (interestApplied.signum() > 0) ledger.add(new LedgerLine("interest_income", "credit", interestApplied));
        if (remaining.signum() > 0) ledger.add(new LedgerLine("unallocated_customer_funds", "credit", remaining));
        writeLedger(id, transactionId, ledger);

        Integer unpaid = jdbc.queryForObject(
                "SELECT COUNT(*) FROM schedule_entries WHERE loan_account_id = ? AND status != 'paid'",
                Integer.class, id);
        if (unpaid != null && unpaid == 0) {
            jdbc.update("UPDATE loan_accounts SET status = 'closed' WHERE id = ?", id);
            loanNotifications.sendLoanEvent(((Number) account.get("user_id")).longValue(),
                    "loan-fully-settled:" + id, "loan_fully_settled", id, Map.of());
        }
        jdbc.update("""
                INSERT INTO notifications
                  (user_id, channel, trigger_type, message, reference_type, reference_id)
                VALUES (?, 'in_app', 'payment_received', ?, 'loan', ?)
                """, account.get("user_id"), "We received your payment of " + amount + ". Thank you.", id);
        Map<String, Object> result = new HashMap<>();
        result.put("transactionId", transactionId);
        result.put("principalApplied", principalApplied);
        result.put("interestApplied", interestApplied);
        result.put("unallocatedOverpayment", remaining);
        result.put("installments", installments);
        return result;
    }

    @PostMapping("/{id}/penalties")
    @Transactional
    public Map<String, Object> chargePenalty(
            HttpServletRequest request, @PathVariable long id, @RequestBody Map<String, Object> body) {
        AuthenticatedUser officer = authSupport.requireRole(request, "loan_officer", "admin");
        BigDecimal monthsLate = positiveAmount(body.get("monthsLate"), "monthsLate");
        Map<String, Object> account = lockedAccount(id);
        BigDecimal principalOutstanding = jdbc.queryForObject("""
                SELECT COALESCE(SUM(principal_due - principal_paid), 0)
                FROM schedule_entries WHERE loan_account_id = ? AND status != 'paid'
                """, BigDecimal.class, id);
        BigDecimal priorPenalties = jdbc.queryForObject("""
                SELECT COALESCE(SUM(amount), 0) FROM transactions
                WHERE loan_account_id = ? AND txn_type = 'penalty'
                """, BigDecimal.class, id);
        BigDecimal rate = decimal(account.get("penalty_rate_pct")).min(new BigDecimal("5.00"));
        BigDecimal computed = money(principalOutstanding.multiply(rate)
                .multiply(monthsLate).divide(new BigDecimal("100"), 12, RoundingMode.HALF_UP));
        BigDecimal headroom = money(principalOutstanding.subtract(priorPenalties)).max(BigDecimal.ZERO);
        BigDecimal penalty = computed.min(headroom);
        if (penalty.signum() <= 0) {
            return Map.of("penaltyAmount", BigDecimal.ZERO.setScale(2),
                    "note", "Regulatory cap already reached — no further penalty can be charged on this loan");
        }
        Long transactionId = jdbc.queryForObject("""
                INSERT INTO transactions (loan_account_id, txn_type, amount, recorded_by, notes)
                VALUES (?, 'penalty', ?, ?, ?) RETURNING id
                """, Long.class, id, penalty, officer.id(), "Late penalty for " + monthsLate + " month(s) overdue");
        writeLedger(id, transactionId, List.of(
                new LedgerLine("loan_receivable", "debit", penalty),
                new LedgerLine("penalty_income", "credit", penalty)));
        jdbc.update("UPDATE loan_accounts SET status = 'delinquent' WHERE id = ? AND status = 'active'", id);
        return Map.of("penaltyAmount", penalty, "transactionId", transactionId);
    }

    @PostMapping("/{id}/write-off")
    @Transactional
    public Map<String, Object> writeOff(
            HttpServletRequest request, @PathVariable long id, @RequestBody Map<String, Object> body) {
        AuthenticatedUser admin = authSupport.requireRole(request, "admin");
        String reason = body.get("reason") instanceof String value ? value.trim() : "";
        if (reason.isEmpty()) throw ApiException.badRequest("reason is required for a write-off");
        if (reason.length() > 500) throw ApiException.badRequest("reason must be 500 characters or less");
        Map<String, Object> account = lockedAccount(id);
        String status = String.valueOf(account.get("status"));
        if (List.of("closed", "written_off").contains(status)) {
            throw ApiException.conflict("Loan is already '" + status + "'");
        }
        BigDecimal outstanding = jdbc.queryForObject("""
                SELECT COALESCE(SUM(principal_due - principal_paid), 0)
                FROM schedule_entries WHERE loan_account_id = ? AND status != 'paid'
                """, BigDecimal.class, id);
        if (outstanding == null || outstanding.signum() <= 0) throw ApiException.conflict("No outstanding balance to write off");
        Long transactionId = jdbc.queryForObject("""
                INSERT INTO transactions (loan_account_id, txn_type, amount, recorded_by, notes)
                VALUES (?, 'write_off', ?, ?, ?) RETURNING id
                """, Long.class, id, outstanding, admin.id(), reason);
        writeLedger(id, transactionId, List.of(
                new LedgerLine("bad_debt_expense", "debit", outstanding),
                new LedgerLine("loan_receivable", "credit", outstanding)));
        jdbc.update("UPDATE loan_accounts SET status = 'written_off' WHERE id = ?", id);
        jdbc.update("""
                UPDATE schedule_entries
                SET status = 'paid', amount_paid = total_due, principal_paid = principal_due,
                    interest_paid = interest_due, closing_balance = 0
                WHERE loan_account_id = ? AND status != 'paid'
                """, id);
        return Map.of("writtenOffAmount", outstanding);
    }

    private Map<String, Object> lockedAccount(long id) {
        try {
            return jdbc.queryForMap("""
                    SELECT la.* FROM loan_accounts la WHERE la.id = ? FOR UPDATE
                    """, id);
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.notFound("Loan account not found");
        }
    }

    private void writeLedger(long accountId, Long transactionId, List<LedgerLine> entries) {
        BigDecimal debits = BigDecimal.ZERO;
        BigDecimal credits = BigDecimal.ZERO;
        for (LedgerLine entry : entries) {
            if (entry.amount().signum() <= 0) continue;
            jdbc.update("""
                    INSERT INTO ledger_entries (loan_account_id, transaction_id, account_name, entry_type, amount)
                    VALUES (?, ?, ?, ?, ?)
                    """, accountId, transactionId, entry.accountName(), entry.entryType(), entry.amount());
            if ("debit".equals(entry.entryType())) debits = debits.add(entry.amount());
            else credits = credits.add(entry.amount());
        }
        if (money(debits).compareTo(money(credits)) != 0) {
            throw new IllegalStateException("Financial ledger entries do not balance");
        }
    }

    private static BigDecimal positiveAmount(Object value, String field) {
        try {
            BigDecimal amount = new BigDecimal(String.valueOf(value));
            if (amount.signum() > 0) return amount.setScale(2, RoundingMode.HALF_UP);
        } catch (NumberFormatException ignored) {
            throw ApiException.badRequest(field + " must be greater than zero");
        }
        throw ApiException.badRequest(field + " must be greater than zero");
    }

    private static BigDecimal decimal(Object value) {
        if (value == null) return BigDecimal.ZERO.setScale(2);
        return value instanceof BigDecimal amount ? amount : new BigDecimal(String.valueOf(value));
    }

    private static BigDecimal money(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP);
    }

    private record LedgerLine(String accountName, String entryType, BigDecimal amount) {
    }
}
