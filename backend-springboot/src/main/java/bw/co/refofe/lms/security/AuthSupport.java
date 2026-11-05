package bw.co.refofe.lms.security;

import bw.co.refofe.lms.api.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Arrays;
import org.springframework.stereotype.Component;

@Component
public class AuthSupport {
    public AuthenticatedUser requireUser(HttpServletRequest request) {
        Object user = request.getAttribute(AuthFilter.USER_ATTRIBUTE);
        if (user instanceof AuthenticatedUser authenticatedUser) return authenticatedUser;
        throw ApiException.unauthorized("Not authenticated");
    }

    public AuthenticatedUser requireRole(HttpServletRequest request, String... roles) {
        AuthenticatedUser user = requireUser(request);
        if (Arrays.stream(roles).noneMatch(user.role()::equals)) {
            throw ApiException.forbidden("Insufficient permissions for this action");
        }
        return user;
    }
}
