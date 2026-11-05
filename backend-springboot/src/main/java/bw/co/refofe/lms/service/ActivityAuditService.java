package bw.co.refofe.lms.service;

import bw.co.refofe.lms.security.AuthenticatedUser;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class ActivityAuditService {
    private static final Logger LOGGER = LoggerFactory.getLogger(ActivityAuditService.class);
    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public ActivityAuditService(JdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    public void recordRequest(AuthenticatedUser actor, HttpServletRequest request, int status) {
        String path = request.getRequestURI();
        String action = request.getMethod() + " " + path;
        if (action.length() > 100) action = action.substring(0, 100);
        String entityType = area(path);
        try {
            String details = objectMapper.writeValueAsString(java.util.Map.of(
                    "method", request.getMethod(),
                    "path", path,
                    "status", status));
            jdbc.update("""
                    INSERT INTO audit_logs (actor_id, action, entity_type, after_value, ip_address)
                    VALUES (?, ?, ?, CAST(? AS jsonb), ?)
                    """, actor.id(), action, entityType, details, request.getRemoteAddr());
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Unable to serialize activity audit record", error);
        } catch (RuntimeException error) {
            LOGGER.error("Unable to persist activity audit record for {} {}", request.getMethod(), request.getRequestURI(), error);
            throw error;
        }
    }

    private static String area(String path) {
        String[] segments = path.split("/");
        int first = 1;
        if (segments.length > 1 && segments[1].equals("api")) first++;
        if (segments.length <= first || segments[first].isBlank()) return "api";
        String result = segments[first];
        if (segments.length > first + 1 && !segments[first + 1].isBlank()) {
            result += "/" + segments[first + 1];
        }
        return result.length() <= 50 ? result : result.substring(0, 50);
    }

    public void recordAuthentication(long actorId, String action, HttpServletRequest request) {
        try {
            jdbc.update("""
                    INSERT INTO audit_logs (actor_id, action, entity_type, after_value, ip_address)
                    VALUES (?, ?, 'authentication', '{}'::jsonb, ?)
                    """, actorId, action, request.getRemoteAddr());
        } catch (RuntimeException error) {
            LOGGER.error("Unable to persist authentication audit record for {}", action, error);
        }
    }

    public void recordSystemEvent(String action, String entityType, long entityId, Object details) {
        try {
            String value = objectMapper.writeValueAsString(details);
            jdbc.update("""
                    INSERT INTO audit_logs (action, entity_type, entity_id, after_value)
                    VALUES (?, ?, ?, CAST(? AS jsonb))
                    """, action, entityType, Math.toIntExact(entityId), value);
        } catch (JsonProcessingException error) {
            LOGGER.error("Unable to serialize system activity record for {}", action, error);
        } catch (RuntimeException error) {
            LOGGER.error("Unable to persist system activity record for {}", action, error);
        }
    }
}
