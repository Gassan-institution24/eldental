# CLAUDE.md — ElDental

Rules for any AI-assisted session in this repository. Read this first, every session.

## What this is
ElDental is a multi-clinic SaaS for dental clinics.
- `backend/`: Node 20 + Express + TypeScript + Mongoose 8 + Zod + BullMQ/Redis + Socket.IO.
- `frontend/`: Vite + React 18 + TypeScript + MUI v5 + TanStack Query + RHF/Zod + i18next (Arabic RTL default).

It is a re-design of the Hakeemna project (`C:\Users\ASUS\Desktop\hakeemna`). It **does not have** work groups, departments or employee engagements.

## Source of truth
The specs live in `docs/`. Read the relevant ones before touching a module:
| Doc | Use when |
|---|---|
| `docs/01_PRD.md` | scope / what to build |
| `docs/02_ARCHITECTURE.md` | folder layout, layering, pipeline, tenancy, events/jobs |
| `docs/03_DATA_MODEL.md` | any model/field/index |
| `docs/04_ROLES_AND_PERMISSIONS.md` | any route, guard, role |
| `docs/05_API_CONVENTIONS.md` | URLs, envelope, errors, pagination, endpoint map |
| `docs/06_MODULE_APPOINTMENTS.md` | scheduling |
| `docs/07_MODULE_DENTAL_CLINICAL.md` | chart, plans, procedures, notes… |
| `docs/08_MODULE_HR.md` | HR, leave, payroll |
| `docs/09_MODULE_ACCOUNTING.md` | billing, ledger, reports, JoFotara |
| `docs/10_FRONTEND.md` | frontend structure & conventions |
| `docs/11_SECURITY.md` | auth, hardening, never-do list |
| `docs/12_CODING_STANDARDS.md` | style, tests, definition of done |
| `docs/13_ROADMAP.md` | phase checklist (tick boxes as you finish) |
| `docs/14_HAKEEMNA_REFERENCE.md` | what to borrow / not borrow from Hakeemna |
| `docs/15_LOGGING_AND_MONITORING.md` | audit, user activity, user issues, system errors, request logs |
| `docs/16_UX_UI_AND_VALIDATION.md` | design system, screen UX, **input validation rules**, UI definition of done |

If the code needs to differ from a doc, **ask the user first**, then update the doc in the same commit.

## Non-negotiables
- Every route uses `authorize('<perm>')` or `public()`. Every tenant model has the `tenantPlugin`. Records outside the tenant or scope return 404.
- Money is integer minor units through `shared/money.ts`. Never floats.
- Posted journal entries and issued invoices are immutable. Corrections are reversals or credit notes.
- Multi-document writes use `withTransaction`. Side effects (email, WhatsApp, JoFotara) run in BullMQ jobs after commit.
- Zod validation on every request. Uniform envelope `{ data, meta }` / `{ error: { code, message, details } }`.
- Read `env` only from `config/env.ts` (backend) and `config/env.ts` (frontend).
- **Never overwrite or commit `.env` files.** Add new variables to both `.env.example` and `.env`.
- No `any`, no `console.log`, no hard-coded UI strings (ar + en together).
- **One input per text field.** Never create `nameAr`/`nameEn` (or `name_english`/`name_arabic`) pairs. The UI is translated ar/en; user data is typed once (`03_DATA_MODEL.md` §1.1).
- **Full input validation** on every form, following `16_UX_UI_AND_VALIDATION.md` §5: the same Zod rules on client and server, error codes translated ar/en, errors on blur and submit, server errors mapped to fields.
- **Full UX/UI** on every screen: RTL + LTR, light/dark, responsive, all states (loading/empty/error/no-permission/offline), per `16` §7.
- **Field-level permissions** on every resource with personal, financial or clinical data. Hidden fields never leave the API; masked fields are masked by the server (`04` §4).
- **Root superadmin** sees and does everything and manages other superadmins' permissions (`04` §8).
- **Everything is logged:** audit, user activity, user issues, system errors and requests (`15`). No secrets or typed values in logs.
- **No integration credentials in `.env`** (WhatsApp, JoFotara). They are entered in the app and stored encrypted.
- Don't add dependencies not listed in the docs without saying why.

## Commands
```bash
docker compose up -d                 # mongo (rs0) + redis + mailpit (http://localhost:8025)
cd backend  && npm run dev           # API on http://localhost:4000  (docs: /api/docs)
cd backend  && npm run worker        # BullMQ workers (if not run in-process)
cd backend  && npm run seed          # root superadmin + demo clinic
cd frontend && npm run dev           # http://localhost:5173
npm run lint && npm run typecheck && npm test   # in each app, before every commit
```

## Workflow
1. Work phase by phase from `docs/13_ROADMAP.md`. Don't start the next phase without the user's go-ahead.
2. After each phase: lint, typecheck and tests green in both apps; tick the roadmap boxes; commit (Conventional Commits); summarise what was built and how to try it.
3. Do not push to the remote unless the user asks.

## Environment
- Windows 11 dev machine; the Bash tool is Git Bash. Use forward slashes in scripts. npm scripts must be cross-platform (use `cross-env` if env vars are needed in scripts).
- Node at `C:\Program Files\nodejs\node.exe`.
- Timezone `Asia/Amman`, currency `JOD` (3 decimals), default language Arabic.
