package bw.co.refofe.lms.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import bw.co.refofe.lms.security.AuthSupport;
import bw.co.refofe.lms.service.AssistantService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;

class AssistantControllerTest {
    @Test
    void storesQuestionAndAnswerForComplianceReview() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        AssistantService assistant = mock(AssistantService.class);
        AuthSupport authSupport = mock(AuthSupport.class);
        AssistantController controller = new AssistantController(jdbc, assistant, authSupport);
        UUID conversationId = UUID.randomUUID();
        when(assistant.answer("How do I apply?")).thenReturn("An officer reviews each application.");
        HttpServletRequest request = new MockHttpServletRequest();

        var result = controller.converse(
                new AssistantController.ConversationRequest(conversationId, "  How do I apply?  "), request);

        assertEquals("An officer reviews each application.", result.get("answer"));
        verify(jdbc).update(
                startsWith("INSERT INTO assistant_conversations"),
                eq(conversationId.toString()),
                isNull(),
                eq("How do I apply?"),
                eq("An officer reviews each application."));
    }
}
