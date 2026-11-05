package bw.co.refofe.lms.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class LoanScheduleTest {
    @Test
    void buildsReducingBalanceScheduleAndPaysOffFinalBalance() {
        List<Map<String, Object>> rows = LoanSchedule.build(
                new BigDecimal("2000.00"), new BigDecimal("30.00"), 3, LocalDate.of(2026, 1, 31));

        assertEquals(3, rows.size());
        assertEquals(new BigDecimal("2000.00"), rows.getFirst().get("opening_balance"));
        assertEquals(new BigDecimal("600.00"), rows.getFirst().get("interest_due"));
        assertEquals(new BigDecimal("0.00"), rows.getLast().get("closing_balance"));
        assertEquals(LocalDate.of(2026, 4, 30), rows.getLast().get("due_date"));
    }

    @Test
    void handlesZeroInterest() {
        List<Map<String, Object>> rows = LoanSchedule.build(
                new BigDecimal("100.00"), BigDecimal.ZERO, 3, LocalDate.of(2026, 1, 1));

        assertEquals(new BigDecimal("33.33"), rows.getFirst().get("principal_due"));
        assertEquals(new BigDecimal("33.34"), rows.getLast().get("principal_due"));
        assertEquals(new BigDecimal("0.00"), rows.getLast().get("closing_balance"));
    }
}
