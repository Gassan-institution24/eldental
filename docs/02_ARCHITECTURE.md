# ElDental — Architecture

---

## 1. Tech Stack

### Backend (`backend/`)
| Concern | Choice |
|---|---|
| Runtime | Node.js 20 LTS (or 22), TypeScript 5 (`strict: true`), ESM |
| HTTP | Express 4 |
| DB | MongoDB 7 (replica set) + Mongoose 8 |
| Validation | Zod (request DTOs, env, and the source of OpenAPI) |
| API docs | `@asteasolutions/zod-to-openapi` + `swagger-ui-express` at `/api/docs` (disabled in production unless `ENABLE_API_DOCS=true`) |
| Auth | `jsonwebtoken` (access) + opaque rotating refresh tokens (hashed in DB), `bcrypt` (cost 12) |
| Security | `helmet`, `cors` (allow-list), `express-rate-limit` + `rate-limit-redis`, `express-mongo-sanitize`, `hpp`, `cookie-parser` |
| Jobs | BullMQ + Redis (reminders, recalls, emails, WhatsApp, JoFotara, reports) |
| Realtime | Socket.IO 4 with the Redis adapter; JWT auth on handshake; rooms per clinic/user |
| Logging | `pino` + `pino-http` (JSON, request id, redaction of secrets/PII) |
| Files | Storage driver interface: `local` (dev) / `s3` (prod). `multer` memory storage → driver. `file-type` sniffing. |
| PDF | `pdfmake` (server-side invoices, receipts, payslips, prescriptions), Arabic font embedded (Cairo/Amiri) |
| Email | `nodemailer` + MJML or Handlebars templates (ar/en) |
| Dates | `dayjs` with utc + timezone plugins. Store UTC, compute in the clinic TZ. |
| Money | Integer **minor units** (fils for JOD: 1 JOD = 1000) stored as `Number` (safe-integer) or `Decimal128`. **Never floats.** Helper lib `src/shared/money.ts`. |
| Tests | Vitest + supertest + `mongodb-memory-server` (replica-set mode) |
| Lint | ESLint (typescript-eslint) + Prettier |

### Frontend (`frontend/`)
See `10_FRONTEND.md`. Vite + React 18 + TS + MUI v5 + TanStack Query + react-hook-form + Zod + i18next.

### Infra
`docker-compose.yml` at the repo root runs Mongo (rs0), Redis and Mailpit for development. Production: Docker image per app, Nginx/Caddy reverse proxy with TLS, managed Mongo (Atlas) or a 3-node replica set.

---

## 2. Repository Layout

```
dentalproject/
├── README.md
├── CLAUDE.md                 # rules for AI-assisted development
├── BUILD_PROMPT.md           # prompts to build the project phase by phase
├── docker-compose.yml
├── .gitignore
├── docs/                     # specifications (this folder)
├── backend/
│   ├── .env / .env.example
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── server.ts         # boot: env → db → redis → http → socket → jobs
│   │   ├── app.ts            # express app factory (used by tests)
│   │   ├── config/           # env.ts (zod), logger.ts, db.ts, redis.ts
│   │   ├── core/             # cross-cutting framework code
│   │   │   ├── http/         # ApiError, errorHandler, response helpers, asyncHandler
│   │   │   ├── auth/         # authenticate middleware, token service
│   │   │   ├── rbac/         # permission registry, authorize(), scope helpers
│   │   │   ├── tenancy/      # tenantContext (AsyncLocalStorage), tenant plugin
│   │   │   ├── db/           # base plugins (audit, softDelete, sequence), transaction helper
│   │   │   ├── validation/   # validate({ body, query, params }) middleware
│   │   │   ├── audit/        # AuditLog model + service
│   │   │   ├── events/       # in-process domain event bus (typed)
│   │   │   ├── jobs/         # BullMQ queues + workers registry
│   │   │   ├── storage/      # local + s3 drivers
│   │   │   ├── notifications/# email, whatsapp (mazbot), socket, in-app
│   │   │   ├── pdf/          # pdfmake helpers, fonts
│   │   │   └── i18n/         # server-side message catalog (ar/en) for emails/PDFs
│   │   ├── shared/           # money.ts, dates.ts, phone.ts, pagination.ts, types
│   │   ├── modules/          # feature modules (see §3)
│   │   │   ├── auth/
│   │   │   ├── users/
│   │   │   ├── platform/     # clinics, plans, subscriptions (superadmin)
│   │   │   ├── catalog/      # global reference data
│   │   │   ├── staff/
│   │   │   ├── roles/
│   │   │   ├── patients/
│   │   │   ├── scheduling/   # chairs, schedules, appointment types, appointments, waitlist, recalls
│   │   │   ├── clinical/     # chart, treatment plans, procedures, notes, perio, rx, lab, imaging, consents
│   │   │   ├── billing/      # invoices, payments, insurance, price lists
│   │   │   ├── accounting/   # accounts, journals, periods, expenses, suppliers, reports
│   │   │   ├── hr/           # shifts, attendance, leave, payroll
│   │   │   ├── inventory/
│   │   │   ├── notifications/
│   │   │   ├── reports/
│   │   │   └── portal/       # patient-facing endpoints (thin layer over other services)
│   │   ├── routes.ts         # mounts every module router under /api/v1
│   │   └── scripts/          # seed.ts, create-superadmin.ts, migrations
│   └── test/                 # helpers, factories, tenant-isolation suite
└── frontend/
    ├── .env / .env.example
    └── src/ …               # see 10_FRONTEND.md
```

---

## 3. Module Template (backend)

Every feature module has this shape (example `modules/scheduling/appointments/`):

```
appointments/
├── appointment.model.ts        # Mongoose schema + TS type (InferSchemaType)
├── appointment.schemas.ts      # Zod DTOs: create/update/query/params + response
├── appointment.repository.ts   # ONLY place that touches the model; always tenant-scoped
├── appointment.service.ts      # business rules, transactions, emits domain events
├── appointment.controller.ts   # thin: parse → call service → send envelope
├── appointment.routes.ts       # router: authenticate → authorize → validate → controller
├── appointment.events.ts       # event names + payload types
├── appointment.openapi.ts      # registers paths with the OpenAPI registry
└── __tests__/
    ├── appointment.service.test.ts
    └── appointment.routes.test.ts
```

**Layering rules**
- `routes → controller → service → repository → model`. No skipping layers.
- Controllers never import models. Services never touch `req`/`res`.
- Cross-module calls go through the other module's **service** (never its repository). Side effects (e.g. "invoice issued → post journal") go through **domain events**.
- Multi-document writes that must be atomic (booking, invoice + journal, payment allocation, payroll posting) run inside `withTransaction(async (session) => …)`.

---

## 4. Request Pipeline

```
helmet → cors(allow-list, credentials) → requestId
→ [built frontend: static files + index.html fallback, only when FRONTEND_DIST_DIR is set; see DEPLOYMENT.md]
→ pino-http
→ rate-limit (global; stricter on /auth/*) → express.json({limit:'1mb'}) → cookieParser
→ mongoSanitize → hpp
→ /api/v1 router:
     authenticate (verify access JWT → req.auth = { userId, clinicId, staffId, kind, permissions })
     → tenantContext (AsyncLocalStorage.run({ clinicId, userId }))
     → authorize('scheduling.appointment.create', { scope })   # RBAC
     → validate({ body, query, params })                        # Zod → req.valid
     → controller
→ notFound → errorHandler (ApiError → envelope, ZodError → 422, Mongo dup → 409, else 500 + log)
```

- Upload routes get `multer` (memory, size limit) before `validate`.
- Public routes (login, public booking page, health) skip `authenticate` explicitly. There is **no** unauthenticated mutating route except auth and public booking (rate-limited, captcha-ready).
- `GET /health` (liveness) and `GET /ready` (Mongo + Redis ping).

---

## 5. Multi-Tenancy

- **Tenant = Clinic.** Every tenant-owned collection has `clinicId: ObjectId` (required, indexed, first field of every compound index).
- `tenantPlugin` (Mongoose) on every tenant model:
  - auto-sets `clinicId` from `tenantContext` on create;
  - adds `{ clinicId }` to every `find*`, `count*`, `update*`, `delete*` and `aggregate` (as the first `$match` stage);
  - **throws** if no tenant context exists and the query did not opt out with `.setOptions({ skipTenant: true })`. Opt-out is only allowed in superadmin and platform services and in jobs that pass an explicit clinicId.
- Repositories also pass `clinicId` explicitly (defense in depth).
- A **tenant-isolation test suite** creates two clinics and asserts that every list, get, update and delete endpoint of clinic A cannot see or touch clinic B's data.
- A user can belong to several clinics (several `Staff` documents). At login, if there is more than one, the client calls `POST /auth/select-clinic`. The access token is issued **per clinic**. Switching clinic means issuing a new token. There is no `selected_engagement` index stored on the user.

---

## 6. Data Conventions (summary — full detail in `03_DATA_MODEL.md`)

- camelCase field names, English, no abbreviations. Collections are plural camelCase (`appointments`, `journalEntries`).
- Base plugins:
  - `timestamps` (`createdAt`, `updatedAt`);
  - `auditFields` (`createdBy`, `updatedBy`);
  - `softDelete` (`deletedAt`, `deletedBy`; default queries exclude deleted);
  - `tenantPlugin`.
- **One input per text field.** User data is a plain `string`, typed once in any language. System-seeded records use `systemKey` + i18n (see `03_DATA_MODEL.md` §1.1). The UI itself is fully translated ar/en.
- Human-readable numbers (patient file no., invoice no.) come from `sequenceService.next(clinicId, 'invoice', { year })`, which does an atomic `findOneAndUpdate($inc)` on the `counters` collection. Format comes from clinic settings (e.g. `INV-2026-000123`).
- Optimistic concurrency (`optimisticConcurrency: true`) on documents edited by many people (appointments, treatment plans, invoices).

---

## 7. Domain Events & Jobs

Domain events are in-process, typed, and fired **after commit**:

| Event | Subscribers |
|---|---|
| `appointment.booked` / `.rescheduled` / `.cancelled` | notifications (queue WhatsApp/email), reminder job scheduling, socket broadcast |
| `appointment.completed` | billing (create draft invoice from performed procedures) |
| `procedure.completed` | billing, HR commission accrual |
| `invoice.issued` | accounting (post journal), JoFotara job |
| `payment.received` / `payment.refunded` | accounting (post journal), patient balance update, receipt PDF |
| `expense.approved`, `supplierBill.posted` | accounting |
| `payroll.approved` | accounting (post payroll journal), payslip notifications |

**BullMQ queues:**
- `notifications`
- `reminders`
- `recalls`
- `einvoice`
- `reports`
- `maintenance`

Repeatable jobs (cron) are registered **once** through BullMQ's repeat options, so they are safe with multiple API instances. This avoids Hakeemna's problem of `node-cron` running in every worker.

Workers can run in the API process (dev) or as a separate `npm run worker` process (prod).

---

## 8. Realtime (Socket.IO)
- The handshake requires the access token (`auth.token`). The server verifies it and joins rooms `clinic:{clinicId}`, `user:{userId}` and, for patients, `patient:{patientId}`.
- CORS is the same allow-list as HTTP (**never `*`**).
- Events:
  - `appointment:changed` (calendar live refresh)
  - `notification:new`
  - `queue:updated` (front-desk board)
- The Redis adapter makes events work across instances.

---

## 9. Files & Storage
- `StorageDriver` interface: `put(key, buffer, mime)`, `getSignedUrl(key, ttl)`, `delete(key)`.
- Keys: `clinics/{clinicId}/patients/{patientId}/{uuid}.{ext}`. They never contain user-supplied names.
- A `FileAsset` document stores metadata (owner, mime, size, sha256, original name, uploadedBy).
- Files are **never served from a public static folder**. Downloads go through `GET /files/:id` (authz check), which streams the file (local) or redirects to a short-lived signed URL (S3).

---

## 10. Configuration
- `src/config/env.ts` parses `process.env` with Zod at boot. A missing or invalid variable makes the process exit with a clear message.
- All other code imports `env` from there and never reads `process.env` directly.

---

## 11. Observability
- pino JSON logs with `reqId`, `userId`, `clinicId`. Passwords, tokens, `authorization`, `cookie`, national IDs and phones are redacted.
- Unhandled errors (500) are stored in `systemErrors` and visible to superadmins (Hakeemna parity).
- Optional: Sentry DSN via env.
