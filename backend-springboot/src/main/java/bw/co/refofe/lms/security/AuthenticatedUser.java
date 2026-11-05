package bw.co.refofe.lms.security;

public record AuthenticatedUser(long id, String role, String email) {
}
