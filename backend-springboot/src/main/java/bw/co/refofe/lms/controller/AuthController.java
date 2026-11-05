package bw.co.refofe.lms.controller;

import bw.co.refofe.lms.api.ApiException;
import bw.co.refofe.lms.security.AuthSupport;
import bw.co.refofe.lms.security.AuthenticatedUser;
import bw.co.refofe.lms.security.JwtService;
import bw.co.refofe.lms.service.EmailService;
import bw.co.refofe.lms.service.ActivityAuditService;
import bw.co.refofe.lms.service.PhoneNumber;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;
import java.io.ByteArrayOutputStream;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.client.j2se.MatrixToImageWriter;
import com.google.zxing.qrcode.QRCodeWriter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.transaction.annotation.Transactional;

@RestController
@RequestMapping("/auth")
public class AuthController {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String GENERIC_RESET_RESPONSE =
            "If an account with that email exists, we've sent a password reset code.";
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final AuthSupport authSupport;
    private final EmailService emailService;
    private final ActivityAuditService activityAuditService;

    public AuthController(
            JdbcTemplate jdbc, PasswordEncoder passwordEncoder, JwtService jwtService,
            AuthSupport authSupport, EmailService emailService, ActivityAuditService activityAuditService) {
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.authSupport = authSupport;
        this.emailService = emailService;
        this.activityAuditService = activityAuditService;
    }

    @PostMapping("/register")
    @Transactional
    public Map<String, Object> register(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        String email = requiredString(body, "email").toLowerCase(Locale.ROOT);
        String password = requiredString(body, "password");
        String fullName = requiredString(body, "fullName");
        if (!email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")
                || password.length() < 8 || fullName.trim().length() < 2) {
            throw ApiException.badRequest("Invalid input");
        }
        String maritalStatus = String.valueOf(body.getOrDefault("maritalStatus", "unknown"));
        if (!SetValues.MARITAL_STATUSES.contains(maritalStatus)) throw ApiException.badRequest("Invalid maritalStatus");
        String phone = optionalString(body.get("phone"));
        if (phone != null) phone = PhoneNumber.toE164(phone);

        jdbc.queryForList("SELECT pg_advisory_xact_lock(hashtext(?))", "registration:" + email);
        var existingUsers = jdbc.queryForList(
                "SELECT id, role, email_verified, is_active FROM users WHERE email = ? FOR UPDATE", email);
        Map<String, Object> user;
        if (!existingUsers.isEmpty()) {
            Map<String, Object> existing = existingUsers.getFirst();
            if (!"customer".equals(existing.get("role"))
                    || Boolean.TRUE.equals(existing.get("email_verified"))
                    || !Boolean.TRUE.equals(existing.get("is_active"))) {
                throw new ApiException(org.springframework.http.HttpStatus.CONFLICT,
                        "An account with this email already exists. Please sign in.");
            }
            long existingUserId = ((Number) existing.get("id")).longValue();
            if (sentRecently(existingUserId, "email_verification")) {
                throw new ApiException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,
                        "A verification email was sent recently. Please wait a couple of minutes before restarting sign-up.");
            }
        }

        String verificationCode = newVerificationCode();
        String passwordHash = passwordEncoder.encode(password);
        if (existingUsers.isEmpty()) {
            user = jdbc.queryForMap(
                    """
                    INSERT INTO users (email, password_hash, role, full_name, phone, marital_status,
                                       email_verified, email_verification_token_hash, email_verification_expires_at)
                    VALUES (?, ?, 'customer', ?, ?, ?, FALSE, ?, now() + interval '10 minutes')
                    RETURNING id, email, role, full_name, marital_status, email_verified, created_at
                    """,
                    email, passwordHash, fullName.trim(), phone, maritalStatus, tokenHash(verificationCode));
        } else {
            user = jdbc.queryForMap(
                    """
                    UPDATE users
                    SET password_hash = ?, full_name = ?, phone = ?, marital_status = ?,
                        email_verification_token_hash = ?, email_verification_expires_at = now() + interval '10 minutes',
                        email_verification_attempts = 0
                    WHERE id = ?
                    RETURNING id, email, role, full_name, marital_status, email_verified, created_at
                    """,
                    passwordHash, fullName.trim(), phone, maritalStatus, tokenHash(verificationCode),
                    existingUsers.getFirst().get("id"));
        }
        activityAuditService.recordAuthentication(
                ((Number) user.get("id")).longValue(), "account_registered", request);
        boolean verificationSent = emailService.sendVerificationCode(user, verificationCode);
        return Map.of(
                "message", verificationSent
                        ? "Account created. Check your email for the verification code."
                        : "Account created, but the verification email could not be sent. Use the resend option to try again.",
                "verificationSent", verificationSent);
    }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        String email = requiredString(body, "email").toLowerCase(Locale.ROOT);
        String password = requiredString(body, "password");
        Map<String, Object> user;
        try {
            user = jdbc.queryForMap(
                    """
                    SELECT id, email, password_hash, role, full_name, phone, mfa_enabled, mfa_secret, is_active, email_verified
                    FROM users WHERE email = ?
                    """, email);
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.unauthorized("Invalid email or password");
        }
        if (!Boolean.TRUE.equals(user.get("is_active"))
                || !passwordEncoder.matches(password, String.valueOf(user.get("password_hash")))) {
            throw ApiException.unauthorized("Invalid email or password");
        }
        if (!Boolean.TRUE.equals(user.get("email_verified")) && "customer".equals(user.get("role"))) {
            throw ApiException.forbidden("Please verify your email before signing in. Request a verification code to continue.");
        }
        if (Boolean.TRUE.equals(user.get("mfa_enabled"))) {
            String code = optionalString(body.get("mfaCode"));
            if (code == null) return Map.of("mfaRequired", true);
            if (!validTotp(code, String.valueOf(user.get("mfa_secret")))) {
                throw ApiException.unauthorized("Invalid MFA code");
            }
        }
        user.put("fullName", user.remove("full_name"));
        user.put("emailVerified", user.remove("email_verified"));
        user.remove("password_hash");
        user.remove("mfa_enabled");
        user.remove("mfa_secret");
        user.remove("is_active");
        activityAuditService.recordAuthentication(
                ((Number) user.get("id")).longValue(), "signed_in", request);
        return tokenResponse(user);
    }

    @GetMapping("/me")
    public Map<String, Object> me(HttpServletRequest request) {
        AuthenticatedUser user = authSupport.requireUser(request);
        try {
            return jdbc.queryForMap(
                    """
                    SELECT id, email, role, full_name, phone, marital_status, mfa_enabled, email_verified, created_at
                    FROM users WHERE id = ?
                    """, user.id());
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.notFound("User not found");
        }
    }

    @GetMapping("/verify-email")
    @Transactional
    public Map<String, Object> verifyEmail(@RequestParam String token) {
        Map<String, Object> user = findTokenUser("email_verification_token_hash", token);
        if (user == null) throw ApiException.badRequest("This verification link is invalid or has already been used.");
        if (Boolean.TRUE.equals(user.get("email_verified"))) {
            return Map.of("message", "This email address is already verified.", "alreadyVerified", true);
        }
        if (expired(user.get("email_verification_expires_at"))) {
            throw ApiException.badRequest("This verification link has expired. Please request a new one.");
        }
        jdbc.update("UPDATE users SET email_verified = TRUE, email_verification_token_hash = NULL, email_verification_expires_at = NULL, email_verification_attempts = 0 WHERE id = ?",
                user.get("id"));
        return Map.of("message", "Email verified successfully.", "alreadyVerified", false);
    }

    @PostMapping("/verify-email-code")
    public Map<String, String> verifyEmailCode(@RequestBody Map<String, Object> body) {
        String email = requiredString(body, "email").toLowerCase(Locale.ROOT);
        String code = requiredString(body, "code");
        if (!email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$") || !code.matches("\\d{6}")) {
            throw ApiException.badRequest("Enter a valid email address and six-digit code.");
        }
        Map<String, Object> user;
        try {
            user = jdbc.queryForMap(
                    """
                    SELECT id, email_verified, email_verification_token_hash, email_verification_expires_at,
                           email_verification_attempts
                    FROM users WHERE email = ? AND role = 'customer'
                    """, email);
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.badRequest("The verification code is invalid or expired.");
        }
        if (Boolean.TRUE.equals(user.get("email_verified"))) {
            return Map.of("message", "Your email address is already verified.");
        }
        int attempts = ((Number) user.get("email_verification_attempts")).intValue();
        if (attempts >= 5) {
            throw new ApiException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,
                    "Too many incorrect codes. Request a new verification code.");
        }
        if (expired(user.get("email_verification_expires_at"))) {
            throw ApiException.badRequest("The verification code has expired. Request a new code.");
        }
        if (!MessageDigest.isEqual(
                String.valueOf(user.get("email_verification_token_hash")).getBytes(StandardCharsets.UTF_8),
                tokenHash(code).getBytes(StandardCharsets.UTF_8))) {
            jdbc.update(
                    "UPDATE users SET email_verification_attempts = email_verification_attempts + 1 WHERE id = ?",
                    user.get("id"));
            throw ApiException.badRequest("The verification code is incorrect.");
        }
        jdbc.update(
                """
                UPDATE users
                SET email_verified = TRUE, email_verification_token_hash = NULL,
                    email_verification_expires_at = NULL, email_verification_attempts = 0
                WHERE id = ?
                """,
                user.get("id"));
        return Map.of("message", "Your email address has been verified. You can now sign in.");
    }

    @PostMapping("/resend-verification-code")
    public Map<String, String> resendVerificationCode(@RequestBody Map<String, Object> body) {
        String email = requiredString(body, "email").toLowerCase(Locale.ROOT);
        if (!email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) throw ApiException.badRequest("Invalid email address.");
        var users = jdbc.queryForList(
                """
                SELECT id, email, full_name, email_verified
                FROM users WHERE email = ? AND role = 'customer'
                """, email);
        if (!users.isEmpty()) {
            Map<String, Object> user = users.get(0);
            long userId = ((Number) user.get("id")).longValue();
            if (!Boolean.TRUE.equals(user.get("email_verified")) && !sentRecently(userId, "email_verification")) {
                String code = newVerificationCode();
                jdbc.update(
                        """
                        UPDATE users
                        SET email_verification_token_hash = ?,
                            email_verification_expires_at = now() + interval '10 minutes',
                            email_verification_attempts = 0
                        WHERE id = ?
                        """,
                        tokenHash(code), userId);
                emailService.sendVerificationCode(user, code);
            }
        }
        return Map.of("message", "If this address belongs to an unverified account, a new code will be sent when eligible.");
    }

    @PostMapping("/resend-verification")
    public Map<String, String> resendVerification(HttpServletRequest request) {
        AuthenticatedUser requester = authSupport.requireUser(request);
        Map<String, Object> user = jdbc.queryForMap(
                "SELECT id, email, full_name, email_verified FROM users WHERE id = ?", requester.id());
        if (Boolean.TRUE.equals(user.get("email_verified"))) throw ApiException.badRequest("Your email is already verified.");
        if (sentRecently(requester.id(), "email_verification")) {
            throw new ApiException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,
                    "Please wait a couple of minutes before requesting another verification email.");
        }
        String code = newVerificationCode();
        jdbc.update(
                """
                UPDATE users
                SET email_verification_token_hash = ?,
                    email_verification_expires_at = now() + interval '10 minutes',
                    email_verification_attempts = 0
                WHERE id = ?
                """,
                tokenHash(code), requester.id());
        boolean sent = emailService.sendVerificationCode(user, code);
        if (!sent) throw new ApiException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                "The verification email could not be sent. Please try again later.");
        return Map.of("message", "Verification code sent. Check your inbox.");
    }

    @PostMapping("/forgot-password")
    public Map<String, String> forgotPassword(@RequestBody Map<String, Object> body) {
        String email = requiredString(body, "email").toLowerCase(Locale.ROOT);
        if (!email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) throw ApiException.badRequest("Invalid input");
        var users = jdbc.query(
                "SELECT id, email, full_name FROM users WHERE email = ? AND is_active = TRUE AND role = 'customer'",
                (rs, row) -> Map.<String, Object>of(
                        "id", rs.getLong("id"), "email", rs.getString("email"), "full_name", rs.getString("full_name")),
                email);
        if (!users.isEmpty()) {
            Map<String, Object> user = users.getFirst();
            long userId = ((Number) user.get("id")).longValue();
            if (!sentRecently(userId, "password_reset_requested")) {
                String code = newVerificationCode();
                jdbc.update(
                        """
                        UPDATE users
                        SET password_reset_token_hash = ?,
                            password_reset_expires_at = now() + interval '10 minutes',
                            password_reset_attempts = 0
                        WHERE id = ?
                        """,
                        tokenHash(code), userId);
                emailService.sendPasswordResetCode(user, code);
            }
        }
        return Map.of("message", GENERIC_RESET_RESPONSE);
    }

    @PostMapping("/reset-password")
    @Transactional
    public Map<String, String> resetPassword(@RequestBody Map<String, Object> body) {
        String password = requiredString(body, "newPassword");
        if (password.length() < 8) throw ApiException.badRequest("Invalid input");
        String token = optionalString(body.get("token"));
        if (token != null) {
            Map<String, Object> user = findTokenUser("password_reset_token_hash", token);
            if (user == null) throw ApiException.badRequest("This reset link is invalid or has already been used.");
            if (expired(user.get("password_reset_expires_at"))) {
                throw ApiException.badRequest("This reset link has expired. Please request a new one.");
            }
            updatePassword(user.get("id"), password);
            return Map.of("message", "Your password has been reset. Please log in with your new password.");
        }

        String email = requiredString(body, "email").toLowerCase(Locale.ROOT);
        String code = requiredString(body, "code");
        if (!email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$") || !code.matches("\\d{6}")) {
            throw ApiException.badRequest("Enter a valid email address and six-digit code.");
        }
        var users = jdbc.query(
                """
                SELECT id, password_reset_token_hash, password_reset_expires_at, password_reset_attempts
                FROM users WHERE email = ? AND role = 'customer' AND is_active = TRUE
                """,
                (rs, row) -> {
                    Map<String, Object> user = new HashMap<>();
                    user.put("id", rs.getLong("id"));
                    user.put("password_reset_token_hash", rs.getString("password_reset_token_hash"));
                    user.put("password_reset_expires_at", rs.getTimestamp("password_reset_expires_at"));
                    user.put("password_reset_attempts", rs.getInt("password_reset_attempts"));
                    return user;
                },
                email);
        if (users.isEmpty()) throw ApiException.badRequest("The password reset code is invalid or expired.");
        Map<String, Object> user = users.getFirst();
        if (((Number) user.get("password_reset_attempts")).intValue() >= 5) {
            throw new ApiException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,
                    "Too many incorrect codes. Request a new password reset code.");
        }
        if (expired(user.get("password_reset_expires_at"))) {
            throw ApiException.badRequest("The password reset code has expired. Request a new code.");
        }
        if (!MessageDigest.isEqual(
                String.valueOf(user.get("password_reset_token_hash")).getBytes(StandardCharsets.UTF_8),
                tokenHash(code).getBytes(StandardCharsets.UTF_8))) {
            jdbc.update(
                    "UPDATE users SET password_reset_attempts = password_reset_attempts + 1 WHERE id = ?",
                    user.get("id"));
            throw ApiException.badRequest("The password reset code is invalid or expired.");
        }
        updatePassword(user.get("id"), password);
        return Map.of("message", "Your password has been reset. Please log in with your new password.");
    }

    private void updatePassword(Object userId, String password) {
        jdbc.update(
                """
                UPDATE users
                SET password_hash = ?, password_reset_token_hash = NULL,
                    password_reset_expires_at = NULL, password_reset_attempts = 0
                WHERE id = ?
                """,
                passwordEncoder.encode(password), userId);
    }

    @PostMapping("/mfa/setup")
    public Map<String, String> mfaSetup(HttpServletRequest request) {
        AuthenticatedUser user = authSupport.requireUser(request);
        byte[] bytes = new byte[20];
        RANDOM.nextBytes(bytes);
        String secret = encodeBase32(bytes);
        jdbc.update("UPDATE users SET mfa_secret = ? WHERE id = ?", secret, user.id());
        String uri = "otpauth://totp/LMS%20Botswana:" + java.net.URLEncoder.encode(user.email(), StandardCharsets.UTF_8)
                + "?secret=" + secret + "&issuer=LMS%20Botswana";
        try {
            ByteArrayOutputStream qr = new ByteArrayOutputStream();
            MatrixToImageWriter.writeToStream(new QRCodeWriter().encode(uri, BarcodeFormat.QR_CODE, 250, 250), "PNG", qr);
            return Map.of("secret", secret, "otpauthUrl", uri,
                    "qrDataUrl", "data:image/png;base64," + Base64.getEncoder().encodeToString(qr.toByteArray()));
        } catch (Exception error) {
            throw new IllegalStateException("Could not generate MFA QR code", error);
        }
    }

    @PostMapping("/mfa/enable")
    public Map<String, Boolean> mfaEnable(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        AuthenticatedUser user = authSupport.requireUser(request);
        String secret = jdbc.queryForObject("SELECT mfa_secret FROM users WHERE id = ?", String.class, user.id());
        String code = optionalString(body.get("code"));
        if (secret == null) throw ApiException.badRequest("Call /mfa/setup first");
        if (code == null || !validTotp(code, secret)) throw ApiException.unauthorized("Invalid code — MFA not enabled");
        jdbc.update("UPDATE users SET mfa_enabled = TRUE WHERE id = ?", user.id());
        return Map.of("mfaEnabled", true);
    }

    private Map<String, Object> sessionResponse(Map<String, Object> user) {
        Map<String, Object> response = new HashMap<>();
        response.put("user", user);
        AuthenticatedUser principal = new AuthenticatedUser(
                ((Number) user.get("id")).longValue(), String.valueOf(user.get("role")), String.valueOf(user.get("email")));
        response.put("accessToken", jwtService.createAccessToken(principal));
        response.put("refreshToken", jwtService.createRefreshToken(principal));
        return response;
    }

    private Map<String, Object> tokenResponse(Map<String, Object> user) {
        return sessionResponse(user);
    }

    private boolean sentRecently(long userId, String eventType) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM email_log WHERE user_id = ? AND event_type = ? AND status = 'sent' AND created_at > now() - interval '2 minutes'",
                Integer.class, userId, eventType);
        return count != null && count > 0;
    }

    private Map<String, Object> findTokenUser(String column, String token) {
        if (!SetValues.TOKEN_COLUMNS.contains(column)) throw new IllegalArgumentException("Unexpected token column");
        var rows = jdbc.query(
                "SELECT id, email_verified, " + column.replace("_token_hash", "_expires_at")
                        + " AS token_expires_at FROM users WHERE " + column + " = ?",
                (rs, row) -> {
                    Map<String, Object> result = new HashMap<>();
                    result.put("id", rs.getLong("id"));
                    result.put("email_verified", rs.getBoolean("email_verified"));
                    result.put("token_expires_at", rs.getTimestamp("token_expires_at"));
                    return result;
                }, tokenHash(token));
        if (rows.isEmpty()) return null;
        Map<String, Object> row = rows.getFirst();
        row.put(column.replace("_token_hash", "_expires_at"), row.get("token_expires_at"));
        return row;
    }

    private static boolean expired(Object value) {
        if (value == null) return true;
        return ((java.util.Date) value).toInstant().isBefore(Instant.now());
    }

    private static String tokenHash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception error) {
            throw new IllegalStateException("Unable to hash token", error);
        }
    }

    private static String newVerificationCode() {
        return String.format(Locale.ROOT, "%06d", RANDOM.nextInt(1_000_000));
    }

    private static String requiredString(Map<String, Object> body, String key) {
        Object value = body.get(key);
        if (!(value instanceof String string) || string.isBlank()) throw ApiException.badRequest("Invalid input");
        return string.trim();
    }

    private static String optionalString(Object value) {
        return value instanceof String string && !string.isBlank() ? string.trim() : null;
    }

    private static boolean validTotp(String code, String base64Secret) {
        try {
            byte[] key = decodeBase32(base64Secret);
            long counter = Instant.now().getEpochSecond() / 30;
            for (long offset = -1; offset <= 1; offset++) {
                byte[] data = ByteBuffer.allocate(8).putLong(counter + offset).array();
                javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA1");
                mac.init(new javax.crypto.spec.SecretKeySpec(key, "HmacSHA1"));
                byte[] hash = mac.doFinal(data);
                int index = hash[hash.length - 1] & 0x0f;
                int number = ((hash[index] & 0x7f) << 24) | ((hash[index + 1] & 0xff) << 16)
                        | ((hash[index + 2] & 0xff) << 8) | (hash[index + 3] & 0xff);
                if (String.format("%06d", number % 1_000_000).equals(code)) return true;
            }
        } catch (IllegalArgumentException error) {
            return false;
        } catch (java.security.GeneralSecurityException error) {
            throw new IllegalStateException("Could not validate MFA code", error);
        }
        return false;
    }

    private static String encodeBase32(byte[] bytes) {
        final String alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        StringBuilder encoded = new StringBuilder();
        int buffer = 0;
        int bitsLeft = 0;
        for (byte value : bytes) {
            buffer = (buffer << 8) | (value & 0xff);
            bitsLeft += 8;
            while (bitsLeft >= 5) {
                encoded.append(alphabet.charAt((buffer >>> (bitsLeft - 5)) & 31));
                bitsLeft -= 5;
            }
        }
        if (bitsLeft > 0) encoded.append(alphabet.charAt((buffer << (5 - bitsLeft)) & 31));
        return encoded.toString();
    }

    private static byte[] decodeBase32(String encoded) {
        String alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        byte[] output = new byte[encoded.length() * 5 / 8];
        int buffer = 0;
        int bitsLeft = 0;
        int index = 0;
        for (char character : encoded.toUpperCase(Locale.ROOT).replace("=", "").toCharArray()) {
            int value = alphabet.indexOf(character);
            if (value < 0) throw new IllegalArgumentException("Invalid MFA secret");
            buffer = (buffer << 5) | value;
            bitsLeft += 5;
            if (bitsLeft >= 8) {
                output[index++] = (byte) ((buffer >>> (bitsLeft - 8)) & 0xff);
                bitsLeft -= 8;
            }
        }
        return java.util.Arrays.copyOf(output, index);
    }

    private static final class SetValues {
        static final java.util.Set<String> MARITAL_STATUSES =
                java.util.Set.of("single", "married_in_community", "married_out_of_community", "unknown");
        static final java.util.Set<String> TOKEN_COLUMNS = java.util.Set.of(
                "email_verification_token_hash", "email_verification_expires_at",
                "password_reset_token_hash", "password_reset_expires_at");
    }
}
