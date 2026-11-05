package bw.co.refofe.lms.controller;

import bw.co.refofe.lms.api.ApiException;
import bw.co.refofe.lms.security.AuthSupport;
import bw.co.refofe.lms.security.AuthenticatedUser;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/messages")
public class MessagingController {
    private static final int MAX_ATTACHMENTS = 3;
    private static final long MAX_ATTACHMENT_SIZE = 8L * 1024 * 1024;
    private static final Map<String, String> ATTACHMENT_TYPES = Map.ofEntries(
            Map.entry("jpg", "image/jpeg"),
            Map.entry("jpeg", "image/jpeg"),
            Map.entry("png", "image/png"),
            Map.entry("gif", "image/gif"),
            Map.entry("webp", "image/webp"),
            Map.entry("pdf", "application/pdf"),
            Map.entry("txt", "text/plain"),
            Map.entry("doc", "application/msword"),
            Map.entry("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            Map.entry("xls", "application/vnd.ms-excel"),
            Map.entry("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            Map.entry("ppt", "application/vnd.ms-powerpoint"),
            Map.entry("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"));
    private final JdbcTemplate jdbc;
    private final AuthSupport authSupport;
    private final Path uploadRoot;

    public MessagingController(JdbcTemplate jdbc, AuthSupport authSupport,
            bw.co.refofe.lms.config.AppProperties properties) {
        this.jdbc = jdbc;
        this.authSupport = authSupport;
        this.uploadRoot = Path.of(properties.uploadDir()).toAbsolutePath().normalize().resolve("messages");
    }

    @GetMapping("/recipients")
    public List<Map<String, Object>> recipients(HttpServletRequest request) {
        AuthenticatedUser sender = requireSender(request);
        String role = "admin".equals(sender.role()) ? "loan_officer" : "customer";
        return jdbc.queryForList("""
                SELECT id, full_name AS "fullName", email, role
                FROM users
                WHERE role = ? AND is_active = TRUE AND id != ?
                ORDER BY full_name, id
                """, role, sender.id());
    }

    @PostMapping("/presence")
    public void updatePresence(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        AuthenticatedUser user = authSupport.requireRole(request, "customer", "loan_officer", "admin");
        if (!(body.get("online") instanceof Boolean online)) {
            throw ApiException.badRequest("online must be true or false");
        }
        jdbc.update("""
                INSERT INTO user_presence (user_id, is_online, last_seen_at)
                VALUES (?, ?, now())
                ON CONFLICT (user_id) DO UPDATE
                SET is_online = EXCLUDED.is_online, last_seen_at = EXCLUDED.last_seen_at
                """, user.id(), online);
    }

    @PostMapping("/direct/{recipientId}")
    @Transactional
    public Map<String, Object> openDirectThread(
            HttpServletRequest request, @PathVariable long recipientId) {
        AuthenticatedUser sender = requireSender(request);
        String recipientRole = "admin".equals(sender.role()) ? "loan_officer" : "customer";
        List<String> recipients = jdbc.queryForList("""
                SELECT full_name FROM users
                WHERE id = ? AND role = ? AND is_active = TRUE AND id != ?
                """, String.class, recipientId, recipientRole, sender.id());
        if (recipients.isEmpty()) {
            throw ApiException.badRequest("The selected person is unavailable");
        }

        List<Long> existing = jdbc.queryForList("""
                SELECT t.id FROM message_threads t
                WHERE t.is_broadcast = FALSE AND t.audience_role = ?
                  AND EXISTS (SELECT 1 FROM message_participants p WHERE p.thread_id = t.id AND p.user_id = ?)
                  AND EXISTS (SELECT 1 FROM message_participants p WHERE p.thread_id = t.id AND p.user_id = ?)
                  AND (SELECT COUNT(*) FROM message_participants p WHERE p.thread_id = t.id) = 2
                ORDER BY t.updated_at DESC, t.id DESC LIMIT 1
                """, Long.class, recipientRole, sender.id(), recipientId);
        if (!existing.isEmpty()) {
            return Map.of("threadId", existing.getFirst());
        }

        Long threadId = jdbc.queryForObject("""
                INSERT INTO message_threads (subject, audience_role, is_broadcast, created_by)
                VALUES (?, ?, FALSE, ?) RETURNING id
                """, Long.class, recipients.getFirst(), recipientRole, sender.id());
        jdbc.update("INSERT INTO message_participants (thread_id, user_id, last_read_at) VALUES (?, ?, now())",
                threadId, sender.id());
        jdbc.update("INSERT INTO message_participants (thread_id, user_id) VALUES (?, ?)",
                threadId, recipientId);
        return Map.of("threadId", threadId);
    }

    @GetMapping
    public List<Map<String, Object>> inbox(HttpServletRequest request) {
        AuthenticatedUser user = authSupport.requireRole(request, "customer", "loan_officer", "admin");
        return jdbc.queryForList("""
                SELECT t.id, t.subject, t.audience_role AS "audienceRole", t.is_broadcast AS "isBroadcast",
                       t.created_by AS "createdBy", t.created_at AS "createdAt", t.updated_at AS "updatedAt",
                       last_message.body AS "lastMessage", last_message.created_at AS "lastMessageAt",
                       last_message.sender_name AS "lastSenderName",
                       (SELECT COUNT(*) FROM messages unread
                        WHERE unread.thread_id = t.id
                          AND unread.sender_id != ?
                          AND unread.created_at > COALESCE(mp.last_read_at, TIMESTAMPTZ 'epoch')) AS "unreadCount",
                       (SELECT string_agg(member.full_name, ', ' ORDER BY member.full_name)
                        FROM message_participants others
                        JOIN users member ON member.id = others.user_id
                        WHERE others.thread_id = t.id AND others.user_id != ?) AS "participants"
                FROM message_participants mp
                JOIN message_threads t ON t.id = mp.thread_id
                LEFT JOIN LATERAL (
                    SELECT m.body, m.created_at, u.full_name AS sender_name
                    FROM messages m JOIN users u ON u.id = m.sender_id
                    WHERE m.thread_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1
                ) last_message ON TRUE
                WHERE mp.user_id = ?
                ORDER BY t.updated_at DESC, t.id DESC
                """, user.id(), user.id(), user.id());
    }

    @GetMapping("/{threadId:\\d+}")
    @Transactional
    public Map<String, Object> thread(HttpServletRequest request, @PathVariable long threadId) {
        AuthenticatedUser user = authSupport.requireRole(request, "customer", "loan_officer", "admin");
        ensureParticipant(threadId, user.id());
        jdbc.update("""
                UPDATE message_participants SET last_read_at = now()
                WHERE thread_id = ? AND user_id = ?
                """, threadId, user.id());
        Map<String, Object> result = jdbc.queryForMap("""
                SELECT t.id, t.subject, t.audience_role AS "audienceRole", t.is_broadcast AS "isBroadcast",
                       t.created_by AS "createdBy", t.created_at AS "createdAt", t.updated_at AS "updatedAt"
                FROM message_threads t WHERE t.id = ?
                """, threadId);
        result.put("participants", jdbc.queryForList("""
                SELECT u.id, u.full_name AS "fullName", u.email, u.role
                FROM message_participants p JOIN users u ON u.id = p.user_id
                WHERE p.thread_id = ? ORDER BY CASE WHEN u.id = ? THEN 0 ELSE 1 END, u.full_name
                """, threadId, user.id()));
        List<Map<String, Object>> messages = jdbc.queryForList("""
                SELECT m.id, m.thread_id AS "threadId", m.sender_id AS "senderId",
                       u.full_name AS "senderName", u.role AS "senderRole", m.body,
                       m.created_at AS "createdAt",
                       CASE
                         WHEN m.sender_id != ? THEN NULL
                         WHEN delivery.total_recipients > 0
                           AND delivery.read_recipients = delivery.total_recipients THEN 'read'
                         WHEN COALESCE(delivery.total_recipients, 0) = 0
                           OR delivery.online_recipients = 0 THEN 'sent'
                         ELSE 'delivered'
                       END AS "deliveryStatus"
                FROM messages m
                JOIN users u ON u.id = m.sender_id
                LEFT JOIN LATERAL (
                    SELECT COUNT(*) AS total_recipients,
                           COUNT(*) FILTER (WHERE recipient.last_read_at >= m.created_at) AS read_recipients,
                           COUNT(*) FILTER (
                               WHERE presence.is_online = TRUE
                                 AND presence.last_seen_at > now() - INTERVAL '45 seconds'
                           ) AS online_recipients
                    FROM message_participants recipient
                    LEFT JOIN user_presence presence ON presence.user_id = recipient.user_id
                    WHERE recipient.thread_id = m.thread_id
                      AND recipient.user_id != m.sender_id
                ) delivery ON TRUE
                WHERE m.thread_id = ? ORDER BY m.created_at, m.id
                """, user.id(), threadId);
        for (Map<String, Object> message : messages) {
            message.put("attachments", jdbc.queryForList("""
                    SELECT id, original_name AS "originalName", content_type AS "contentType",
                           size_bytes AS "sizeBytes"
                    FROM message_attachments WHERE message_id = ? ORDER BY id
                    """, message.get("id")));
        }
        result.put("messages", messages);
        return result;
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    @Transactional
    public Map<String, Object> createThread(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        AuthenticatedUser sender = requireSender(request);
        String subject = body.get("subject") instanceof String value ? value.trim() : "";
        String message = requiredString(body, "message");
        if (subject.length() > 200) throw ApiException.badRequest("Subject must be 200 characters or fewer");
        validateMessage(message);

        Object allValue = body.getOrDefault("allRecipients", Boolean.FALSE);
        if (!(allValue instanceof Boolean allRecipients)) {
            throw ApiException.badRequest("allRecipients must be true or false");
        }
        if (allRecipients && !"admin".equals(sender.role())) {
            throw ApiException.forbidden("Only administrators can send group broadcasts");
        }
        LinkedHashSet<Long> recipientIds = new LinkedHashSet<>();
        if (!allRecipients) {
            Object rawIds = body.get("recipientIds");
            if (!(rawIds instanceof List<?> ids)) throw ApiException.badRequest("Select at least one recipient");
            for (Object value : ids) {
                if (!(value instanceof Number number) || number.doubleValue() != number.longValue()
                        || number.longValue() <= 0 || number.longValue() > Integer.MAX_VALUE) {
                    throw ApiException.badRequest("Recipient ids must be positive numbers");
                }
                recipientIds.add(number.longValue());
            }
            if (recipientIds.isEmpty()) throw ApiException.badRequest("Select at least one recipient");
            if (recipientIds.size() > 500) throw ApiException.badRequest("A message can have at most 500 recipients");
        }

        String recipientRole = "admin".equals(sender.role()) ? "loan_officer" : "customer";
        List<Long> validatedIds;
        if (allRecipients) {
            validatedIds = jdbc.queryForList(
                    "SELECT id FROM users WHERE role = ? AND is_active = TRUE AND id != ? ORDER BY id",
                    Long.class, recipientRole, sender.id());
        } else {
            List<Long> requestedIds = new ArrayList<>(recipientIds);
            String placeholders = String.join(",", java.util.Collections.nCopies(requestedIds.size(), "?"));
            List<Object> parameters = new ArrayList<>();
            requestedIds.forEach(id -> parameters.add(Math.toIntExact(id)));
            parameters.add(recipientRole);
            parameters.add(sender.id());
            String sql = "SELECT id FROM users WHERE id IN (" + placeholders
                    + ") AND role = ? AND is_active = TRUE AND id != ? ORDER BY id";
            validatedIds = jdbc.queryForList(sql, Long.class, parameters.toArray());
            if (validatedIds.size() != recipientIds.size()) {
                throw ApiException.badRequest("One or more selected recipients are unavailable");
            }
        }
        if (validatedIds.isEmpty()) throw ApiException.badRequest("There are no active recipients for this message");

        boolean broadcast = allRecipients || validatedIds.size() > 1;
        if (broadcast) {
            if (!"admin".equals(sender.role())) {
                throw ApiException.forbidden("Only administrators can send group broadcasts");
            }
            if (subject.isBlank()) subject = "Group broadcast";
            Long threadId = jdbc.queryForObject("""
                    INSERT INTO message_threads (subject, audience_role, is_broadcast, created_by)
                    VALUES (?, ?, TRUE, ?) RETURNING id
                    """, Long.class, subject, recipientRole, sender.id());
            jdbc.update("INSERT INTO message_participants (thread_id, user_id, last_read_at) VALUES (?, ?, now())",
                    threadId, sender.id());
            for (Long recipientId : validatedIds) {
                jdbc.update("INSERT INTO message_participants (thread_id, user_id) VALUES (?, ?)",
                        threadId, recipientId);
            }
            Long messageId = jdbc.queryForObject(
                    "INSERT INTO messages (thread_id, sender_id, body) VALUES (?, ?, ?) RETURNING id",
                    Long.class, threadId, sender.id(), message);
            return Map.of("threadIds", List.of(threadId), "messageIds", List.of(messageId),
                    "subject", subject, "recipientCount", validatedIds.size());
        }

        Long recipientId = validatedIds.getFirst();
        String recipientName = jdbc.queryForObject(
                "SELECT full_name FROM users WHERE id = ?", String.class, recipientId);
        List<Long> existing = jdbc.queryForList("""
                SELECT t.id FROM message_threads t
                WHERE t.is_broadcast = FALSE AND t.audience_role = ?
                  AND EXISTS (SELECT 1 FROM message_participants p WHERE p.thread_id = t.id AND p.user_id = ?)
                  AND EXISTS (SELECT 1 FROM message_participants p WHERE p.thread_id = t.id AND p.user_id = ?)
                  AND (SELECT COUNT(*) FROM message_participants p WHERE p.thread_id = t.id) = 2
                ORDER BY t.updated_at DESC, t.id DESC LIMIT 1 FOR UPDATE
                """, Long.class, recipientRole, sender.id(), recipientId);
        Long threadId;
        if (!existing.isEmpty()) {
            threadId = existing.getFirst();
            jdbc.update("UPDATE message_threads SET updated_at = now() WHERE id = ?", threadId);
        } else {
            threadId = jdbc.queryForObject("""
                    INSERT INTO message_threads (subject, audience_role, is_broadcast, created_by)
                    VALUES (?, ?, FALSE, ?) RETURNING id
                    """, Long.class, recipientName, recipientRole, sender.id());
            jdbc.update("INSERT INTO message_participants (thread_id, user_id, last_read_at) VALUES (?, ?, now())",
                    threadId, sender.id());
            jdbc.update("INSERT INTO message_participants (thread_id, user_id) VALUES (?, ?)",
                    threadId, recipientId);
        }
        Long messageId = jdbc.queryForObject(
                "INSERT INTO messages (thread_id, sender_id, body) VALUES (?, ?, ?) RETURNING id",
                Long.class, threadId, sender.id(), message);
        return Map.of("threadIds", List.of(threadId), "messageIds", List.of(messageId),
                "subject", recipientName, "recipientCount", 1);
    }

    @PostMapping(path = "/{threadId}/reply", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Transactional
    public Map<String, Object> reply(
            HttpServletRequest request, @PathVariable long threadId, @RequestBody Map<String, Object> body) {
        AuthenticatedUser sender = authSupport.requireRole(request, "customer", "loan_officer", "admin");
        String message = requiredString(body, "message");
        validateMessage(message);
        ensureParticipant(threadId, sender.id());
        Map<String, Object> thread = jdbc.queryForMap(
                "SELECT is_broadcast, created_by AS \"createdBy\" FROM message_threads WHERE id = ?", threadId);
        if (Boolean.TRUE.equals(thread.get("is_broadcast"))
                && ((Number) thread.get("createdBy")).longValue() != sender.id()) {
            throw ApiException.forbidden("Only the broadcast sender can post updates to this conversation");
        }
        Long messageId = jdbc.queryForObject("""
                INSERT INTO messages (thread_id, sender_id, body) VALUES (?, ?, ?) RETURNING id
                """, Long.class, threadId, sender.id(), message);
        jdbc.update("UPDATE message_threads SET updated_at = now() WHERE id = ?", threadId);
        jdbc.update("UPDATE message_participants SET last_read_at = now() WHERE thread_id = ? AND user_id = ?",
                threadId, sender.id());
        return Map.of("id", messageId, "threadId", threadId);
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Transactional
    public Map<String, Object> createThreadWithAttachments(
            HttpServletRequest request,
            @RequestParam String subject,
            @RequestParam(required = false) String message,
            @RequestParam(required = false) List<Long> recipientIds,
            @RequestParam(defaultValue = "false") boolean allRecipients,
            @RequestParam(name = "files", required = false) List<MultipartFile> files) throws IOException {
        validateAttachments(files);
        if ((message == null || message.isBlank()) && (files == null || files.isEmpty())) {
            throw ApiException.badRequest("Write a message or attach a file");
        }
        Map<String, Object> requestBody = new java.util.HashMap<>();
        requestBody.put("subject", subject);
        requestBody.put("message", message == null || message.isBlank() ? attachmentSummary(files) : message);
        requestBody.put("recipientIds", recipientIds == null ? List.of() : recipientIds);
        requestBody.put("allRecipients", allRecipients);
        Map<String, Object> created = createThread(request, requestBody);
        long messageId = ((Number) ((List<?>) created.get("messageIds")).getFirst()).longValue();
        saveAttachments(messageId, files);
        return created;
    }

    @PostMapping(path = "/{threadId}/reply", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Transactional
    public Map<String, Object> replyWithAttachments(
            HttpServletRequest request,
            @PathVariable long threadId,
            @RequestParam(required = false) String message,
            @RequestParam(name = "files", required = false) List<MultipartFile> files) throws IOException {
        AuthenticatedUser sender = authSupport.requireRole(request, "customer", "loan_officer", "admin");
        validateAttachments(files);
        String body = message == null ? "" : message.trim();
        if (body.isEmpty() && (files == null || files.isEmpty())) {
            throw ApiException.badRequest("Write a message or attach a file");
        }
        ensureParticipant(threadId, sender.id());
        Map<String, Object> thread = jdbc.queryForMap(
                "SELECT is_broadcast, created_by AS \"createdBy\" FROM message_threads WHERE id = ?", threadId);
        if (Boolean.TRUE.equals(thread.get("is_broadcast"))
                && ((Number) thread.get("createdBy")).longValue() != sender.id()) {
            throw ApiException.forbidden("Only the broadcast sender can post updates to this conversation");
        }
        Long messageId = jdbc.queryForObject("""
                INSERT INTO messages (thread_id, sender_id, body) VALUES (?, ?, ?) RETURNING id
                """, Long.class, threadId, sender.id(), body.isEmpty() ? attachmentSummary(files) : body);
        saveAttachments(messageId, files);
        jdbc.update("UPDATE message_threads SET updated_at = now() WHERE id = ?", threadId);
        jdbc.update("UPDATE message_participants SET last_read_at = now() WHERE thread_id = ? AND user_id = ?",
                threadId, sender.id());
        return Map.of("id", messageId, "threadId", threadId);
    }

    @GetMapping("/attachments/{attachmentId}/file")
    public ResponseEntity<Resource> downloadAttachment(
            HttpServletRequest request, @PathVariable long attachmentId) throws IOException {
        AuthenticatedUser user = authSupport.requireRole(request, "customer", "loan_officer", "admin");
        Map<String, Object> attachment;
        try {
            attachment = jdbc.queryForMap("""
                    SELECT a.file_path AS "filePath", a.original_name AS "originalName",
                           a.content_type AS "contentType", m.thread_id AS "threadId"
                    FROM message_attachments a JOIN messages m ON m.id = a.message_id
                    WHERE a.id = ?
                    """, attachmentId);
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.notFound("Message attachment not found");
        }
        ensureParticipant(((Number) attachment.get("threadId")).longValue(), user.id());
        Path filePath = Path.of((String) attachment.get("filePath")).toAbsolutePath().normalize();
        if (!filePath.startsWith(uploadRoot) || !Files.isRegularFile(filePath)) {
            throw ApiException.notFound("Message attachment file not found");
        }
        Resource resource = new FileSystemResource(filePath);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType((String) attachment.get("contentType")))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename((String) attachment.get("originalName")).build().toString())
                .body(resource);
    }

    private void saveAttachments(long messageId, List<MultipartFile> files) throws IOException {
        if (files == null || files.isEmpty()) return;
        Map<String, Object> message = jdbc.queryForMap(
                "SELECT thread_id AS \"threadId\" FROM messages WHERE id = ?", messageId);
        Path threadDirectory = uploadRoot.resolve(String.valueOf(message.get("threadId"))).normalize();
        if (!threadDirectory.startsWith(uploadRoot)) throw ApiException.badRequest("Invalid attachment path");
        Files.createDirectories(threadDirectory);
        List<Path> savedFiles = new ArrayList<>();
        try {
            for (MultipartFile file : files) {
                String originalName = file.getOriginalFilename();
                String extension = extension(originalName);
                String expectedType = ATTACHMENT_TYPES.get(extension);
                String suppliedType = file.getContentType();
                if (!expectedType.equalsIgnoreCase(suppliedType == null ? "" : suppliedType)) {
                    throw ApiException.badRequest("The file type does not match its filename");
                }
                String safeName = Path.of(originalName).getFileName().toString()
                        .replaceAll("[^a-zA-Z0-9._-]", "_");
                Path destination = threadDirectory.resolve(UUID.randomUUID() + "-" + safeName).normalize();
                if (!destination.startsWith(threadDirectory)) throw ApiException.badRequest("Invalid attachment path");
                Files.copy(file.getInputStream(), destination, StandardCopyOption.REPLACE_EXISTING);
                savedFiles.add(destination);
                jdbc.update("""
                        INSERT INTO message_attachments
                          (message_id, original_name, file_path, content_type, size_bytes)
                        VALUES (?, ?, ?, ?, ?)
                        """, messageId, originalName, destination.toString(), expectedType, file.getSize());
            }
        } catch (IOException | RuntimeException error) {
            for (Path savedFile : savedFiles) {
                try {
                    Files.deleteIfExists(savedFile);
                } catch (IOException cleanupError) {
                    error.addSuppressed(cleanupError);
                }
            }
            throw error;
        }
    }

    private static void validateAttachments(List<MultipartFile> files) {
        if (files == null || files.isEmpty()) return;
        if (files.size() > MAX_ATTACHMENTS) {
            throw ApiException.badRequest("A message can include at most " + MAX_ATTACHMENTS + " files");
        }
        for (MultipartFile file : files) {
            if (file.isEmpty()) throw ApiException.badRequest("An attached file is empty");
            if (file.getSize() > MAX_ATTACHMENT_SIZE) {
                throw ApiException.badRequest("Each attachment must be 8 MB or smaller");
            }
            String name = file.getOriginalFilename();
            if (name == null || name.isBlank() || name.length() > 255 || !ATTACHMENT_TYPES.containsKey(extension(name))) {
                throw ApiException.badRequest("Attach an image, PDF, text, Word, Excel, or PowerPoint file");
            }
        }
    }

    private static String extension(String name) {
        if (name == null) return "";
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    private static String attachmentSummary(List<MultipartFile> files) {
        return files.stream().allMatch(file -> file.getContentType() != null
                && file.getContentType().startsWith("image/")) ? "📷 Photo" : "📎 Attachment";
    }

    private AuthenticatedUser requireSender(HttpServletRequest request) {
        return authSupport.requireRole(request, "loan_officer", "admin");
    }

    private void ensureParticipant(long threadId, long userId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM message_participants WHERE thread_id = ? AND user_id = ?",
                Integer.class, threadId, userId);
        if (count == null || count == 0) throw ApiException.notFound("Message thread not found");
    }

    private static String requiredString(Map<String, Object> body, String key) {
        if (!(body.get(key) instanceof String value) || value.isBlank()) {
            throw ApiException.badRequest(key + " is required");
        }
        return value.trim();
    }

    private static void validateMessage(String message) {
        if (message.length() > 10000) throw ApiException.badRequest("Message must be 10,000 characters or fewer");
    }
}
