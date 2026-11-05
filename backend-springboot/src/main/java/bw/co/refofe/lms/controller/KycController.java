package bw.co.refofe.lms.controller;

import bw.co.refofe.lms.api.ApiException;
import bw.co.refofe.lms.config.AppProperties;
import bw.co.refofe.lms.security.AuthSupport;
import bw.co.refofe.lms.security.AuthenticatedUser;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/kyc")
public class KycController {
    private static final Set<String> DOCUMENT_TYPES =
            Set.of("national_id", "payslip", "proof_of_address", "spousal_consent", "bank_statement");
    private static final Set<String> MIME_TYPES =
            Set.of("application/pdf", "image/jpeg", "image/png");
    private final JdbcTemplate jdbc;
    private final AuthSupport authSupport;
    private final Path uploadRoot;

    public KycController(JdbcTemplate jdbc, AuthSupport authSupport, AppProperties properties) {
        this.jdbc = jdbc;
        this.authSupport = authSupport;
        this.uploadRoot = Path.of(properties.uploadDir()).toAbsolutePath().normalize();
    }

    @PostMapping("/documents")
    @Transactional
    public Map<String, Object> upload(
            HttpServletRequest request,
            @RequestParam String docType,
            @RequestParam(required = false) Long caseId,
            @RequestParam("file") MultipartFile file) throws IOException {
        AuthenticatedUser customer = authSupport.requireRole(request, "customer");
        if (!DOCUMENT_TYPES.contains(docType)) {
            throw ApiException.badRequest("docType must be one of: " + String.join(", ", DOCUMENT_TYPES));
        }
        if (file.isEmpty()) throw ApiException.badRequest("No file uploaded (field name must be 'file')");
        String contentType = file.getContentType();
        if (contentType == null || !MIME_TYPES.contains(contentType.toLowerCase(Locale.ROOT))) {
            throw ApiException.badRequest("Only PDF, JPEG, or PNG files are allowed");
        }
        String originalName = file.getOriginalFilename();
        if (originalName == null || originalName.isBlank()) throw ApiException.badRequest("Uploaded file must have a name");
        if (originalName.length() > 255) throw ApiException.badRequest("File name is too long");

        if (caseId != null) {
            requireCustomerCase(customer.id(), caseId);
            String caseStatus = jdbc.queryForObject("SELECT status FROM kyc_cases WHERE id = ?", String.class, caseId);
            if (!List.of("draft", "rejected").contains(caseStatus)) {
                throw ApiException.conflict("Documents can only be uploaded while KYC is a draft or needs corrections");
            }
        }
        Path customerDirectory = uploadRoot.resolve(Long.toString(customer.id())).normalize();
        if (!customerDirectory.startsWith(uploadRoot)) throw ApiException.badRequest("Invalid upload path");
        Files.createDirectories(customerDirectory);
        String safeOriginalName = Path.of(originalName).getFileName().toString().replaceAll("[^a-zA-Z0-9._-]", "_");
        Path destination = customerDirectory.resolve(UUID.randomUUID() + "-" + safeOriginalName).normalize();
        if (!destination.startsWith(customerDirectory)) throw ApiException.badRequest("Invalid upload path");
        Files.copy(file.getInputStream(), destination, StandardCopyOption.REPLACE_EXISTING);
        try {
            return jdbc.queryForMap("""
                    INSERT INTO documents (user_id, kyc_case_id, doc_type, file_path, original_name)
                    VALUES (?, ?, ?, ?, ?) RETURNING id, kyc_case_id, doc_type, status, original_name, uploaded_at
                    """, customer.id(), caseId, docType, destination.toString(), originalName);
        } catch (RuntimeException error) {
            Files.deleteIfExists(destination);
            throw error;
        }
    }

    @PostMapping("/cases")
    @Transactional
    public Map<String, Object> startCase(HttpServletRequest request) {
        AuthenticatedUser customer = authSupport.requireRole(request, "customer");
        List<Map<String, Object>> existing = jdbc.queryForList("""
                SELECT k.id
                FROM kyc_cases k
                WHERE k.user_id = ?
                ORDER BY k.created_at DESC LIMIT 1
                """, customer.id());
        Long caseId = null;
        if (!existing.isEmpty()) {
            long latestId = ((Number) existing.get(0).get("id")).longValue();
            Map<String, Object> latest = jdbc.queryForMap("""
                    SELECT k.status, EXISTS (
                        SELECT 1 FROM loan_applications a WHERE a.kyc_case_id = k.id
                    ) AS loan_created
                    FROM kyc_cases k WHERE k.id = ?
                    """, latestId);
            String status = String.valueOf(latest.get("status"));
            if (List.of("draft", "submitted", "under_review", "rejected").contains(status)
                    || ("approved".equals(status) && !Boolean.TRUE.equals(latest.get("loan_created")))) {
                caseId = latestId;
            }
        }
        if (caseId == null) {
            Map<String, Object> user = jdbc.queryForMap(
                    "SELECT marital_status FROM users WHERE id = ?", customer.id());
            caseId = jdbc.queryForObject("""
                    INSERT INTO kyc_cases (user_id, spousal_consent_required)
                    VALUES (?, ?) RETURNING id
                    """, Long.class, customer.id(),
                    "married_in_community".equals(user.get("marital_status")));
        }
        return caseForCustomer(customer.id(), caseId);
    }

    @GetMapping("/cases/mine")
    public List<Map<String, Object>> myCases(HttpServletRequest request) {
        AuthenticatedUser customer = authSupport.requireRole(request, "customer");
        List<Map<String, Object>> cases = jdbc.queryForList("""
                SELECT id FROM kyc_cases WHERE user_id = ? ORDER BY created_at DESC
                """, customer.id());
        return cases.stream().map(row -> caseForCustomer(customer.id(),
                ((Number) row.get("id")).longValue())).toList();
    }

    @GetMapping("/cases/mine/{id}")
    public Map<String, Object> myCase(HttpServletRequest request, @PathVariable long id) {
        AuthenticatedUser customer = authSupport.requireRole(request, "customer");
        requireCustomerCase(customer.id(), id);
        return caseForCustomer(customer.id(), id);
    }

    @PostMapping("/cases/{id}/submit")
    @Transactional
    public Map<String, Object> submitCase(HttpServletRequest request, @PathVariable long id) {
        AuthenticatedUser customer = authSupport.requireRole(request, "customer");
        Map<String, Object> kycCase = requireCustomerCase(customer.id(), id);
        if (!List.of("draft", "rejected").contains(kycCase.get("status"))) {
            throw ApiException.conflict("This KYC case is already submitted or approved");
        }
        if ("rejected".equals(kycCase.get("status")) && kycCase.get("reviewed_at") != null
                && !Boolean.TRUE.equals(jdbc.queryForObject("""
                    SELECT EXISTS (
                        SELECT 1 FROM documents
                        WHERE kyc_case_id = ? AND uploaded_at > ?
                    )
                    """, Boolean.class, id, kycCase.get("reviewed_at")))) {
            throw ApiException.badRequest("Upload a replacement document based on the review feedback before resubmitting");
        }
        List<String> requiredTypes = new java.util.ArrayList<>(
                List.of("national_id", "proof_of_address", "payslip", "bank_statement"));
        if (Boolean.TRUE.equals(kycCase.get("spousal_consent_required"))) {
            requiredTypes.add("spousal_consent");
        }
        List<Map<String, Object>> latestDocuments = jdbc.queryForList("""
                SELECT DISTINCT ON (doc_type) doc_type, status
                FROM documents WHERE kyc_case_id = ?
                ORDER BY doc_type, uploaded_at DESC, id DESC
                """, id);
        List<String> missing = new java.util.ArrayList<>(requiredTypes);
        for (Map<String, Object> document : latestDocuments) {
            if (!"rejected".equals(document.get("status"))) {
                missing.remove(document.get("doc_type"));
            }
        }
        if (!missing.isEmpty()) {
            throw ApiException.badRequest("Upload the required KYC documents before submitting: "
                    + String.join(", ", missing));
        }
        jdbc.update("""
                UPDATE kyc_cases SET status = 'submitted', submitted_at = now(),
                    reviewed_by = NULL, reviewed_at = NULL, rejection_reason = NULL
                WHERE id = ?
                """, id);
        jdbc.update("""
                INSERT INTO notifications
                  (user_id, channel, trigger_type, message, reference_type, reference_id)
                VALUES (?, 'in_app', 'kyc_submitted',
                        'Your KYC documents have been submitted for review.', 'kyc', ?)
                """, customer.id(), id);
        return caseForCustomer(customer.id(), id);
    }

    @GetMapping("/cases")
    public List<Map<String, Object>> staffCases(
            HttpServletRequest request, @RequestParam(required = false) String status) {
        authSupport.requireRole(request, "loan_officer", "admin");
        List<Map<String, Object>> rows;
        if (status == null || status.isBlank()) {
            rows = jdbc.queryForList("""
                    SELECT k.id, k.user_id FROM kyc_cases k
                    WHERE k.status IN ('submitted','under_review','rejected')
                    ORDER BY k.submitted_at DESC NULLS LAST, k.created_at DESC
                    """);
        } else {
            if (!List.of("submitted", "under_review", "approved", "rejected").contains(status)) {
                throw ApiException.badRequest("Unsupported KYC status");
            }
            rows = jdbc.queryForList("""
                    SELECT k.id, k.user_id FROM kyc_cases k
                    WHERE k.status = ? ORDER BY k.submitted_at DESC NULLS LAST, k.created_at DESC
                    """, status);
        }
        return rows.stream().map(row -> staffCase(
                ((Number) row.get("id")).longValue())).toList();
    }

    @PatchMapping("/cases/{id}/decision")
    @Transactional
    public Map<String, Object> decideCase(
            HttpServletRequest request, @PathVariable long id, @RequestBody Map<String, Object> body) {
        AuthenticatedUser reviewer = authSupport.requireRole(request, "loan_officer", "admin");
        String decision = body.get("decision") instanceof String text ? text : "";
        if (!List.of("approved", "rejected").contains(decision)) {
            throw ApiException.badRequest("decision must be 'approved' or 'rejected'");
        }
        String reason = body.get("reason") instanceof String text ? text.trim() : "";
        if (decision.equals("rejected") && reason.isEmpty()) {
            throw ApiException.badRequest("A reason is required when rejecting KYC");
        }
        if (reason.length() > 500) throw ApiException.badRequest("reason must be 500 characters or less");
        Map<String, Object> kycCase;
        try {
            kycCase = jdbc.queryForMap("SELECT * FROM kyc_cases WHERE id = ? FOR UPDATE", id);
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.notFound("KYC case not found");
        }
        if (!List.of("submitted", "under_review").contains(kycCase.get("status"))) {
            throw ApiException.conflict("Only submitted KYC cases can be decided");
        }
        if (decision.equals("approved")) {
            List<String> requiredTypes = new java.util.ArrayList<>(
                    List.of("national_id", "proof_of_address", "payslip", "bank_statement"));
            if (Boolean.TRUE.equals(kycCase.get("spousal_consent_required"))) {
                requiredTypes.add("spousal_consent");
            }
            List<Map<String, Object>> latestDocuments = jdbc.queryForList("""
                    SELECT DISTINCT ON (doc_type) doc_type, status
                    FROM documents WHERE kyc_case_id = ?
                    ORDER BY doc_type, uploaded_at DESC, id DESC
                    """, id);
            Map<String, String> states = new java.util.HashMap<>();
            for (Map<String, Object> document : latestDocuments) {
                states.put(String.valueOf(document.get("doc_type")), String.valueOf(document.get("status")));
            }
            List<String> unverified = requiredTypes.stream()
                    .filter(type -> !"verified".equals(states.get(type))).toList();
            if (!unverified.isEmpty()) {
                throw ApiException.conflict("Verify all required documents before approving KYC: "
                        + String.join(", ", unverified));
            }
        }
        jdbc.update("""
                UPDATE kyc_cases SET status = ?, reviewed_by = ?, reviewed_at = now(), rejection_reason = ?
                WHERE id = ?
                """, decision, reviewer.id(), decision.equals("rejected") ? reason : null, id);
        jdbc.update("""
                INSERT INTO notifications
                  (user_id, channel, trigger_type, message, reference_type, reference_id)
                VALUES (?, 'in_app', ?, ?, 'kyc', ?)
                """, kycCase.get("user_id"), "kyc_" + decision,
                decision.equals("approved")
                        ? "Your KYC has been approved. You can now complete your loan application."
                        : "Your KYC needs corrections: " + reason, id);
        return staffCase(id);
    }

    @GetMapping("/documents")
    public List<Map<String, Object>> myDocuments(HttpServletRequest request) {
        AuthenticatedUser customer = authSupport.requireRole(request, "customer");
        return documentsFor(customer.id());
    }

    @GetMapping("/documents/user/{userId}")
    public List<Map<String, Object>> userDocuments(HttpServletRequest request, @PathVariable long userId) {
        authSupport.requireRole(request, "loan_officer", "admin");
        return documentsFor(userId);
    }

    @GetMapping("/documents/{id}/file")
    public ResponseEntity<Resource> download(
            HttpServletRequest request, @PathVariable long id) throws IOException {
        AuthenticatedUser user = authSupport.requireUser(request);
        Map<String, Object> document;
        try {
            document = jdbc.queryForMap(
                    "SELECT user_id, file_path, original_name FROM documents WHERE id = ?", id);
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.notFound("Document not found");
        }
        long ownerId = ((Number) document.get("user_id")).longValue();
        if (user.role().equals("customer") && user.id() != ownerId) {
            throw ApiException.forbidden("You can only access your own documents");
        }
        if (!Set.of("customer", "loan_officer", "admin").contains(user.role())) {
            throw ApiException.forbidden("You are not allowed to access documents");
        }
        Path filePath = Path.of((String) document.get("file_path")).toAbsolutePath().normalize();
        if (!filePath.startsWith(uploadRoot)) throw ApiException.notFound("Document file not found");
        if (!Files.isRegularFile(filePath)) throw ApiException.notFound("Document file not found");

        String contentType = Files.probeContentType(filePath);
        MediaType mediaType = contentType == null ? MediaType.APPLICATION_OCTET_STREAM : MediaType.parseMediaType(contentType);
        Resource resource = new FileSystemResource(filePath);
        return ResponseEntity.ok()
                .contentType(mediaType)
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename((String) document.get("original_name"))
                        .build().toString())
                .body(resource);
    }

    @PatchMapping("/documents/{id}/status")
    @Transactional
    public Map<String, Object> reviewDocument(
            HttpServletRequest request, @PathVariable long id, @RequestBody Map<String, Object> body) {
        AuthenticatedUser reviewer = authSupport.requireRole(request, "loan_officer", "admin");
        String status = body.get("status") instanceof String text ? text : "";
        if (!List.of("verified", "rejected").contains(status)) {
            throw ApiException.badRequest("status must be 'verified' or 'rejected'");
        }
        String reason = body.get("rejectionReason") instanceof String text ? text.trim() : "";
        if (status.equals("rejected") && reason.isEmpty()) {
            throw ApiException.badRequest("rejectionReason is required when rejecting a document");
        }
        if (reason.length() > 500) throw ApiException.badRequest("rejectionReason must be 500 characters or less");
        try {
            Map<String, Object> reviewedDocument = jdbc.queryForMap("""
                    UPDATE documents
                    SET status = ?, verified_by = ?, verified_at = now(), rejection_reason = ?
                    WHERE id = ? AND status = 'pending'
                      AND (kyc_case_id IS NULL OR EXISTS (
                          SELECT 1 FROM kyc_cases k
                          WHERE k.id = documents.kyc_case_id AND k.status IN ('submitted','under_review')
                      ))
                    RETURNING *
                    """, status, reviewer.id(), status.equals("rejected") ? reason : null, id);
            if (status.equals("rejected") && reviewedDocument.get("kyc_case_id") != null) {
                jdbc.update("""
                        UPDATE kyc_cases
                        SET status = 'rejected', reviewed_by = ?, reviewed_at = now(), rejection_reason = ?
                        WHERE id = ? AND status IN ('submitted','under_review')
                        """, reviewer.id(), reason, reviewedDocument.get("kyc_case_id"));
            }
            return reviewedDocument;
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.conflict("Only pending documents on an active KYC case can be reviewed");
        }
    }

    private List<Map<String, Object>> documentsFor(long userId) {
        return jdbc.queryForList("""
                SELECT id, doc_type, status, original_name, rejection_reason, uploaded_at
                FROM documents WHERE user_id = ? ORDER BY uploaded_at DESC
                """, userId);
    }

    private Map<String, Object> requireCustomerCase(long userId, long caseId) {
        try {
            return jdbc.queryForMap("SELECT * FROM kyc_cases WHERE id = ? AND user_id = ?", caseId, userId);
        } catch (org.springframework.dao.EmptyResultDataAccessException error) {
            throw ApiException.notFound("KYC case not found");
        }
    }

    private Map<String, Object> caseForCustomer(long userId, long caseId) {
        Map<String, Object> kycCase = requireCustomerCase(userId, caseId);
        kycCase.put("documents", jdbc.queryForList("""
                SELECT id, kyc_case_id, doc_type, status, original_name, rejection_reason, uploaded_at
                FROM documents WHERE kyc_case_id = ? ORDER BY uploaded_at DESC
                """, caseId));
        return kycCase;
    }

    private Map<String, Object> staffCase(long caseId) {
        Map<String, Object> kycCase = jdbc.queryForMap("""
                SELECT k.*, u.full_name AS applicant_name, u.email AS applicant_email,
                       u.phone AS applicant_phone
                FROM kyc_cases k JOIN users u ON u.id = k.user_id
                WHERE k.id = ?
                """, caseId);
        kycCase.put("documents", jdbc.queryForList("""
                SELECT id, kyc_case_id, doc_type, status, original_name, rejection_reason, uploaded_at
                FROM documents WHERE kyc_case_id = ? ORDER BY uploaded_at DESC
                """, caseId));
        return kycCase;
    }
}
