-- =====================================================================
-- Loan Management System — Database Schema (PostgreSQL)
-- =====================================================================

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  role            VARCHAR(20) NOT NULL CHECK (role IN ('customer', 'loan_officer', 'admin')),
  full_name       VARCHAR(255) NOT NULL,
  phone           VARCHAR(50),
  national_id     VARCHAR(50),
  marital_status  VARCHAR(30) DEFAULT 'unknown' CHECK (marital_status IN ('single','married_in_community','married_out_of_community','unknown')),
  mfa_secret      VARCHAR(255),
  mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,

  -- Email verification (see "SAFE UPGRADE PATH" block below for existing DBs).
  -- Tokens are never stored raw — only a SHA-256 hash — so a database leak
  -- alone can never be used to verify/reset an account (same principle as
  -- password_hash never storing a plaintext password).
  email_verified                  BOOLEAN NOT NULL DEFAULT FALSE,
  email_verification_token_hash   VARCHAR(64),
  email_verification_expires_at   TIMESTAMPTZ,
  email_verification_attempts     INTEGER NOT NULL DEFAULT 0,
  password_reset_token_hash       VARCHAR(64),
  password_reset_expires_at       TIMESTAMPTZ,
  password_reset_attempts         INTEGER NOT NULL DEFAULT 0,
  profile_picture                 BYTEA,
  profile_picture_type            VARCHAR(30),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture BYTEA;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture_type VARCHAR(30);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id                       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferred_contact_method      VARCHAR(10) NOT NULL DEFAULT 'email' CHECK (preferred_contact_method IN ('email','sms')),
  language                      VARCHAR(10) NOT NULL DEFAULT 'en' CHECK (language IN ('en','tn')),
  text_size                     VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (text_size IN ('small','normal','large')),
  notify_repayment_reminders    BOOLEAN NOT NULL DEFAULT TRUE,
  notify_application_updates    BOOLEAN NOT NULL DEFAULT TRUE,
  notify_statements             BOOLEAN NOT NULL DEFAULT TRUE,
  notify_new_applications       BOOLEAN NOT NULL DEFAULT TRUE,
  notify_overdue_payments       BOOLEAN NOT NULL DEFAULT TRUE,
  notify_assigned_complaints    BOOLEAN NOT NULL DEFAULT TRUE,
  notify_kyc_reviews            BOOLEAN NOT NULL DEFAULT TRUE,
  default_application_filter    VARCHAR(20) NOT NULL DEFAULT 'all' CHECK (default_application_filter IN ('all','submitted','under_review')),
  application_sort              VARCHAR(20) NOT NULL DEFAULT 'newest' CHECK (application_sort IN ('newest','oldest','amount_high','amount_low')),
  dashboard_layout              VARCHAR(20) NOT NULL DEFAULT 'comfortable' CHECK (dashboard_layout IN ('comfortable','compact')),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kyc_cases (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status              VARCHAR(20) NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','submitted','under_review','approved','rejected')),
  spousal_consent_required BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at        TIMESTAMPTZ,
  reviewed_by         INTEGER REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ,
  rejection_reason    VARCHAR(500),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kyc_case_id     INTEGER REFERENCES kyc_cases(id) ON DELETE CASCADE,
  doc_type        VARCHAR(30) NOT NULL CHECK (doc_type IN ('national_id','payslip','proof_of_address','spousal_consent','bank_statement')),
  file_path       VARCHAR(500) NOT NULL,
  original_name   VARCHAR(255) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  verified_by     INTEGER REFERENCES users(id),
  verified_at     TIMESTAMPTZ,
  rejection_reason VARCHAR(500),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_doc_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_doc_type_check
  CHECK (doc_type IN ('national_id','payslip','proof_of_address','spousal_consent','bank_statement'));

ALTER TABLE documents ADD COLUMN IF NOT EXISTS kyc_case_id INTEGER REFERENCES kyc_cases(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS loan_products (
  id                    SERIAL PRIMARY KEY,
  name                  VARCHAR(100) NOT NULL,
  monthly_rate_pct      NUMERIC(5,2) NOT NULL,
  min_amount            NUMERIC(12,2) NOT NULL,
  max_amount            NUMERIC(12,2) NOT NULL,
  min_tenure_months     INTEGER NOT NULL,
  max_tenure_months     INTEGER NOT NULL,
  penalty_rate_pct      NUMERIC(4,2) NOT NULL DEFAULT 5.00 CHECK (penalty_rate_pct <= 5.00),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS loan_applications (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id),
  kyc_case_id       INTEGER UNIQUE REFERENCES kyc_cases(id),
  loan_product_id   INTEGER NOT NULL REFERENCES loan_products(id),
  amount_requested  NUMERIC(12,2) NOT NULL CHECK (amount_requested > 0),
  purpose           VARCHAR(255) NOT NULL,
  tenure_months     INTEGER NOT NULL CHECK (tenure_months > 0),
  status            VARCHAR(20) NOT NULL DEFAULT 'submitted'
                      CHECK (status IN ('draft','submitted','under_review','approved','declined')),
  decline_reason_code VARCHAR(50),
  decline_notes     VARCHAR(500),
  reviewed_by       INTEGER REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  agreement_signed  BOOLEAN NOT NULL DEFAULT FALSE,
  agreement_signed_at TIMESTAMPTZ,
  spousal_consent_required BOOLEAN NOT NULL DEFAULT FALSE,
  spousal_consent_provided BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS kyc_case_id INTEGER UNIQUE REFERENCES kyc_cases(id);
ALTER TABLE loan_applications DROP CONSTRAINT IF EXISTS loan_applications_status_check;
ALTER TABLE loan_applications ADD CONSTRAINT loan_applications_status_check
  CHECK (status IN ('draft','submitted','under_review','approved','declined'));

CREATE TABLE IF NOT EXISTS loan_accounts (
  id                SERIAL PRIMARY KEY,
  application_id    INTEGER NOT NULL UNIQUE REFERENCES loan_applications(id),
  user_id           INTEGER NOT NULL REFERENCES users(id),
  principal         NUMERIC(12,2) NOT NULL,
  monthly_rate_pct  NUMERIC(5,2) NOT NULL,
  tenure_months     INTEGER NOT NULL,
  penalty_rate_pct  NUMERIC(4,2) NOT NULL DEFAULT 5.00,
  status            VARCHAR(20) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','closed','delinquent','written_off')),
  start_date        DATE NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schedule_entries (
  id                SERIAL PRIMARY KEY,
  loan_account_id   INTEGER NOT NULL REFERENCES loan_accounts(id) ON DELETE CASCADE,
  installment_no    INTEGER NOT NULL,
  due_date          DATE NOT NULL,
  opening_balance   NUMERIC(12,2) NOT NULL,
  principal_due     NUMERIC(12,2) NOT NULL,
  interest_due      NUMERIC(12,2) NOT NULL,
  total_due         NUMERIC(12,2) NOT NULL,
  closing_balance   NUMERIC(12,2) NOT NULL,
  amount_paid       NUMERIC(12,2) NOT NULL DEFAULT 0,
  principal_paid    NUMERIC(12,2) NOT NULL DEFAULT 0,
  interest_paid     NUMERIC(12,2) NOT NULL DEFAULT 0,
  status            VARCHAR(20) NOT NULL DEFAULT 'upcoming'
                      CHECK (status IN ('upcoming','due','paid','partially_paid','overdue')),
  UNIQUE(loan_account_id, installment_no)
);

CREATE TABLE IF NOT EXISTS transactions (
  id                SERIAL PRIMARY KEY,
  loan_account_id   INTEGER NOT NULL REFERENCES loan_accounts(id),
  txn_type          VARCHAR(20) NOT NULL CHECK (txn_type IN ('disbursement','repayment','penalty','write_off','adjustment')),
  amount            NUMERIC(12,2) NOT NULL,
  principal_portion NUMERIC(12,2) DEFAULT 0,
  interest_portion  NUMERIC(12,2) DEFAULT 0,
  recorded_by       INTEGER REFERENCES users(id),
  notes             VARCHAR(500),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id                SERIAL PRIMARY KEY,
  loan_account_id   INTEGER NOT NULL REFERENCES loan_accounts(id),
  transaction_id    INTEGER NOT NULL REFERENCES transactions(id),
  account_name      VARCHAR(50) NOT NULL,
  entry_type        VARCHAR(10) NOT NULL CHECK (entry_type IN ('debit','credit')),
  amount            NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id),
  processor_token   VARCHAR(255) NOT NULL,
  card_last4        VARCHAR(4),
  card_brand        VARCHAR(20),
  debit_day_of_month INTEGER CHECK (debit_day_of_month BETWEEN 1 AND 28),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id),
  channel           VARCHAR(20) NOT NULL CHECK (channel IN ('sms','email','in_app')),
  trigger_type      VARCHAR(50) NOT NULL,
  message           TEXT NOT NULL,
  delivery_status   VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (delivery_status IN ('queued','sent','failed')),
  read_at           TIMESTAMPTZ,
  reference_type    VARCHAR(30) CHECK (reference_type IN ('application','kyc','loan')),
  reference_id      BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_type VARCHAR(30);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_id BIGINT;

CREATE TABLE IF NOT EXISTS complaints (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id),
  loan_account_id   INTEGER REFERENCES loan_accounts(id),
  subject           VARCHAR(255) NOT NULL,
  description       TEXT NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','escalated_nbfira')),
  assigned_to       INTEGER REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id                SERIAL PRIMARY KEY,
  actor_id          INTEGER REFERENCES users(id),
  action            VARCHAR(100) NOT NULL,
  entity_type       VARCHAR(50) NOT NULL,
  entity_id         INTEGER,
  before_value      JSONB,
  after_value       JSONB,
  ip_address        VARCHAR(50),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assistant_conversations (
 id                BIGSERIAL PRIMARY KEY,
 conversation_id   UUID NOT NULL,
 user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
 user_question     VARCHAR(500) NOT NULL,
 assistant_answer  TEXT NOT NULL,
 created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistant_conversations_created_at
 ON assistant_conversations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_conversations_conversation_id
 ON assistant_conversations (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS message_threads (
  id              BIGSERIAL PRIMARY KEY,
  subject         VARCHAR(200) NOT NULL,
  audience_role   VARCHAR(20) NOT NULL CHECK (audience_role IN ('customer','loan_officer')),
  is_broadcast    BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      INTEGER NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_participants (
  thread_id       BIGINT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at    TIMESTAMPTZ,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_presence (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  is_online       BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id              BIGSERIAL PRIMARY KEY,
  thread_id       BIGINT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id),
  body            TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_attachments (
  id              BIGSERIAL PRIMARY KEY,
  message_id      BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  original_name   VARCHAR(255) NOT NULL,
  file_path       TEXT NOT NULL,
  content_type    VARCHAR(120) NOT NULL,
  size_bytes      BIGINT NOT NULL CHECK (size_bytes > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id, id);

CREATE TABLE IF NOT EXISTS notification_templates (
  event_type      VARCHAR(50) PRIMARY KEY,
  display_name    VARCHAR(100) NOT NULL,
  email_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  sms_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  email_subject   VARCHAR(255) NOT NULL,
  email_body      TEXT NOT NULL,
  sms_body        VARCHAR(500) NOT NULL,
  updated_by      INTEGER REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO notification_templates
  (event_type, display_name, email_enabled, sms_enabled, email_subject, email_body, sms_body)
VALUES
  ('loan_application_received', 'Application received', TRUE, FALSE, 'We received your loan application',
   'Hello {fullName}, we received application #{applicationId}. Our team will review it and update you.',
   'Hello {fullName}, application #{applicationId} was received.'),
  ('loan_approved', 'Loan approved', TRUE, FALSE, 'Your loan has been approved',
   'Hello {fullName}, loan account #{loanId} for {amount} has been approved and disbursed.',
   'Refofe Novelty: loan account #{loanId} for {amount} has been approved and disbursed.'),
  ('loan_rejected', 'Loan application update', TRUE, FALSE, 'An update about your loan application',
   'Hello {fullName}, there is an update about loan application #{applicationId}. Please sign in to review it.',
   'Hello {fullName}, please sign in to review the update to application #{applicationId}.'),
  ('payment_reminder', 'Repayment reminder', TRUE, FALSE, 'Upcoming loan repayment',
   'Hello {fullName}, repayment of {amount} for loan account #{loanId} is due on {dueDate}.',
   'Refofe Novelty: repayment of {amount} for loan #{loanId} is due on {dueDate}.'),
  ('overdue_notice', 'Overdue payment notice', TRUE, FALSE, 'Your loan repayment is overdue',
   'Hello {fullName}, a repayment of {amount} was due on {dueDate}. Please contact us if you need assistance.',
   'Refofe Novelty: repayment of {amount} for loan #{loanId} due {dueDate} is overdue.'),
  ('loan_fully_settled', 'Loan fully repaid', TRUE, FALSE, 'Your loan has been fully repaid',
   'Hello {fullName}, loan account #{loanId} has been fully repaid and is now closed. Thank you.',
   'Refofe Novelty: loan account #{loanId} is fully repaid and closed. Thank you.'),
  ('statement_ready', 'Statement ready', TRUE, FALSE, 'Your loan statement is ready',
   'Hello {fullName}, your loan statement is ready to view in your account.',
   'Hello {fullName}, your loan statement is ready in your account.'),
  ('complaint_assigned', 'Complaint assigned', TRUE, FALSE, 'A complaint has been assigned to you',
   'Hello {fullName}, complaint #{complaintId} has been assigned to you for review.',
   'Hello {fullName}, complaint #{complaintId} has been assigned to you.'),
  ('kyc_review_required', 'KYC review required', TRUE, FALSE, 'Documents need review',
   'Hello {fullName}, documents for application #{applicationId} are ready for review.',
   'Hello {fullName}, documents for application #{applicationId} need review.')
ON CONFLICT (event_type) DO NOTHING;

UPDATE notification_templates
SET email_enabled = TRUE, email_subject = 'Your loan has been approved',
    email_body = 'Hello {fullName}, loan account #{loanId} for {amount} has been approved and disbursed.',
    sms_body = 'Refofe Novelty: loan account #{loanId} for {amount} has been approved and disbursed.',
    sms_enabled = FALSE
WHERE event_type = 'loan_approved' AND updated_by IS NULL;

UPDATE notification_templates
SET email_enabled = TRUE,
    email_body = 'Hello {fullName}, repayment of {amount} for loan account #{loanId} is due on {dueDate}.',
    sms_body = 'Refofe Novelty: repayment of {amount} for loan #{loanId} is due on {dueDate}.',
    sms_enabled = FALSE
WHERE event_type = 'payment_reminder' AND updated_by IS NULL;

UPDATE notification_templates
SET email_enabled = TRUE,
    email_body = 'Hello {fullName}, repayment of {amount} for loan account #{loanId} was due on {dueDate}. Please contact us if you need assistance.',
    sms_body = 'Refofe Novelty: repayment of {amount} for loan #{loanId} due {dueDate} is overdue.',
    sms_enabled = FALSE
WHERE event_type = 'overdue_notice' AND updated_by IS NULL;

INSERT INTO notification_templates
  (event_type, display_name, email_enabled, sms_enabled, email_subject, email_body, sms_body)
VALUES
  ('loan_fully_settled', 'Loan fully repaid', TRUE, FALSE, 'Your loan has been fully repaid',
   'Hello {fullName}, loan account #{loanId} has been fully repaid and is now closed. Thank you.',
   'Refofe Novelty: loan account #{loanId} is fully repaid and closed. Thank you.')
ON CONFLICT (event_type) DO NOTHING;

-- =====================================================================
-- EMAIL LOG — audit trail, troubleshooting, and regulatory compliance
-- for every transactional email the system sends.
--
-- Design notes:
--   - recipient_email / recipient_name are DENORMALIZED (copied at send
--     time) rather than only referenced via user_id. This is deliberate:
--     the compliance/audit trail must remain accurate and complete even
--     if the user's email or name later changes, or the user account is
--     deleted — "what did we send, to whom, and when" must never depend
--     on the current state of another table.
--   - related_entity_type/related_entity_id form a lightweight polymorphic
--     reference (e.g. 'loan_application', 42) so support staff can answer
--     "show me every email related to application #42" without needing a
--     separate join table per entity type.
--   - status + error_message + retry_count together give a real
--     troubleshooting trail: was it sent, did it fail, why, how many
--     times did we try.
--   - provider_message_id stores the SMTP/provider's own message ID when
--     available, so a specific email can be traced/looked-up on the
--     sending provider's side (e.g. for delivery/bounce investigation).
-- =====================================================================
CREATE TABLE IF NOT EXISTS email_log (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recipient_email     VARCHAR(255) NOT NULL,
  recipient_name      VARCHAR(255),
  event_type          VARCHAR(50) NOT NULL CHECK (event_type IN (
                        'registration_confirmation',
                        'email_verification',
                        'loan_application_received',
                        'loan_approved',
                        'loan_rejected',
                        'loan_disbursed',
                        'payment_reminder',
                        'overdue_notice',
                        'loan_fully_settled',
                        'password_reset_requested',
                        'password_reset_completed'
                      )),
  subject             VARCHAR(500) NOT NULL,
  related_entity_type VARCHAR(50),
  related_entity_id   INTEGER,
  status              VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  provider_message_id VARCHAR(255),
  error_message       VARCHAR(1000),
  retry_count         INTEGER NOT NULL DEFAULT 0,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id                  BIGSERIAL PRIMARY KEY,
  event_key           VARCHAR(200) NOT NULL,
  channel             VARCHAR(10) NOT NULL CHECK (channel IN ('email','sms','in_app')),
  user_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type          VARCHAR(50) NOT NULL,
  message             TEXT NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  provider_message_id VARCHAR(255),
  error_message       VARCHAR(1000),
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_key, channel)
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user ON notification_deliveries(user_id, created_at DESC);

ALTER TABLE notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_channel_check;
ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_channel_check CHECK (channel IN ('email','sms','in_app'));

UPDATE notification_templates SET sms_enabled = FALSE;
UPDATE user_preferences SET preferred_contact_method = 'email'
WHERE preferred_contact_method = 'sms';

-- =====================================================================
-- SAFE UPGRADE PATH — idempotent, safe to run on any database state
-- (brand-new, or already migrated by an earlier version of this schema).
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schedule_entries') THEN
    ALTER TABLE schedule_entries ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE schedule_entries ADD COLUMN IF NOT EXISTS principal_paid NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE schedule_entries ADD COLUMN IF NOT EXISTS interest_paid NUMERIC(12,2) NOT NULL DEFAULT 0;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'loan_products' AND column_name = 'annual_interest_rate') THEN
    ALTER TABLE loan_products RENAME COLUMN annual_interest_rate TO monthly_rate_pct;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'loan_accounts' AND column_name = 'annual_interest_rate') THEN
    ALTER TABLE loan_accounts RENAME COLUMN annual_interest_rate TO monthly_rate_pct;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loan_products_name_key') THEN
    ALTER TABLE loan_products ADD CONSTRAINT loan_products_name_key UNIQUE (name);
  END IF;

  -- Email verification / password reset columns, for a database created
  -- before this feature existed.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'email_verified') THEN
    ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'email_verification_token_hash') THEN
    ALTER TABLE users ADD COLUMN email_verification_token_hash VARCHAR(64);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'email_verification_expires_at') THEN
    ALTER TABLE users ADD COLUMN email_verification_expires_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'email_verification_attempts') THEN
    ALTER TABLE users ADD COLUMN email_verification_attempts INTEGER NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_reset_token_hash') THEN
    ALTER TABLE users ADD COLUMN password_reset_token_hash VARCHAR(64);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_reset_expires_at') THEN
    ALTER TABLE users ADD COLUMN password_reset_expires_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_reset_attempts') THEN
    ALTER TABLE users ADD COLUMN password_reset_attempts INTEGER NOT NULL DEFAULT 0;
  END IF;

  -- Existing users on a database from before email verification existed
  -- should not be retroactively locked out — grandfather them in as
  -- already verified rather than silently blocking their next login.
  UPDATE users SET email_verified = TRUE WHERE email_verified = FALSE AND created_at < now() - INTERVAL '1 day';
END $$;

CREATE INDEX IF NOT EXISTS idx_applications_status ON loan_applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_user ON loan_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_cases_user_created ON kyc_cases(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_kyc_case_type_uploaded ON documents(kyc_case_id, doc_type, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON loan_accounts(status);
CREATE INDEX IF NOT EXISTS idx_schedule_account ON schedule_entries(loan_account_id);
CREATE INDEX IF NOT EXISTS idx_schedule_due_date ON schedule_entries(due_date);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entries(loan_account_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, channel, read_at);
CREATE INDEX IF NOT EXISTS idx_message_participants_user ON message_participants(user_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON messages(thread_id, created_at, id);

-- Email log indexes — chosen to match the exact queries the compliance/
-- troubleshooting/reporting use cases actually need:
CREATE INDEX IF NOT EXISTS idx_email_log_user ON email_log(user_id);
CREATE INDEX IF NOT EXISTS idx_email_log_event_type ON email_log(event_type);
CREATE INDEX IF NOT EXISTS idx_email_log_status ON email_log(status);
CREATE INDEX IF NOT EXISTS idx_email_log_created_at ON email_log(created_at);
CREATE INDEX IF NOT EXISTS idx_email_log_related_entity ON email_log(related_entity_type, related_entity_id);
