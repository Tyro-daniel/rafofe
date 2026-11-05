package bw.co.refofe.lms.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class AuthFilter extends OncePerRequestFilter {
    public static final String USER_ATTRIBUTE = AuthFilter.class.getName() + ".user";
    private final JwtService jwtService;
    private final ObjectMapper objectMapper;
    private final JdbcTemplate jdbc;

    public AuthFilter(JwtService jwtService, ObjectMapper objectMapper, JdbcTemplate jdbc) {
        this.jwtService = jwtService;
        this.objectMapper = objectMapper;
        this.jdbc = jdbc;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String authorization = request.getHeader("Authorization");
        if (authorization == null) {
            chain.doFilter(request, response);
            return;
        }
        if (!authorization.startsWith("Bearer ") || authorization.length() <= 7) {
            reject(response, "Missing or malformed Authorization header");
            return;
        }
        AuthenticatedUser tokenUser;
        try {
            tokenUser = jwtService.verifyAccessToken(authorization.substring(7));
        } catch (RuntimeException error) {
            reject(response, error.getMessage());
            return;
        }
        Map<String, Object> account;
        try {
            account = jdbc.queryForMap(
                    "SELECT email, role, is_active FROM users WHERE id = ?", tokenUser.id());
        } catch (EmptyResultDataAccessException error) {
            reject(response, "Account is unavailable");
            return;
        }
        if (!Boolean.TRUE.equals(account.get("is_active"))) {
            reject(response, "Account is deactivated");
            return;
        }
        request.setAttribute(USER_ATTRIBUTE, new AuthenticatedUser(
                tokenUser.id(), String.valueOf(account.get("role")), String.valueOf(account.get("email"))));
        chain.doFilter(request, response);
    }

    private void reject(HttpServletResponse response, String message) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/json");
        objectMapper.writeValue(response.getOutputStream(), Map.of("error", message));
    }
}
