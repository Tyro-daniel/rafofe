package bw.co.refofe.lms.service;

import bw.co.refofe.lms.config.AppProperties;
import java.io.UnsupportedEncodingException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import jakarta.mail.internet.InternetAddress;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

@Service
public class EmailService {
    private final JdbcTemplate jdbc;
    private final AppProperties properties;
    private final ObjectProvider<JavaMailSender> mailSender;
    private final String mailHost;
    private final boolean devEmailLinks;
    private final String fromAddress;
    private final String fromDisplayName;

    public EmailService(
            JdbcTemplate jdbc,
            AppProperties properties,
            ObjectProvider<JavaMailSender> mailSender,
            @Value("${spring.mail.host:}") String mailHost,
            @Value("${app.dev-email-links:false}") boolean devEmailLinks,
            @Value("${MAIL_FROM:no-reply@localhost}") String fromAddress,
            @Value("${MAIL_FROM_NAME:Refofe Novelty}") String fromDisplayName) {
        this.jdbc = jdbc;
        this.properties = properties;
        this.mailSender = mailSender;
        this.mailHost = mailHost;
        this.devEmailLinks = devEmailLinks;
        this.fromAddress = fromAddress;
        this.fromDisplayName = fromDisplayName;
    }

    public void sendAccountLink(Map<String, Object> user, String eventType, String token) {
        String action = eventType.equals("email_verification") ? "verify-email" : "reset-password";
        String url = properties.frontendUrl() + "/" + action + "?token=" + token;
        String subject = eventType.equals("email_verification") ? "Verify your email address" : "Reset your password";
        String body = "Hello " + user.get("full_name") + ",\n\nOpen this link to continue:\n" + url
                + "\n\nIf you did not request this, you can ignore this email.";
        String status = "queued";
        String errorMessage = null;

        if (!mailHost.isBlank()) {
            try {
                JavaMailSender sender = mailSender.getObject();
                SimpleMailMessage message = new SimpleMailMessage();
                message.setFrom(formattedFromAddress());
                message.setTo(String.valueOf(user.get("email")));
                message.setSubject(subject);
                message.setText(body);
                sender.send(message);
                status = "sent";
            } catch (RuntimeException error) {
                status = "failed";
                errorMessage = error.getMessage();
            }
        } else if (devEmailLinks) {
            System.out.println("LOCAL-ONLY " + eventType + " link for " + user.get("email") + ": " + url);
            status = "sent";
        }

        jdbc.update(
                """
                INSERT INTO email_log (user_id, recipient_email, recipient_name, event_type, subject, status, error_message, sent_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'sent' THEN now() ELSE NULL END)
                """,
                user.get("id"), user.get("email"), user.get("full_name"), eventType, subject,
                status, errorMessage, status);
    }

    public boolean sendVerificationCode(Map<String, Object> user, String code) {
        String subject = "Your Refofe Novelty verification code";
        String body = "Hello " + user.get("full_name") + ",\n\n"
                + "Your email verification code is " + code + ".\n"
                + "It expires in 10 minutes and can only be used once.\n\n"
                + "If you did not create this account, you can ignore this email.";
        String status = "queued";
        String errorMessage = null;

        if (!mailHost.isBlank()) {
            try {
                JavaMailSender sender = mailSender.getObject();
                SimpleMailMessage message = new SimpleMailMessage();
                message.setFrom(formattedFromAddress());
                message.setTo(String.valueOf(user.get("email")));
                message.setSubject(subject);
                message.setText(body);
                sender.send(message);
                status = "sent";
            } catch (RuntimeException error) {
                status = "failed";
                errorMessage = error.getMessage();
            }
        } else if (devEmailLinks) {
            System.out.println("LOCAL-ONLY email verification code for " + user.get("email") + ": " + code);
            status = "sent";
        }

        jdbc.update(
                """
                INSERT INTO email_log (user_id, recipient_email, recipient_name, event_type, subject, status, error_message, sent_at)
                VALUES (?, ?, ?, 'email_verification', ?, ?, ?, CASE WHEN ? = 'sent' THEN now() ELSE NULL END)
                """,
                user.get("id"), user.get("email"), user.get("full_name"), subject, status, errorMessage, status);
        return status.equals("sent");
    }

    public boolean sendPasswordResetCode(Map<String, Object> user, String code) {
        String subject = "Your Refofe Novelty password reset code";
        String body = "Hello " + user.get("full_name") + ",\n\n"
                + "Your password reset code is " + code + ".\n"
                + "It expires in 10 minutes and can only be used once.\n\n"
                + "If you did not request a password reset, you can ignore this email.";
        String status = "queued";
        String errorMessage = null;

        if (!mailHost.isBlank()) {
            try {
                JavaMailSender sender = mailSender.getObject();
                SimpleMailMessage message = new SimpleMailMessage();
                message.setFrom(formattedFromAddress());
                message.setTo(String.valueOf(user.get("email")));
                message.setSubject(subject);
                message.setText(body);
                sender.send(message);
                status = "sent";
            } catch (RuntimeException error) {
                status = "failed";
                errorMessage = error.getMessage();
            }
        } else if (devEmailLinks) {
            System.out.println("LOCAL-ONLY password reset code for " + user.get("email") + ": " + code);
            status = "sent";
        }

        jdbc.update(
                """
                INSERT INTO email_log (user_id, recipient_email, recipient_name, event_type, subject, status, error_message, sent_at)
                VALUES (?, ?, ?, 'password_reset_requested', ?, ?, ?, CASE WHEN ? = 'sent' THEN now() ELSE NULL END)
                """,
                user.get("id"), user.get("email"), user.get("full_name"), subject, status, errorMessage, status);
        return status.equals("sent");
    }

    public boolean sendLoanNotification(
            Map<String, Object> user, String eventType, String subject, String body, long loanId) {
        String status = "queued";
        String errorMessage = null;

        if (!mailHost.isBlank()) {
            try {
                JavaMailSender sender = mailSender.getObject();
                SimpleMailMessage message = new SimpleMailMessage();
                message.setFrom(formattedFromAddress());
                message.setTo(String.valueOf(user.get("email")));
                message.setSubject(subject);
                message.setText(body);
                sender.send(message);
                status = "sent";
            } catch (RuntimeException error) {
                status = "failed";
                errorMessage = error.getMessage();
            }
        } else if (devEmailLinks) {
            System.out.println("LOCAL-ONLY " + eventType + " email for " + user.get("email") + ":\n" + body);
            status = "sent";
        } else {
            status = "failed";
            errorMessage = "Email delivery is not configured";
        }

        jdbc.update(
                """
                INSERT INTO email_log
                  (user_id, recipient_email, recipient_name, event_type, subject,
                   related_entity_type, related_entity_id, status, error_message, sent_at)
                VALUES (?, ?, ?, ?, ?, 'loan_account', ?, ?, ?, CASE WHEN ? = 'sent' THEN now() ELSE NULL END)
                """,
                user.get("id"), user.get("email"), user.get("full_name"), eventType, subject,
                loanId, status, errorMessage, status);
        return status.equals("sent");
    }

    private String formattedFromAddress() {
        try {
            return new InternetAddress(fromAddress, fromDisplayName, StandardCharsets.UTF_8.name()).toString();
        } catch (UnsupportedEncodingException error) {
            throw new IllegalStateException("Unable to encode the email sender display name.", error);
        }
    }
}
