package bw.co.refofe.lms.controller;

import bw.co.refofe.lms.api.ApiException;
import bw.co.refofe.lms.security.AuthFilter;
import bw.co.refofe.lms.security.AuthSupport;
import bw.co.refofe.lms.security.AuthenticatedUser;
import bw.co.refofe.lms.service.AssistantService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/assistant")
public class AssistantController {
    private final JdbcTemplate jdbc;
    private final AssistantService assistant;
    private final AuthSupport authSupport;

    public AssistantController(JdbcTemplate jdbc, AssistantService assistant, AuthSupport authSupport) {
        this.jdbc = jdbc;
        this.assistant = assistant;
        this.authSupport = authSupport;
    }

    @PostMapping("/conversations")
    public Map<String, String> converse(
            @Valid @RequestBody ConversationRequest input, HttpServletRequest request) {
        String question = input.question().strip();
        if (question.isEmpty()) throw ApiException.badRequest("question must not be blank");
        String answer = assistant.answer(question);
        Object principal = request.getAttribute(AuthFilter.USER_ATTRIBUTE);
        Long userId = principal instanceof AuthenticatedUser user ? user.id() : null;
        jdbc.update("""
                INSERT INTO assistant_conversations
                  (conversation_id, user_id, user_question, assistant_answer)
                VALUES (?::uuid, ?, ?, ?)
                """, input.conversationId().toString(), userId, question, answer);
        return Map.of("answer", answer);
    }

    @GetMapping("/conversations")
    public List<Map<String, Object>> conversations(
            HttpServletRequest request, @RequestParam(defaultValue = "50") int limit) {
        authSupport.requireRole(request, "admin");
        if (limit < 1 || limit > 100) {
            throw ApiException.badRequest("limit must be between 1 and 100");
        }
        return jdbc.queryForList("""
                SELECT id, conversation_id, user_id, user_question, assistant_answer, created_at
                FROM assistant_conversations
                ORDER BY created_at DESC, id DESC
                LIMIT ?
                """, limit);
    }

    public record ConversationRequest(
            @NotNull UUID conversationId,
            @NotBlank @Size(max = 500) String question) {}
}
