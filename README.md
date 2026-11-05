# Loan Management System — Botswana Micro-Lending MVP

A full-stack loan management system: customer self-service (apply, upload
documents, track repayments) and a loan officer/admin console (review,
approve/decline, service loans, run reports). Built for a Botswana
micro-lending company, with the country's NBFIRA microlending regulations
designed in from the start rather than bolted on.

---

## 1. Quick start (local development)

**Prerequisites:** Java 21, Maven 3.9+, Node.js, and Docker Desktop (or Docker Engine + Compose).

```bash
# 1. Start PostgreSQL
docker compose up -d postgres

# 2. Initialize the existing database schema and seed demo accounts
cd backend
npm install
npm run migrate
npm run seed

# 3. Start Spring Boot API in a new terminal (Windows Command Prompt)
cd /d C:\Users\User1\Desktop\LMS\lms\backend-springboot
set "JWT_SECRET=replace-this-with-a-random-secret-at-least-32-characters-long"
set "APP_BASE_URL=http://localhost:4200"
set "DEV_EMAIL_LINKS=true"
mvn spring-boot:run

# 4. Start Angular in another terminal
cd /d C:\Users\User1\Desktop\LMS\lms\frontend-angular
npm.cmd start -- --open
```

Open Angular at `http://localhost:4200`. The API listens at
`http://localhost:4000`. With local email links enabled, verification and
password-reset links appear in the Spring Boot console.

Log in with the seeded accounts:
- Admin: `admin@lms.local` / `Admin@12345`
- Loan officer: `officer@lms.local` / `Officer@12345`
- Or register a new customer account from the app itself.

The one-time schema/seed commands still use scripts in the retained Node
backend. The Java API is the backend to run for Angular; see
[backend-springboot/README.md](./backend-springboot/README.md) for configuration.

### Running the whole stack containerized

```bash
docker compose up -d postgres
cd backend
npm install
npm run migrate
npm run seed
cd ..
cp .env.example .env         # project root — set a strong JWT_SECRET
docker compose up --build
```
Legacy React frontend: http://localhost:8080 · Spring Boot API: http://localhost:4000 · Postgres: localhost:5433

### Run the Angular frontend migration

The original React frontend and Node.js API remain available as fallbacks.
The Angular frontend in `frontend-angular/` uses the new Spring Boot API.

Start PostgreSQL, run the schema migration and seed commands in the quick
start above, and run the Spring Boot API on `http://localhost:4000`. Then
start Angular:

```cmd
cd /d C:\Users\User1\Desktop\LMS\lms\frontend-angular
npm.cmd start -- --open
```

The Angular dev proxy forwards `/api` requests to Spring Boot.
PowerShell users can use `npm.cmd` if script execution blocks `npm`.

The Angular migration currently includes the public site, authentication,
borrower application/documents/loan views, and staff dashboard/review/report
views. The Angular starter's server-side rendering was disabled because this
frontend uses browser-based login state and the local API proxy.

---

## 2. Architecture

```
┌──────────────┐      ┌────────────────┐      ┌────────────────────┐
│ Browser      │◄────►│ Angular SPA    │◄────►│ Spring Boot API    │◄────► PostgreSQL
│              │      │ :4200          │      │ :4000              │
└──────────────┘      └────────────────┘      └────────────────────┘
```

- **Frontend**: React 18 + Vite, plain CSS with a token system (no
  Tailwind/CSS-in-JS — deliberate, see §4). Served by Nginx in production,
  which also reverse-proxies `/api/*` to the backend so the browser only
  ever talks to one origin (no CORS in production).
- **Current backend**: Java 21 + Spring Boot, JDBC, PostgreSQL, and a
  compatible JSON API. The original Node.js + Express backend and database
  migration/seed scripts remain in `backend/` as a fallback/bootstrap path.
- **Database**: PostgreSQL, raw SQL migrations, double-entry ledger
  (`ledger_entries`) backing every financial transaction so the books are
  always independently auditable and provably balanced.

---

## 3. Design & UX decisions

- **Color palette** — grounded in Botswana specifically, not generic
  fintech blue: deep emerald + warm gold reference *pula* (Setswana for
  both "rain" and the national currency — rain as the traditional symbol
  of wealth in a semi-arid country), and a deep indigo for trust/stability.
  Full rationale in `frontend/src/styles/tokens.css`.
- **Typography** — three-role system: Space Grotesk (display), IBM Plex
  Sans (body/UI), IBM Plex Mono for every financial figure (tabular
  figures — a real fintech convention that makes columns of numbers
  scannable digit-by-digit).
- **Responsive strategy** — sidebar nav on desktop, bottom tab bar +
  slide-down drawer on mobile (`frontend/src/components/layout/AppShell.jsx`).
  Not a squeezed-down desktop layout — a genuinely mobile-shaped
  navigation pattern, since a meaningful share of users in this market
  will be mobile-only.
- **Customer assistance** — the active Angular public landing page offers a
  BRD-focused lending FAQ chatbot; see §6 for its scope and limitations.
- **Accessibility baseline** — visible keyboard focus rings throughout,
  `prefers-reduced-motion` respected, label/input association via
  `Field.jsx`, `aria-live` on form errors.

---

## 4. Key technical decisions & trade-offs

| Decision | Why |
|---|---|
| Raw SQL (`pg`), no ORM | Full transparency for financial code — reviewers and auditors can read exactly what's executed, no ORM-generated query surprises. Trade-off: more boilerplate per query than Prisma/Sequelize would give you. |
| Plain CSS + design tokens, no Tailwind | Full control over the specific palette/type system this brief called for, without fighting a utility framework's defaults. Trade-off: more CSS to maintain than utility classes would require at scale. |
| No React state library (Redux/Zustand) | App is small enough that React Context (`AuthContext`) + local component state is sufficient and simpler to reason about. Revisit if state complexity grows significantly. |
| JWT in localStorage, not httpOnly cookies | Faster to implement for MVP; **flagged as a pre-production security upgrade in §7** — this is a real, known trade-off, not an oversight. |
| No refresh-token redemption endpoint | The backend issues a `refreshToken` but there is no `POST /auth/refresh` to redeem it yet — users currently must re-login after the 30-minute access token expires. Listed in §7. |

---

## 5. Testing performed

- **Backend**: 15 unit tests (`backend/test/`) covering amortization math
  (reducing-balance schedule correctness, zero-interest edge case, penalty
  regulatory cap enforcement) and double-entry ledger balance invariants —
  run via `npm test`, using Node's built-in test runner (no extra
  dependency).
- **Backend integration**: manually verified end-to-end against a real
  Postgres instance — register → apply → approve (creates loan account +
  6-month amortization schedule + balanced disbursement ledger entries,
  all in one DB transaction) → dashboard reporting. Two real infrastructure
  bugs (a port conflict with a local Postgres install, and a stale Docker
  volume holding outdated credentials) and one query logic bug (portfolio
  outstanding balance) were found and fixed this way.
- **Frontend**: every component was rendered with React's real
  `renderToStaticMarkup` under Node (not just syntax-checked) during
  development, including role-based navigation scoping (a customer never
  sees officer-only nav items and vice versa) and the auth route guard
  (`ProtectedRoute`) correctly blocking unauthenticated access.
- **Not yet done**: browser-based end-to-end testing (Playwright/Cypress)
  and load testing. See §7.

---

## 6. BRD FAQ chatbot — current status

The Angular landing page now includes a BRD-focused FAQ chatbot backed by
curated answers and current loan-product data. It is not a generative AI or
RAG assistant and cannot access customer account data or make lending
decisions. Each exchange is stored in `assistant_conversations` for compliance
review by administrators. The older React frontend has a separate local FAQ
responder; neither frontend currently connects to an LLM.

---

## 7. Critical recommendations before handling real customer funds

These are flagged deliberately rather than silently shipped — treat this
as a pre-production checklist, roughly in priority order:

1. **Move auth tokens out of localStorage into httpOnly cookies.**
   localStorage is readable by any JS on the page — an XSS vulnerability
   anywhere in the app (including a future third-party script) can
   exfiltrate tokens. httpOnly cookies aren't readable by JS at all. This
   is the single highest-value security upgrade before real funds are
   involved.
2. **Implement `POST /auth/refresh`.** The backend issues a refresh token
   today but has no endpoint to redeem it — currently a cosmetic gap
   (users just re-login), but real infrastructure is expected here.
3. **Add rate limiting** on `/auth/login` and `/auth/register` (e.g.
   `express-rate-limit`) — currently nothing stops a brute-force login
   attempt.
4. **Confirm the NBFIRA Microlending Licence is in place** before any
   real disbursement — this system does not gate on license status, that
   is a business/legal precondition, not a technical one.
5. **Legal review of the loan agreement template** against Regulation 11
   and Form 5 of the Microlending Regulations — the agreement e-sign flow
   exists (`agreement_signed` on `loan_applications`) but no actual
   agreement document/template is generated yet; that's a real gap.
6. **Move file uploads to object storage** (S3-compatible) instead of
   local container disk (`backend/uploads/`) — local disk doesn't survive
   container restarts/redeploys without the Docker volume, and doesn't
   scale past a single backend instance.
7. **Add a Content-Security-Policy header** in `nginx.conf` — deliberately
   left out of this MVP (see comment in that file) because a strict CSP
   needs to be authored against the exact external resources in use
   (currently just Google Fonts) rather than added blindly.
8. **Real SMS/email notification delivery** — `notifications.js` currently
   only writes to the database; no actual SMS/email is sent. Needs a real
   provider with Botswana coverage wired in.
9. **Automated end-to-end + load testing** (Playwright, k6 or similar)
   before any real launch — everything validated so far is unit-level and
   manually-verified integration, not automated regression coverage.
10. **Database backups and a disaster recovery plan** — not yet configured
    anywhere in this repo.

---

## 8. Project structure

```
lms/
├── docker-compose.yml       # full-stack orchestration
├── .env.example             # JWT_SECRET for compose
├── backend/
│   ├── db/                  # schema.sql, migrate.js, seed.js
│   └── src/                 # retained Node.js/Express fallback API
├── backend-springboot/
│   ├── Dockerfile
│   ├── pom.xml
│   └── src/                 # Java 21 / Spring Boot API and tests
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    └── src/                  # retained React/Vite frontend
frontend-angular/              # current Angular frontend
```


##stop and start docker:
docker compose down -v

sudo lsof -i :5433
sudo kill -9 581


docker compose up -d postgres

#Verify credentials
psql "postgresql://lms_user:lms_password@localhost:5433/lms_db" -c "\du"

cd backend
npm run migrate
npm run seed
