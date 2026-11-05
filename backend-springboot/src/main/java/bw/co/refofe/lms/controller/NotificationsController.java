package bw.co.refofe.lms.controller;

import bw.co.refofe.lms.security.AuthSupport;
import bw.co.refofe.lms.security.AuthenticatedUser;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/notifications")
public class NotificationsController {
    private final JdbcTemplate jdbc;
    private final AuthSupport authSupport;

    public NotificationsController(JdbcTemplate jdbc, AuthSupport authSupport) {
        this.jdbc = jdbc;
        this.authSupport = authSupport;
    }

    @GetMapping("/mine")
    public List<Map<String, Object>> mine(HttpServletRequest request) {
        AuthenticatedUser user = authSupport.requireRole(request, "customer");
        return jdbc.queryForList("""
                SELECT id, trigger_type AS "triggerType", message,
                       delivery_status AS "deliveryStatus", created_at AS "createdAt",
                       read_at AS "readAt", reference_type AS "referenceType",
                       reference_id AS "referenceId"
                FROM notifications
                WHERE user_id = ? AND channel = 'in_app'
                ORDER BY created_at DESC, id DESC
                LIMIT 50
                """, user.id());
    }

    @GetMapping("/mine/unread-count")
    public Map<String, Integer> unreadCount(HttpServletRequest request) {
        AuthenticatedUser user = authSupport.requireRole(request, "customer");
        Integer count = jdbc.queryForObject("""
                SELECT COUNT(*) FROM notifications
                WHERE user_id = ? AND channel = 'in_app' AND read_at IS NULL
                """, Integer.class, user.id());  
        return Map.of("unreadCount", count == null ? 0 : count);
    }

    @PostMapping("/mine/read")
    @Transactional
    public Map<String, Integer> markMineRead(HttpServletRequest request) {
        AuthenticatedUser user = authSupport.requireRole(request, "customer");
        int updated = jdbc.update("""
                UPDATE notifications SET read_at = now()
                WHERE user_id = ? AND channel = 'in_app' AND read_at IS NULL
                """, user.id());
        return Map.of("markedRead", updated);
    }
}
