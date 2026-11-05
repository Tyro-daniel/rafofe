# Refofe Novelty Angular frontend

This is the Angular frontend for the LMS. It runs alongside the original
React frontend; the new Spring Boot API uses the existing PostgreSQL schema.

## Run locally

Start PostgreSQL, initialize the schema, and run the Spring Boot API using
the instructions in `../backend-springboot/README.md`. The API should be
listening on `http://localhost:4000`.
Then open a second terminal:

```cmd
cd C:\Users\User1\Desktop\LMS\lms\frontend-angular
npm start -- --open
```

The Angular app opens at `http://localhost:4200`. Its development proxy
forwards `/api/*` requests to the Spring Boot API and removes the `/api`
prefix.

Set `APP_BASE_URL=http://localhost:4200` when starting Spring Boot so local
email links return to this frontend.

## Run the full stack with Docker Compose

From the repository root, set `JWT_SECRET` to a private value of at least 32
characters in your shell, then run:

```cmd
docker compose up --build
```

Compose builds and serves this Angular app at `http://localhost:8080`, and its
Nginx server forwards `/api/*` to the Spring Boot container while removing the
`/api` prefix. The Compose database password and service configuration are for
local development only; replace them and use managed secrets, database
backups, shared upload storage, and an HTTPS reverse proxy before production.

## Included screens

- Public home page and loan-product calculator
- Three-image home-page carousel; add `heroo.JPG`, `loans.PNG`, and `Hero.JPEG` to `public/images/`
- Separate borrower sign-in (`/login`) and staff sign-in (`/login-staff`) portals, plus borrower registration
- Staged borrower flow: submit KYC documents first; only after officer approval can the borrower complete and submit the loan application
- Borrower, system administrator, and loan officer dashboards with role-specific access
- Administrator sidebar for staff accounts, loan products, system settings, and audit trail
- Dedicated admin routes for each administration section
- Administrator staff-account creation, user listing/editing and activate/deactivate controls, plus portfolio overview
- Customer and loan-officer personal settings for contact details, notification preferences, language preference, and text size; officers can also set application filtering, sorting, and workspace density
- Administrator notification templates and per-event email/SMS controls with an audit history of changes
- In-app messaging: loan officers can message one or selected/all customers, administrators can message one or selected/all loan officers; individual chats use the recipient's name, while multi-recipient broadcasts use one shared group thread where only the sender can post follow-up updates. Chats support emoji, images, and common document attachments.
- Separate loan-officer KYC review and loan-application queues, with authenticated document viewing/download; repayment recording, complaints, and portfolio/aging/collections reports
- Email verification and password reset pages
- Public landing-page lending FAQ chatbot with current product terms; each question and answer is saved for compliance review

The original Node.js backend is retained as a fallback. Payment processing,
Generative AI assistant integration, and other roadmap features are not added by this
Angular frontend. The lending chatbot uses curated answers and is not a generative AI model.
Administrators can retrieve the saved chatbot exchanges through
`GET /assistant/conversations?limit=50`. SMS delivery requires an SMS gateway and is not enabled by
the current backend; Setswana is stored as a language preference, while the
interface remains in English. Notification templates and event preferences
are stored and audited, but automatic delivery for application, repayment,
statement, and officer-alert events is not yet connected in the Spring Boot
API.

## Build and test

```cmd
npm run build
npm test -- --watch=false
```
