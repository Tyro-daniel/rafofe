package bw.co.refofe.lms.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class LoanSchedule {
    private LoanSchedule() {
    }

    public static List<Map<String, Object>> build(
            BigDecimal principal, BigDecimal monthlyRatePct, int months, LocalDate startDate) {
        if (principal.signum() <= 0) throw new IllegalArgumentException("principal must be > 0");
        if (monthlyRatePct.signum() < 0) throw new IllegalArgumentException("monthlyRatePct must be >= 0");
        if (months <= 0) throw new IllegalArgumentException("months must be a positive integer");

        BigDecimal monthlyRate = monthlyRatePct.divide(BigDecimal.valueOf(100), 12, RoundingMode.HALF_UP);
        double rate = monthlyRate.doubleValue();
        BigDecimal fixedPayment = rate == 0.0
                ? money(principal.divide(BigDecimal.valueOf(months), 12, RoundingMode.HALF_UP))
                : money(BigDecimal.valueOf(principal.doubleValue() * rate / (1.0 - Math.pow(1.0 + rate, -months))));
        BigDecimal balance = principal;
        List<Map<String, Object>> rows = new ArrayList<>();
        for (int installment = 1; installment <= months; installment++) {
            BigDecimal opening = money(balance);
            BigDecimal interest = money(balance.multiply(monthlyRate));
            BigDecimal principalDue = money(fixedPayment.subtract(interest));
            if (installment == months) principalDue = money(balance);
            BigDecimal total = money(principalDue.add(interest));
            balance = money(balance.subtract(principalDue).max(BigDecimal.ZERO));
            Map<String, Object> row = new HashMap<>();
            row.put("installment_no", installment);
            row.put("due_date", startDate.plusMonths(installment));
            row.put("opening_balance", opening);
            row.put("principal_due", principalDue);
            row.put("interest_due", interest);
            row.put("total_due", total);
            row.put("closing_balance", balance);
            rows.add(row);
        }
        return rows;
    }

    private static BigDecimal money(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP);
    }
}
