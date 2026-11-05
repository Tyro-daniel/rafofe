package bw.co.refofe.lms.service;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class AssistantServiceTest {
    private JdbcTemplate jdbc;
    private AssistantService assistant;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        assistant = new AssistantService(jdbc);
    }

    @Test
    void explainsApplicationProcessAndHumanReview() {
        String answer = assistant.answer("How do I apply for a loan?");

        assertTrue(answer.contains("verify your email"));
        assertTrue(answer.contains("loan officer"));
        verifyNoInteractions(jdbc);
    }

    @Test
    void answersProductQuestionsUsingActiveProductTerms() {
        when(jdbc.queryForList(anyString())).thenReturn(List.of(Map.of(
                "name", "Small Micro Loan",
                "monthly_rate_pct", new BigDecimal("30.00"),
                "min_amount", new BigDecimal("500.00"),
                "max_amount", new BigDecimal("10000.00"),
                "min_tenure_months", 1,
                "max_tenure_months", 6)));

        String answer = assistant.answer("What interest rates are available?");

        assertTrue(answer.contains("Small Micro Loan"));
        assertTrue(answer.contains("P 500.00"));
        assertTrue(answer.contains("30.00% per month"));
        verify(jdbc).queryForList(anyString());
    }

    @Test
    void explainsOnlineRepaymentsAreNotAvailable() {
        String answer = assistant.answer("Can I pay online?");

        assertTrue(answer.contains("not available"));
        assertTrue(answer.contains("loan officer"));
        verifyNoInteractions(jdbc);
    }

    @Test
    void refusesToPredictLendingDecisions() {
        String answer = assistant.answer("Will my loan be approved?");

        assertTrue(answer.contains("cannot approve, decline, or predict"));
        verifyNoInteractions(jdbc);
    }

    @Test
    void answersWhetherLoanDecisionsAreMadeByAi() {
        String answer = assistant.answer("Are loan decisions made by AI?");

        assertTrue(answer.startsWith("No. Loan decisions are not made by AI."));
        assertTrue(answer.contains("A loan officer reviews each application"));
        verifyNoInteractions(jdbc);
    }
}
