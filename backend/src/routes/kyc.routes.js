const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { query, withTransaction } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { logAudit } = require("../middleware/audit");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

const UPLOAD_ROOT = path.join(__dirname, "..", "..", "uploads");

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(UPLOAD_ROOT, String(req.user.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Only PDF, JPEG, or PNG files are allowed"));
    }
    cb(null, true);
  },
});

const VALID_DOC_TYPES = ["national_id", "payslip", "proof_of_address", "spousal_consent"];

router.post(
  "/documents",
  requireAuth,
  requireRole("customer"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const { docType } = req.body;
    if (!VALID_DOC_TYPES.includes(docType)) {
      return res.status(400).json({ error: `docType must be one of: ${VALID_DOC_TYPES.join(", ")}` });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded (field name must be 'file')" });
    }

    const result = await query(
      `INSERT INTO documents (user_id, doc_type, file_path, original_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, doc_type, status, original_name, uploaded_at`,
      [req.user.id, docType, req.file.path, req.file.originalname]
    );

    res.status(201).json(result.rows[0]);
  })
);

router.get(
  "/documents",
  requireAuth,
  requireRole("customer"),
  asyncHandler(async (req, res) => {
    const result = await query(
      "SELECT id, doc_type, status, original_name, rejection_reason, uploaded_at FROM documents WHERE user_id = $1 ORDER BY uploaded_at DESC",
      [req.user.id]
    );
    res.json(result.rows);
  })
);

router.get(
  "/documents/user/:userId",
  requireAuth,
  requireRole("loan_officer", "admin"),
  asyncHandler(async (req, res) => {
    const result = await query(
      "SELECT id, doc_type, status, original_name, rejection_reason, uploaded_at FROM documents WHERE user_id = $1 ORDER BY uploaded_at DESC",
      [req.params.userId]
    );
    res.json(result.rows);
  })
);

router.patch(
  "/documents/:id/status",
  requireAuth,
  requireRole("loan_officer", "admin"),
  asyncHandler(async (req, res) => {
    const { status, rejectionReason } = req.body;
    if (!["verified", "rejected"].includes(status)) {
      return res.status(400).json({ error: "status must be 'verified' or 'rejected'" });
    }
    if (status === "rejected" && !rejectionReason) {
      return res.status(400).json({ error: "rejectionReason is required when rejecting a document" });
    }

    const result = await withTransaction(async (client) => {
      const before = await client.query("SELECT * FROM documents WHERE id = $1", [req.params.id]);
      if (before.rows.length === 0) {
        throw Object.assign(new Error("Document not found"), { statusCode: 404 });
      }

      const updated = await client.query(
        `UPDATE documents
         SET status = $1, verified_by = $2, verified_at = now(), rejection_reason = $3
         WHERE id = $4
         RETURNING *`,
        [status, req.user.id, status === "rejected" ? rejectionReason : null, req.params.id]
      );

      await logAudit(client, {
        actorId: req.user.id,
        action: `document_${status}`,
        entityType: "document",
        entityId: Number(req.params.id),
        before: before.rows[0],
        after: updated.rows[0],
        ip: req.ip,
      });

      return updated.rows[0];
    });

    res.json(result);
  })
);

module.exports = router;
