-- =====================================================================
-- Loan Management System — Database Schema (PostgreSQL)
-- Raw SQL, deliberately not behind an ORM migration tool so it's easy
-- to read, review, and hand to a DBA/auditor.
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
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Documents: only a pointer to the file on disk/object storage is kept here.
-- Per NBFIRA guidance, original physical documents must not be retained —
-- this table represents verified DIGITAL copies only, with a retention policy
-- to be enforced by a scheduled job (see README).
CREATE TABLE IF NOT EXISTS documents (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type        VARCHAR(30) NOT NULL CHECK (doc_type IN ('national_id','payslip','proof_of_address','spousal_consent')),
  file_path       VARCHAR(500) NOT NULL,
  original_name   VARCHAR(255) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  verified_by     INTEGER REFERENCES users(id),
  verified_at     TIMESTAMPTZ,
  rejection_reason VARCHAR(500),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loan_products (
  id                    SERIAL PRIMARY KEY,
  name                  VARCHAR(100) NOT NULL,
  monthly_rate_pct      NUMERIC(5,2) NOT NULL,   -- MONTHLY Percentage Rate, e.g. 2.50 for 2.5%/month (reducing balance)
  min_amount            NUMERIC(12,2) NOT NULL,
  max_amount            NUMERIC(12,2) NOT NULL,
  min_tenure_months     INTEGER NOT NULL,
  max_tenure_months     INTEGER NOT NULL,
  penalty_rate_pct      NUMERIC(4,2) NOT NULL DEFAULT 5.00 CHECK (penalty_rate_pct <= 5.00), -- regulatory cap
  is_active             BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS loan_applications (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id),
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

CREATE TABLE IF NOT EXISTS loan_accounts (
  id                SERIAL PRIMARY KEY,
  application_id    INTEGER NOT NULL UNIQUE REFERENCES loan_applications(id),
  user_id           INTEGER NOT NULL REFERENCES users(id),
  principal         NUMERIC(12,2) NOT NULL,
  monthly_rate_pct  NUMERIC(5,2) NOT NULL,   -- MONTHLY Percentage Rate, locked in at approval time
  tenure_months     INTEGER NOT NULL,
  penalty_rate_pct  NUMERIC(4,2) NOT NULL DEFAULT 5.00,
  status            VARCHAR(20) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','closed','delinquent','written_off')),
  start_date        DATE NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- SAFE UPGRADE PATH — for a database that was already created and
-- migrated BEFORE the switch from Annual Percentage Rate (stored as
-- `annual_interest_rate`) to Monthly Percentage Rate (`monthly_rate_pct`).
-- `CREATE TABLE IF NOT EXISTS` above is a no-op on an already-existing
-- table, so a plain re-run of this file would NOT rename the column on
-- its own — this block does that explicitly, and is itself idempotent
-- (safe to run every time `npm run migrate` runs, on any database state):
--   - a brand-new database never had the old column, so both IF EXISTS
--     checks below simply find nothing and no-op;
--   - a database still on the old schema gets renamed exactly once;
--   - a database already renamed (by a previous run of this same block)
--     is left untouched.
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'loan_products' AND column_name = 'annual_interest_rate'
  ) THEN
    ALTER TABLE loan_products RENAME COLUMN annual_interest_rate TO monthly_rate_pct;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'loan_accounts' AND column_name = 'annual_interest_rate'
  ) THEN
    ALTER TABLE loan_accounts RENAME COLUMN annual_interest_rate TO monthly_rate_pct;
  END IF;

  -- loan_products.name needs a UNIQUE constraint so the seed script's
  -- ON CONFLICT (name) DO UPDATE (see db/seed.js) actually has a conflict
  -- target to match against — without this, re-running the seed script
  -- silently inserted duplicate product rows instead of updating them.
  -- Added conditionally (via pg_constraint) since ALTER TABLE ADD
  -- CONSTRAINT has no built-in "IF NOT EXISTS" form in PostgreSQL.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'loan_products_name_key'
  ) THEN
    ALTER TABLE loan_products ADD CONSTRAINT loan_products_name_key UNIQUE (name);
  END IF;
END $$;

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

-- Double-entry ledger. Every transaction above must produce >=2 balanced rows here.
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
  processor_token   VARCHAR(255) NOT NULL, -- tokenized reference from payment processor ONLY — never a raw PAN/PIN
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
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE INDEX IF NOT EXISTS idx_applications_status ON loan_applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_user ON loan_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON loan_accounts(status);
CREATE INDEX IF NOT EXISTS idx_schedule_account ON schedule_entries(loan_account_id);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entries(loan_account_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
