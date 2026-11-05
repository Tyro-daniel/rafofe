# Spring Boot LMS API

This Java 21 / Spring Boot API replaces the Node/Express API for the current
Angular frontend workflows and keeps the existing PostgreSQL schema and JSON
API shapes. The original `backend/` is retained as a fallback; do not run
both APIs on port 4000 at the same time.

## Start locally on Windows

Prerequisites: Java 21, Maven 3.9+, Docker Desktop, and Node.js for the
existing one-time database migration/seed scripts.

```cmd
cd /d C:\Users\User1\Desktop\LMS\lms
docker compose up -d postgres

cd backend
npm install
npm run migrate
npm run seed

cd /d C:\Users\User1\Desktop\LMS\lms\backend-springboot
set "JWT_SECRET=replace-this-with-a-random-secret-at-least-32-characters-long"
set "APP_BASE_URL=http://localhost:4200"
set "DEV_EMAIL_LINKS=true"
mvn spring-boot:run
```

The API listens at `http://localhost:4000`; health check:
`http://localhost:4000/health`. The local seed accounts are
`admin@lms.local` / `Admin@12345` and
`officer@lms.local` / `Officer@12345`.

With `DEV_EMAIL_LINKS=true` and no SMTP host, verification and password-reset
codes are printed in the API console for local development only. Configure
SMTP to deliver email; set `DEV_EMAIL_LINKS=false` outside local development.
Never use a development JWT secret or print verification codes in production.

### Deliver signup verification codes through Gmail

The customer signup flow sends a six-digit code to the address supplied during
registration. For Gmail delivery, use Google's SMTP server and an **App
Password** (not the Gmail account password):

1. Enable 2-Step Verification on the Google account that will send the email.
2. Create an App Password in that Google account's security settings.
3. Set the following environment variables before starting Spring Boot. Use
   the same Gmail address for `MAIL_USERNAME` and `MAIL_FROM` unless you have
   configured and verified a Gmail "Send mail as" alias for `MAIL_FROM`.
   Remove spaces from the generated App Password.

```cmd
set "MAIL_HOST=smtp.gmail.com"
set "MAIL_PORT=587"
set "MAIL_USERNAME=your-sender@gmail.com"
set "MAIL_PASSWORD=your-16-character-app-password"
set "MAIL_FROM=your-sender@gmail.com"
set "MAIL_FROM_NAME=Refofe Novelty"
set "DEV_EMAIL_LINKS=false"
mvn spring-boot:run
```

For Docker Compose, set the same variables in the CMD window before running
`docker compose up --build`. Compose passes these values to the Spring Boot
container. Do not commit mail credentials to the repository or post them in
chat.

`MAIL_FROM_NAME` controls the sender label shown in the inbox. To send as
`noreply@your-company-domain.com`, configure that address as a verified
"Send mail as" alias on the Gmail account and set it as `MAIL_FROM`. Gmail may
still display a Reply button; a no-reply address determines where replies are
sent, it does not control the recipient's email-app interface.

Keep these values in deployment/environment configuration, never in a
committed file. Registration creates an unverified customer account and sends
the code; the customer enters it on `/verify-email`. Signup codes and password
reset codes expire after 10 minutes and are limited to five incorrect attempts.
The customer sign-in page does not expose a verification-code link. An
unverified sign-up can be restarted from `/register` using the same email; that
replaces its pending details and sends a fresh code, subject to the email
resend cooldown. Verified accounts cannot be overwritten. If delivery fails,
the signup page offers a resend option. The API endpoints
are `POST /auth/register`, `POST /auth/verify-email-code`,
`POST /auth/resend-verification-code`, `POST /auth/forgot-password`, and
`POST /auth/reset-password`. The forgot-password form verifies the reset code
before accepting a new password. After schema changes, run `npm run migrate`
from `../backend` before restarting the Spring Boot API.

### Loan email and in-app notifications

Phone numbers are optional. Loan approval and full repayment/closure trigger
email and an in-app notification with the loan account ID. Scheduled repayment
reminders are sent seven days before an installment is due and one day after it
becomes overdue, at 08:00 Africa/Gaborone time. Customers can see their recent
notifications in the workspace notification bell, which displays the combined
unread message and account-update count. Opening the bell marks account updates
as read. Selecting an account update opens its related loan application, KYC
case, or loan account; selecting a message opens that conversation. Delivery
follows the email template switches and customers'
application-update/repayment-reminder preferences. SMS is
disabled; no paid SMS provider is required. Email requires SMTP configuration.
Delivery results and failures are stored in `notification_deliveries`; email
attempts are also recorded in `email_log`. Override the schedule with
`LOAN_REMINDERS_CRON` and `LOAN_REMINDERS_ZONE`.

Optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `DB_URL` | `jdbc:postgresql://localhost:5433/lms_db` | JDBC URL |
| `DB_USERNAME` | `lms_user` | Database user |
| `DB_PASSWORD` | `lms_password` | Database password |
| `JWT_SECRET` | required | HMAC signing secret, minimum 32 characters |
| `CORS_ORIGIN` | `http://localhost:4200` | Browser origin allowed by CORS |
| `APP_BASE_URL` | `http://localhost:4200` | Base URL in email links |
| `UPLOAD_DIR` | `../backend/uploads` | Uploaded-document directory |

## Included API behavior

- Registration/login, bcrypt password checks, signed JWT access/refresh
  tokens, role checks, MFA setup/verification, email verification, and
  password reset.
- Public BRD-focused lending FAQ endpoint that answers from configured loan
  products and stores each question and answer in `assistant_conversations`.
  Administrators can review recent exchanges with
  `GET /assistant/conversations?limit=50`; the limit is 1–100.
- Loan products, borrower applications, staff review/decision, disbursement,
  reducing-balance schedules, repayment allocation, penalty/write-off
  processing, and balanced double-entry ledger entries.
- Staged KYC cases with PDF/JPEG/PNG uploads (8 MB limit), required bank
  statements, certified ID, proof of income, proof of residence, and conditional
  spousal consent. Loan application submission requires approved KYC and all
  required documents verified. KYC and loan application queues are separate.
  Loan officers can securely view/download borrower documents. Loan schedules
  and statements, complaints, officer dashboard, and portfolio reports.

The backend consumes the schema in `../backend/db/schema.sql`; it does not
automatically migrate the database on application startup. Run `npm run
migrate` from `../backend` after schema updates. This schema adds persistent
personal preferences, admin notification templates, settings audit events, and
the assistant conversation log.
Run `npm run seed` only for the initial local setup. The migration also adds
per-installment paid amounts so partial repayments remain allocated correctly,
and profile-picture storage.

All signed-in users can open `/profile` from the name and picture in the workspace
header to edit their name and phone number or upload/remove a JPEG or PNG profile
picture (maximum 2 MB). Customer and loan-officer personal settings are available at `/settings`.
Administrators can manage email templates and event toggles at `/admin/settings`,
with successful sign-ins, registrations, signed-in write actions, scheduled
reminder processing, and notification-setting changes recorded in the admin-only
`/admin/audit-trail` activity log. Read-only page views and failed actions are
not recorded. The log excludes request bodies, passwords, and other secrets, is
retained indefinitely, and can be downloaded as a CSV file that opens in
spreadsheet software. SMS controls are disabled.
Account verification, password reset, loan approvals, repayment reminders,
overdue notices, and loan-closure emails use SMTP configuration. Email
credentials remain in deployment configuration rather than the admin interface.

In-app messaging is available to customers, loan officers, and administrators
at `/messages`. Loan officers can message active customers; administrators can
message active loan officers. Individual chats are titled with the other
participant's name. Multi-recipient broadcasts create one shared group
conversation. Only the officer or administrator who created a broadcast can
post follow-up updates; recipients cannot reply. Chat messages support emoji
text and up to three image or document attachments per message (8 MB each).
Attachments are stored under `UPLOAD_DIR` and can only be downloaded by
participants in the conversation. Run the schema migration before using
attachments on an existing database.

## Build and tests

```cmd
mvn test
mvn package
```
