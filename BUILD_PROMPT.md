# ElDental — Build Prompts

How to use:
1. Open `C:\Users\ASUS\Desktop\dentalproject` in VS Code.
2. Start Docker Desktop, then run `docker compose up -d` in the terminal.
3. Open Claude Code and paste the **Master Prompt** below as your first message.
4. When a phase is finished and you have tried it, paste the next **Continue** prompt.

---

## Master Prompt (paste this first)

```
You are building "ElDental", a multi-clinic SaaS web app for dental clinics (backend + frontend), in this repository.

BEFORE WRITING ANY CODE:
1. Read CLAUDE.md completely.
2. Read every file in docs/ (01 to 16). They are the specification and the source of truth.
3. Skim the Hakeemna files listed in docs/14_HAKEEMNA_REFERENCE.md (C:\Users\ASUS\Desktop\hakeemna) for domain knowledge only. Do NOT copy its code style, and do NOT bring back work groups, departments or employee engagements.
4. Reply with a short summary of your understanding and the Phase 0 plan, then start.

STACK (fixed):
- backend/: Node 20, Express 4, TypeScript strict (ESM), Mongoose 8, Zod, JWT access + rotating refresh tokens (httpOnly cookie), BullMQ + Redis, Socket.IO, pino, Vitest + supertest + mongodb-memory-server.
- frontend/: Vite, React 18, TypeScript strict, MUI v5 with RTL, TanStack Query v5, Zustand (session only), react-hook-form + Zod, i18next, FullCalendar, dayjs, Vitest + Playwright.
- Infra: docker-compose.yml (already present): Mongo 7 replica set rs0, Redis 7, Mailpit.

KEY REQUIREMENTS (do not skip any):
1. ONE INPUT PER FIELD. Unlike Hakeemna (name_english + name_arabic), every text value has exactly ONE field and ONE input, typed once in any language. The INTERFACE is fully translated Arabic/English (Arabic default, RTL), with a language toggle everywhere, including login. System-seeded data (chart of accounts, role templates, leave types, procedure catalog…) is shown through i18n keys until the clinic renames it. See docs/03 §1.1.
2. FULL INPUT VALIDATION, super clear. Use the same Zod rules on the client and the server, and stable error codes translated into ar/en messages. Show errors on blur and on submit, with an error summary and focus on the first invalid field. Map server 422 errors onto the matching fields. Normalise input (Arabic-Indic digits, trim, phone E.164). Use the standard field rules table. See docs/16 §5.
3. FULL UX/UI on every screen. Follow the design system: Arabic + Latin fonts, light/dark, responsive phone/tablet/desktop, perfect RTL and LTR. Handle every state: loading skeletons, empty, error with reference code, no-permission, offline, read-only, success with undo, unsaved changes. Respect the screen specs. A screen is not done until it meets docs/16 §7.
4. SUPERADMIN. There is a ROOT superadmin (from the seed, MFA required) who can see and do EVERYTHING across all clinics, and who creates other superadmins and grants them platform permissions (including field rules and clinic restrictions). A non-root superadmin can never grant more than they have. See docs/04 §8.
5. FULLY CUSTOMISABLE PERMISSIONS DOWN TO THE FIELD. Permission (module.resource.action) + scope (own/all) + field rules per resource (hidden / masked / read / write) + per-staff overrides. Example that must work: "Employee A can see the employees list, but only names and phone numbers, not salaries". The API never returns hidden fields (projection), the server masks masked fields, writes to non-writable fields return 403 FIELD_FORBIDDEN, and sort/search on hidden fields is rejected. The UI hides or disables inputs and columns automatically through fieldKey. Build the role editor with field-level controls, presets, "preview as role" and a diff before saving. See docs/04.
6. EVERYTHING IS RECORDED. Five log streams: audit (changes with before/after), user activity (every page and movement), user issues (JS errors, failed requests, validation failures, slow pages, permission-denied, "Report a problem"), system errors (fingerprinted), and request logs. All linked by sessionId/reqId into a user timeline that superadmins can view (and clinic owners for their clinic). Never log secrets or typed values. See docs/15.
7. WHATSAPP. Keep the WhatsApp (Mazbot) feature, but NO credentials in .env or in the repo. The superadmin enters them in Admin → Settings → Integrations (stored encrypted, write-only, with "Send test message").
8. Also follow exactly as specified: tenancy (tenantPlugin + AsyncLocalStorage), the response envelope, money as integer minor units, the immutable double-entry ledger, the appointment state machine with no double booking, and the security "never do" list.

RULES:
- backend/.env, backend/.env.example, frontend/.env, frontend/.env.example and .gitignore ALREADY EXIST. Never overwrite or delete them. When needed, only append new variables to both .env and .env.example, and validate env with Zod in config/env.ts.
- Write tests as specified in each doc. Pure logic first (availability engine, posting rules, payroll calculation, state machines, permission + field resolution, validation schemas). Then API tests including 403, scope-404, field rules and tenant isolation. Also a translation-completeness test (every key exists in ar and en).
- If something in the docs is ambiguous or you think it should change, stop and ask me before deviating, then update the doc in the same commit.

PROCESS:
- Work strictly phase by phase following docs/13_ROADMAP.md. Start with Phase 0 now.
- At the end of each phase: run lint, typecheck and tests for backend and frontend (all green), tick the checkboxes in docs/13_ROADMAP.md, and make one git commit with a Conventional Commit message (do not push). Then STOP and give me:
  (a) what was built,
  (b) exact commands to run and try it,
  (c) seeded logins,
  (d) screenshots or a short list of screens to check in Arabic and English,
  (e) anything you need from me.
- Do not start the next phase until I say "continue".
```

---

## Continue Prompts (one per phase)

Paste these one at a time after you've checked the previous phase.

**Phase 1:**
```
Continue with Phase 1 (Core Platform: Auth, Tenancy, RBAC with field-level permissions, root superadmin, logging streams). Re-read docs/02, 03 §1 and §3, 04 fully, 05 §2–3, 11 and 15 first. Include the seed script, the route-meta, tenant-isolation and field-rule tests. Stop when done and report as agreed.
```

**Phase 2:**
```
Continue with Phase 2 (Superadmin & Clinic Setup). Re-read docs/01 §4.1–4.2, 03 §2, 04 §3–8, 07 §12, 09 §2, 15 §5 and 16 §6. Build the role editor with field-level controls, per-staff overrides, superadmin management with the escalation rule, platform Integrations (WhatsApp credentials entered here, encrypted), the logs UI with the user timeline, and the clinic onboarding wizard. Stop when done and report.
```

**Phase 3:**
```
Continue with Phase 3 (Patients). Re-read docs/03 §4, 04 (patients permissions, own-scope rule and patient field registry), 11 §6–7 and 16 §5–6 (patient form validation and UX). Stop when done and report.
```

**Phase 4:**
```
Continue with Phase 4 (Scheduling & Appointments). Re-read docs/06 fully, docs/03 §5 and docs/16 §6. Implement the availability engine as a pure function with thorough tests first. Then booking with slotLocks in a transaction (include the 20-parallel-bookings concurrency test), then the state machine, BullMQ reminders, sockets, and the calendar + quick-book + today board UI. Stop when done and report.
```

**Phase 5:**
```
Continue with Phase 5 (Clinical). Re-read docs/07 fully and docs/03 §6. Build the <ToothChart> SVG component carefully (FDI numbering, surfaces, layers, RTL-safe orientation, keyboard accessible). Stop when done and report.
```

**Phase 6:**
```
Continue with Phase 6 (Billing & Accounting). Re-read docs/09 fully, docs/03 §7–8 and docs/16 §5.4 (money and cross-field validation). Implement money.ts and the posting-rule builders as pure functions with tests first. Then the journal service, invoices, payments, cash sessions, insurance claims, suppliers/expenses, JoFotara (feature-flagged; use C:\Users\ASUS\Desktop\hakeemna\hakeemna-backend\controller\companies\invoicing\invoicing.controller.js as domain reference for the UBL XML) and the financial reports. Stop when done and report.
```

**Phase 7:**
```
Continue with Phase 7 (HR & Payroll). Re-read docs/08 fully, docs/03 §9 and docs/09 §4.7. calculatePayslip must be a pure function with table-driven tests. Salary fields must respect field-level permissions. Stop when done and report.
```

**Phase 8:**
```
Continue with Phase 8 (Notifications & WhatsApp). Port the Mazbot client logic from C:\Users\ASUS\Desktop\hakeemna\hakeemna-backend\utils\mazbot.js into a typed client (throttling, phone normalisation). Credentials and template ids come ONLY from platformSettings (entered by the superadmin in the UI, encrypted), never from .env. Stop when done and report.
```

**Phase 9:**
```
Continue with Phase 9 (Patient Portal). Re-read docs/01 §4.10, docs/06 §2 (online booking rules), docs/10 §8 and docs/16 §6. Mobile-first, Arabic-first. Stop when done and report.
```

**Phase 10:**
```
Continue with Phase 10 (Dashboards, Reports & Inventory). Stop when done and report.
```

**Phase 11:**
```
Continue with Phase 11 (Hardening & Deploy). Go through docs/11_SECURITY.md and docs/16 §7 as checklists and report each item as done/not done. Add Playwright e2e for the critical journeys in both languages, Dockerfiles, production compose and an encrypted backup script, and write docs/DEPLOYMENT.md. Stop when done and report.
```

---

## Useful extra prompts
- **Resume after a break:** `Read CLAUDE.md and docs/13_ROADMAP.md, tell me which phase we're in and what's left, then continue.`
- **Fix failing tests:** `Run lint, typecheck and tests in backend and frontend, fix every failure without weakening tests, and summarise the fixes.`
- **UI review of a screen:** `Review the <screen> against docs/16 §7 (RTL/LTR, dark mode, all states, validation, field permissions) and fix every gap.`
- **Add a feature:** `I want <feature>. First update the relevant docs/ files (data model, permissions + field registry, API, module doc, validation rules, roadmap) and show me the changes, then implement it after I approve.`
