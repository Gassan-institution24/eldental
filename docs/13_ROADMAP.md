# ElDental — Build Roadmap

> Build strictly in order. Each phase ends with:
> - lint, typecheck and tests green in both apps;
> - checkboxes below ticked;
> - a conventional commit;
> - a short summary to the user.
>
> **Do not start the next phase without the user's go-ahead.**
>
> Every phase that touches the UI must also meet:
> - the **UI Definition of Done** in `16_UX_UI_AND_VALIDATION.md` §7 (ar RTL + en LTR, all states, full input validation, field permissions, telemetry);
> - the **module Definition of Done** in `12_CODING_STANDARDS.md` §6.
>
> Every text field is **one input** (no ar/en duplicate inputs).

---

## Phase 0 — Scaffold & Tooling
- [x] `backend/`: package.json (ESM, scripts: `dev` (tsx watch), `build` (tsc), `start`, `worker`, `lint`, `typecheck`, `test`, `seed`), tsconfig strict, ESLint + Prettier, Vitest config
- [x] `backend/src`: `config/env.ts` (Zod, reads the **existing** `.env`), logger (pino), db connect (Mongoose 8), redis connect, `app.ts` + `server.ts`, `/health` + `/ready`
- [x] Core: ApiError + error handler + 404, response helpers, `validate()` middleware, request id, helmet/cors/rate-limit/sanitize/hpp/cookie-parser
- [x] `frontend/`: Vite React TS, ESLint + Prettier, MUI + RTL cache, i18next (ar/en), React Router, TanStack Query, axios instance, `config/env.ts`
- [x] Design system per `16_UX_UI_AND_VALIDATION.md` §2–4: theme tokens (light/dark), fonts (Arabic + Latin), RTL cache, `<StatusChip>`, `<PageHeader>`, skeletons, empty/error/no-permission/offline states, snackbar with undo, confirm dialog
- [x] Form & validation foundation: RHF wrappers with `fieldKey` support, Zod error-code → i18n mapping, `applyServerErrors`, error summary + focus-first-invalid, input normalisation (Arabic-Indic digits, trim, phone E.164), `<MoneyInput>`, `<PhoneInput>`, `<OtpInput>`; `locales/{ar,en}/validation.json` complete; translation-completeness test
- [x] Logging foundation: pino redaction, `requestLogs` sink, error handler → `systemErrors` (fingerprint), frontend `lib/telemetry.ts` (activity + issues, `X-Session-Id`), `ErrorBoundary` with reference code + "Report a problem"
- [x] Layouts (Auth, Clinic, Admin, Portal) as shells with full navigation chrome (search, quick actions, language toggle ع/EN, theme toggle, user menu)
- [x] Root: CI workflow `.github/workflows/ci.yml` (lint, typecheck, test, build for both apps)
- [ ] `docker compose up -d` works; backend connects to Mongo (rs0) and Redis; frontend shows the login shell in Arabic RTL

> Note: Docker Desktop is installed but needs a Windows reboot (WSL2) before `docker compose up -d` can be verified. Tests run against an in-memory Mongo replica set.

**Accept:** `GET /health` → 200; frontend dev server renders; CI green.

## Phase 1 — Core Platform: Auth, Tenancy, RBAC, Audit
- [x] Base Mongoose plugins: timestamps, auditFields, softDelete, tenantPlugin (AsyncLocalStorage), sequence/counters service, `withTransaction`
- [x] Models: users, clinics (minimal), staff, roles, refreshTokens, otpCodes, auditLogs
- [x] Permission registry **+ field registry** + role templates with field maps (exactly per `04_ROLES_AND_PERMISSIONS.md`) + `authorize()` + scope rules + `fieldPolicy` (projection, masking, write rejection `FIELD_FORBIDDEN`, no sort/search on hidden fields) + per-staff overrides + permission cache (Redis, `pv`)
- [x] Root superadmin (`isRootSuperadmin`, MFA required) + platform permission registry + escalation rule (`04` §8)
- [x] Logging streams: `auditLogs`, `activityLogs`, `clientIssues`, `systemErrors`, `requestLogs` + telemetry endpoints + TTL retention (`15_LOGGING_AND_MONITORING.md`)
- [x] Auth endpoints: login, select-clinic, refresh (rotation + reuse detection), logout, logout-all, me, forgot/reset (OTP), change password, invitation accept
- [x] Email service (nodemailer → Mailpit in dev) with ar/en templates
- [x] Audit service + middleware hooks
- [x] Route-meta test (every route has authorize/public) + tenant isolation test harness
- [x] `npm run seed`: root superadmin from env, a demo clinic "Smile Clinic" with an owner, a dentist, a receptionist, an accountant and HR (password `Password123!`), and role templates
- [x] Frontend: login, select clinic, forgot/reset, auth store + refresh interceptor + BroadcastChannel, `/auth/me` bootstrap, guards, `usePermission`/`<Can>`, ClinicLayout nav filtered by permission

**Accept:** each seeded user logs in and sees only permitted menu items; refresh rotation works; reuse detection test passes; field tests pass (hidden/masked/write-forbidden); a 500 appears in `systemErrors` and a frontend crash appears in `clientIssues`.

## Phase 2 — Superadmin & Clinic Setup
- [ ] Admin: clinics CRUD/suspend/activate, plans, subscriptions, catalog (procedures seed of ~80 codes, tooth conditions, medicines, countries/cities/currencies), role templates, system errors view, impersonation (read-only)
- [ ] Clinic onboarding service: creates the clinic, then seeds roles, chart of accounts, fiscal year, tax rates, leave types, salary components, default appointment types, counters, and invites the owner
- [ ] Clinic settings: profile, working hours, chairs, appointment types, clinic procedures (import from catalog + prices), integrations (JoFotara creds encrypted), taxes
- [ ] Staff & roles: invite staff, edit, deactivate, assign roles, **role editor** (module → resource → actions with own/all → fields hidden/masked/read/write, presets, search, "preview as role", diff before save), per-staff overrides tab
- [ ] Superadmin management (`/admin/superadmins`): invite/disable superadmins, grant platform permissions with the same editor, escalation rule enforced
- [ ] Platform settings → Integrations: WhatsApp (Mazbot) credentials + template ids entered here (encrypted, never returned, "Send test message"); SMTP override
- [ ] Logs UI (`/admin/logs` + `/clinic/settings/logs`): Audit, Activity, User issues (grouped board with status), System errors, Requests, **user session timeline**, dashboard widgets, filters, CSV export
- [ ] Clinic onboarding wizard UI (`16` §6)
- [ ] Frontend for all the above (Admin + Clinic Settings + Staff/Roles)

**Accept:**
- a superadmin creates a clinic, and its owner receives an invite and completes setup;
- a custom role restricts the UI and API correctly;
- "Receptionist can see employees' names and phones but not salaries" works end-to-end (API omits the salary, UI has no salary column or input);
- a non-root superadmin cannot grant more than they have;
- the user timeline shows pages, actions, validation errors and failed requests for a session.

## Phase 3 — Patients
- [ ] Patients CRUD, search/typeahead, file numbers, guardian/family, merge, communication prefs
- [ ] Medical history (versioned) + allergies + alerts banner
- [ ] Insurance companies (basic) + patient policies
- [ ] File assets + storage driver (local) + secure download endpoint + document upload UI
- [ ] Patient profile page with tabs (overview, documents, history placeholder)

**Accept:** a receptionist registers a patient, uploads an ID and records history; a dentist with `own` scope cannot see untreated patients (404).

## Phase 4 — Scheduling & Appointments
- [x] Dentist schedules, schedule exceptions, availability engine (pure + tests)
- [x] Appointments: book with slotLocks in a transaction, reschedule, state machine, cancel/no-show, bulk shift, today board
- [x] BullMQ setup (queues, workers, repeatables) + reminders (email now; WhatsApp in Phase 8)
- [ ] "Tomorrow list" daily job for reception
- [x] Waiting list + recalls (basic)
- [x] Socket.IO (auth handshake, clinic rooms, `appointment:changed`)
- [x] Frontend: resource calendar (dentists/chairs), quick-book drawer with slot picker, drag to reschedule, today board (live), schedule editor, waitlist, recalls

**Accept:** a concurrency test (20 parallel bookings → 1 success); the calendar updates live in two browsers.

## Phase 5 — Clinical
- [x] Tooth chart + chart entries + chartEffect mapping
- [x] Treatment plans (phases, alternatives, estimates, present PDF, accept with signature)
- [x] Performed procedures (events → recalls; billing hook stubbed until Phase 6)
- [x] Clinical notes (templates, sign, amend), perio chart, prescriptions (PDF), lab orders, imaging viewer, consents
- [x] Lab cost → supplier bill draft (needs Phase 6 suppliers/bills)
- [x] Frontend: `<ToothChart>`, plan builder, perio grid, notes editor, Rx, lab orders, imaging gallery, consent signing

**Accept:** an end-to-end flow: chart finding → plan → accept → book → perform → chart shows completed.

## Phase 6 — Billing & Accounting
- [x] money.ts + tests; chart of accounts seed; account tree CRUD
- [x] Journal service (validate, post, reverse), fiscal years/periods, posting rules (pure + tests)
- [x] Invoices (draft from appointment, issue with numbering + journal, void, credit note, PDF), insurance split
- [x] Payments (allocations, credit, refunds, receipts, idempotency), cheques, cash sessions
- [x] Insurance claims; suppliers, supplier bills, supplier payments, expenses; lab order → bill draft
- [x] JoFotara builder + client + worker (feature-flagged)
- [x] Reports: trial balance, P&L, balance sheet, GL, AR/AP aging, VAT return, daily cash, patient statement
- [x] Frontend for all of the above

**Accept:** the ledger scenario test passes; the trial balance balances after the seeded demo activity; the PDFs render in Arabic.

## Phase 7 — HR & Payroll
- [x] Shifts, attendance (check-in/out, QR, nightly absence job, adjustments)
- [x] Leave types, balances (yearly/monthly jobs), requests + approval → schedule exceptions
- [x] Salary components, compensation, commission (production/collection)
- [x] Payroll run (calculate pure fn + tests, approve → journal, mark paid → journal), payslip PDF, acknowledgement
- [x] Frontend: attendance widget + sheets, leave request/approval, payroll wizard, my payslips

**Accept:** a payroll for the seeded staff produces a balanced journal; approved leave blocks the dentist's availability.

## Phase 8 — Notifications & WhatsApp
- [ ] In-app notifications + preferences + socket `notification:new`
- [ ] WhatsApp via Mazbot (port `utils/mazbot.js` logic from Hakeemna into a typed client with throttling + phone normalisation), credentials + templates entered by the superadmin in Admin → Settings → Integrations (encrypted in `platformSettings`, never in `.env`), with a "Send test message" button
- [ ] messageLogs + admin view; retries; respect consent
- [ ] Wire appointment booked/reminder/cancel/reschedule, recall, OTP, invoice/receipt sending

## Phase 9 — Patient Portal
- [ ] Patient registration (OTP), link to a clinic record, family
- [ ] Public clinic page + online booking flow (rules from `06_MODULE_APPOINTMENTS.md` §2)
- [ ] My appointments (cancel within the window), treatment plans (accept), invoices/receipts, profile
- [ ] PWA manifest + mobile polish

## Phase 10 — Dashboards, Reports & Inventory
- [ ] Clinic dashboard KPIs (today, production, collections, new patients, no-show rate, plan conversion), per-role variants
- [ ] Operational reports + XLSX/PDF export jobs
- [ ] Inventory (items, movements, low-stock alerts, link to supplier bills)
- [ ] Superadmin stats

## Phase 11 — Hardening & Deploy
- [ ] Security review against `11_SECURITY.md` (checklist), dependency audit, rate-limit tuning
- [ ] Playwright e2e for the critical journeys
- [ ] Performance: indexes verified, slow-query check with a 100k-patient seed
- [ ] Dockerfiles (backend API, worker, frontend static via nginx/caddy), production compose, backup script (encrypted) + restore doc
- [ ] `docs/DEPLOYMENT.md` written
