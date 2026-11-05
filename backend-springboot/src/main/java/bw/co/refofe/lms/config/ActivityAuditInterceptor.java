package bw.co.refofe.lms.config;

import bw.co.refofe.lms.security.AuthFilter;
import bw.co.refofe.lms.security.AuthenticatedUser;
import bw.co.refofe.lms.service.ActivityAuditService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class ActivityAuditInterceptor implements HandlerInterceptor {
    private static final Logger LOGGER = LoggerFactory.getLogger(ActivityAuditInterceptor.class);
    private final ActivityAuditService auditService;

    public ActivityAuditInterceptor(ActivityAuditService auditService) {
        this.auditService = auditService;
    }

    @Override
    public void afterCompletion(
            HttpServletRequest request,
            HttpServletResponse response,
            Object handler,
            Exception exception) {
        String method = request.getMethod();
        if (response.getStatus() < 200 || response.getStatus() >= 300
                || !(method.equals("POST") || method.equals("PATCH")
                || method.equals("PUT") || method.equals("DELETE"))) {
            return;
        }
        Object value = request.getAttribute(AuthFilter.USER_ATTRIBUTE);
        if (!(value instanceof AuthenticatedUser actor)) return;
        try {
            auditService.recordRequest(actor, request, response.getStatus());
        } catch (RuntimeException error) {
            LOGGER.error("A successful {} request could not be added to the activity log", request.getRequestURI(), error);
        }
    }
}
