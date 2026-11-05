package bw.co.refofe.lms.security;

import bw.co.refofe.lms.api.ApiException;
import bw.co.refofe.lms.config.AppProperties;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Service;

@Service
public class JwtService {
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();
    private final byte[] secret;
    private final ObjectMapper objectMapper;

    public JwtService(AppProperties properties, ObjectMapper objectMapper) {
        if (properties.jwtSecret() == null || properties.jwtSecret().length() < 32) {
            throw new IllegalStateException("JWT_SECRET must be set to a secret of at least 32 characters.");
        }
        this.secret = properties.jwtSecret().getBytes(StandardCharsets.UTF_8);
        this.objectMapper = objectMapper;
    }

    public String createAccessToken(AuthenticatedUser user) {
        long now = Instant.now().getEpochSecond();
        return sign(Map.of(
                "sub", Long.toString(user.id()),
                "role", user.role(),
                "email", user.email(),
                "iat", now,
                "exp", now + 1800));
    }

    public String createRefreshToken(AuthenticatedUser user) {
        long now = Instant.now().getEpochSecond();
        return sign(Map.of("sub", Long.toString(user.id()), "type", "refresh", "iat", now, "exp", now + 2592000));
    }

    public AuthenticatedUser verifyAccessToken(String token) {
        try {
            String[] parts = token.split("\\.");
            if (parts.length != 3) throw new IllegalArgumentException();
            String signed = parts[0] + "." + parts[1];
            if (!java.security.MessageDigest.isEqual(
                    signBytes(signed), DECODER.decode(parts[2]))) {
                throw new IllegalArgumentException();
            }
            Map<String, Object> claims = objectMapper.readValue(
                    DECODER.decode(parts[1]), new TypeReference<>() {});
            if (!(claims.get("exp") instanceof Number expiry)
                    || expiry.longValue() <= Instant.now().getEpochSecond()) {
                throw new IllegalArgumentException();
            }
            return new AuthenticatedUser(
                    Long.parseLong(String.valueOf(claims.get("sub"))),
                    String.valueOf(claims.get("role")),
                    String.valueOf(claims.get("email")));
        } catch (Exception error) {
            throw ApiException.unauthorized("Invalid or expired token");
        }
    }

    private String sign(Map<String, Object> claims) {
        try {
            String header = ENCODER.encodeToString(
                    objectMapper.writeValueAsBytes(Map.of("alg", "HS256", "typ", "JWT")));
            String payload = ENCODER.encodeToString(objectMapper.writeValueAsBytes(claims));
            String body = header + "." + payload;
            return body + "." + ENCODER.encodeToString(signBytes(body));
        } catch (Exception error) {
            throw new IllegalStateException("Could not create access token", error);
        }
    }

    private byte[] signBytes(String input) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return mac.doFinal(input.getBytes(StandardCharsets.UTF_8));
        } catch (Exception error) {
            throw new IllegalStateException("Could not sign access token", error);
        }
    }
}
