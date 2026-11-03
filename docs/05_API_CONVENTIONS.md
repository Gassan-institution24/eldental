# ElDental — API Conventions & Endpoint Map

---

## 1. Basics
- Base URL: `/api/v1`. Breaking changes require `/api/v2`.
- JSON only (except uploads: `multipart/form-data`; downloads: binary).
- Resource paths are **kebab-case plural nouns**: `/appointment-types`, `/treatment-plans`, `/journal-entries`.
- Actions that are not CRUD use a verb sub-resource with `POST`: `/appointments/:id/cancel`, `/invoices/:id/issue`.
- IDs are Mongo ObjectIds as strings. A malformed id returns 400 from validation.
- Times are ISO-8601 UTC in requests and responses. Date-only fields (`2026-10-29`) are clinic-local calendar dates.
- Money is an integer in **minor units** plus a `currency` code. The frontend formats it.

## 2. Auth headers
- `Authorization: Bearer <accessToken>` (access token is short-lived and kept in memory).
- The refresh token is an **httpOnly, Secure, SameSite=Strict cookie**, path `/api/v1/auth`.
- Mutating requests from browsers must include `X-Requested-With: XMLHttpRequest`. This acts as CSRF defense together with SameSite and the CORS allow-list.
- Payments, refunds and invoice issue accept an `Idempotency-Key: <uuid>` header. A repeated key returns the original result.

## 3. Response envelope
Success:
```json
{ "data": { … } }
{ "data": [ … ], "meta": { "page": 1, "limit": 25, "total": 312, "pages": 13 } }
```
Error:
```json
{ "error": { "code": "APPOINTMENT_SLOT_TAKEN", "message": "The selected time is no longer available.",
             "details": { "conflicts": [ … ] }, "requestId": "01J…" } }
```
- `code` is a stable UPPER_SNAKE identifier. The frontend translates it with i18n key `errors.<CODE>`. `message` is English and meant for logs and developers.
- Validation errors: `422 VALIDATION_ERROR`, with `details.fields = [{ path: "lines.0.quantity", code: "too_small", message }]`.

| Status | When |
|---|---|
| 200 / 201 / 204 | OK / created (with `Location` header) / no content |
| 400 | Malformed request |
| 401 `UNAUTHENTICATED` / `TOKEN_EXPIRED` | Client should refresh on `TOKEN_EXPIRED` |
| 403 `FORBIDDEN` | Missing permission |
| 404 `NOT_FOUND` | Also returned for records outside the tenant or scope |
| 409 | Conflicts: duplicate, slot taken, state-machine violation (`INVALID_STATE_TRANSITION`), stale version (`VERSION_CONFLICT`) |
| 422 | Validation |
| 423 `PERIOD_CLOSED` | Posting into a closed accounting period |
| 429 | Rate limited |
| 500 | `INTERNAL_ERROR` (never leaks a stack trace in production) |

## 4. Lists: pagination, sort, filter, search
```
GET /patients?page=1&limit=25&sort=-createdAt,lastName&q=ahmad&status=active&createdFrom=2026-01-01&createdTo=2026-12-31
```
- `limit` ≤ 100 (default 25). `sort` is a comma list; `-` means descending. Only whitelisted fields per resource are allowed.
- `q` is free-text search on whitelisted fields (text index or anchored, escaped regex). User input is **never** turned into a raw regex.
- Filters are explicit Zod-typed query params per resource. There is no generic `?filter=` JSON and no `populate`/`select` passthrough. These were Hakeemna anti-patterns.
- Large feeds (audit logs, message logs) use cursor pagination: `?cursor=<opaque>&limit=50` → `meta.nextCursor`.
- Calendar queries use ranges: `GET /appointments?from=…&to=…&dentistId=…&chairId=…` (max range 42 days).

## 5. Concurrency
- Editable documents return `version` (Mongoose `__v` exposed as `version`).
- `PATCH` must send `version`. A mismatch returns `409 VERSION_CONFLICT`.

## 6. OpenAPI
- Every route registers its Zod schemas with the OpenAPI registry.
- `GET /api/docs` serves Swagger UI and `GET /api/docs/openapi.json` serves the spec. Both are enabled in dev.
- The frontend can generate types from the spec (`npm run gen:api`), or share Zod schemas via the `shared` folder if you set up a workspace.

---

## 7. Endpoint Map

> `[perm]` = required permission. `public` = no auth. `patient` = patient token.

### Auth `/auth`
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | public. `{ email|phone, password }` returns `{ accessToken, user, clinics[] }`; sets the refresh cookie. If the user has more than one clinic, `clinicId` is null until select-clinic. |
| POST | `/auth/select-clinic` | `{ clinicId }` returns a clinic-scoped access token |
| POST | `/auth/refresh` | cookie. Rotates the refresh token and returns a new access token. Reuse of a revoked token revokes the whole family. |
| POST | `/auth/logout` | revokes the current refresh family |
| POST | `/auth/logout-all` | revokes all of the user's refresh tokens |
| GET | `/auth/me` | `{ user, clinic, staff, grants, isOwner }` |
| POST | `/auth/password/forgot` | public, rate-limited. Always returns 204 (no user enumeration). |
| POST | `/auth/password/reset` | public `{ target, code, newPassword }` |
| POST | `/auth/password/change` | `{ currentPassword, newPassword }`; revokes other sessions |
| POST | `/auth/invitations/accept` | public `{ token, password }`, for staff invite |
| POST | `/auth/verify/send` · `/auth/verify/confirm` | email/phone OTP |
| POST | `/auth/mfa/setup` · `/mfa/enable` · `/mfa/disable` · `/auth/login/mfa` | optional TOTP |
| POST | `/auth/patient/register` | public. Patient portal signup (OTP verified). |

### Platform (superadmin) `/admin`
Implemented: `GET /admin/stats` · `/admin/clinics` (list with `q/status/subscription/planId`, get, `POST` create + owner invite, `PATCH` edit, `POST /:id/suspend` · `/:id/activate` with optional reason, `PATCH /:id/subscription`) · `/admin/plans` CRUD · `/admin/catalog/{procedures,tooth-conditions,medicines,countries,cities,currencies}` CRUD · `GET /admin/permission-registry` · `GET /admin/role-templates`, `PUT /admin/role-templates/:key`, `POST /admin/role-templates/:key/reset` · `GET /admin/users` (`q/kind/status`), `POST /admin/users/:id/{disable,enable,unlock}` · `/admin/superadmins` (list, invite, `PUT /:id/permissions`, `POST /:id/{disable,enable}`) · `GET /admin/platform-permissions` · `GET /admin/logs/{audit,activity,issues,errors,requests}` (filters `clinicId,userId,from,to,q,status,type`; `format=csv` for export) · `PATCH /admin/logs/{issues,errors}/:id` · `GET /admin/logs/timeline?userId|sessionId&from&to`.
Planned (not built yet): settings & integrations, impersonation, cross-tenant explorer, announcements, tickets.

Full spec: `/admin/superadmins` (list/invite/disable; `PUT /:id/permissions`, enforcing the escalation rule) · `/admin/platform-permissions` (registry for the editor) · `/admin/settings` and `PUT /admin/settings/integrations/whatsapp` (credentials write-only, never returned) + `POST /admin/settings/integrations/whatsapp/test` · `/admin/logs/{audit,activity,issues,errors,requests}` (filters + CSV export) · `GET /admin/logs/timeline?userId&sessionId&from&to` · `PATCH /admin/logs/issues/:id` and `/admin/logs/errors/:id` (status/notes/assignee) · `/admin/clinics/:clinicId/data/<resource>` (cross-tenant explorer; audited) ·
`/admin/clinics` (CRUD, `/:id/suspend`, `/:id/activate`, `/:id/impersonate`) · `/admin/plans` · `/admin/subscriptions` · `/admin/catalog/procedures` · `/admin/catalog/tooth-conditions` · `/admin/catalog/medicines` · `/admin/catalog/countries` · `/admin/catalog/cities` · `/admin/catalog/currencies` · `/admin/role-templates` · `/admin/users` · `/admin/system-errors` · `/admin/announcements` · `/admin/tickets` · `/admin/audit-logs` · `/admin/stats`.

### Clinic settings
| Path | Perm |
|---|---|
| `GET/PATCH /clinic` | clinic.settings.* |
| `PUT /clinic/integrations/jofotara` | clinic.settings.update |
| `/chairs` CRUD | clinic.chair.manage |
| `/appointment-types` CRUD | clinic.appointmentType.manage |
| `/procedures` CRUD (`/procedures/import-from-catalog`) | clinic.procedure.manage |
| `/tax-rates` CRUD | accounting.account.manage |

### Staff & roles
`/staff` (list/get/invite/update/deactivate; `?specialty=` filter; `GET /staff/specialties` = the clinic's specialties derived from its doctors; `POST /staff/:id/transfer-ownership` owner only, with password; `/staff/:id/roles` PUT (roles only, never ownership); `/staff/:id/permission-overrides` GET/PUT; `/staff/:id/effective-permissions` GET) · `/staff/me` · `/roles` CRUD (`/roles/templates`, `/roles/:id/clone`, `POST /roles/:id/preview-diff`) · `/permissions` (registry **including field registry** for the role editor UI).

Responses of every resource are filtered by the caller's field rules (hidden fields absent, masked fields masked). Writing a non-writable field returns `403 FIELD_FORBIDDEN { fields }`.

### Telemetry & clinic logs
`POST /telemetry/activity` (batched events, beacon-friendly) · `POST /telemetry/issues` (errors, failed calls, validation failures, user reports with an optional screenshot) · `/logs/{audit,activity,issues}` (clinic-scoped views; `logs.*` permissions).

### Patients
`/patients` CRUD + `/patients/:id/merge` · `/patients/search?q=` (fast typeahead) · `/patients/:id/timeline` (each event type only with its own read permission and scope: appointments, procedures, plans, notes, invoices, payments, medical history, documents) · `/patients/:id/family` (GET members in scope; POST `{ patientId }` links them, joining both families; DELETE removes this patient from the family — the `guardian` field rules apply) · `/patients/:id/medical-history` (GET latest, POST new version, GET `/versions`) · `/patients/:id/insurance-policies` · `/patients/:id/documents` (upload/list) · `/patients/:id/balance` · `/patients/:id/statement?from&to` (PDF) · `/patients/export` (async job, returns a download link).

### Scheduling
| Method | Path | Notes |
|---|---|---|
| GET | `/availability?dentistId&chairId&appointmentTypeId&from&to&durationMin` | free slots |
| GET | `/appointments?from&to&dentistId&chairId&patientId&status` | calendar/list |
| POST | `/appointments` | book (`scheduling.appointment.book`) |
| PATCH | `/appointments/:id` | reschedule, change dentist/chair/notes |
| POST | `/appointments/:id/confirm` · `/check-in` · `/seat` · `/complete` · `/no-show` · `/cancel` | state transitions |
| GET | `/appointments/today-board` | front-desk board grouped by status |
| GET/PUT | `/dentist-schedules/:staffId` | weekly template |
| CRUD | `/schedule-exceptions` | |
| CRUD | `/waiting-list` · POST `/waiting-list/:id/offer` | |
| CRUD | `/recalls` · GET `/recalls/due` | |

### Clinical
`/patients/:id/chart` (GET; POST `/chart/entries`) · `/patients/:id/perio-charts` · `/treatment-plans` (CRUD, `/:id/present`, `/:id/accept`, `/:id/items/:itemId/status`) · `/performed-procedures` (POST, `/:id/void`) · `/clinical-notes` (+ `/:id/sign`, `/:id/amend`) · `/note-templates` · `/prescriptions` (+ `/:id/pdf`) · `/lab-orders` (+ status transitions) · `/consent-templates` · `/consents` (+ signature upload).

### Billing
| Path | Notes |
|---|---|
| `/invoices` CRUD (draft) | list filter `dentistId` (header or any line doctor); DTO has `dentist`, `doctors`, `multipleDoctors`, `lines[].dentistName/dentistLocked` |
| `GET /billing/dentists` | active dentists/hygienists, id + name only (invoice doctor picker) |
| `POST /invoices/from-appointment/:appointmentId` | build a draft from performed procedures |
| `POST /invoices/:id/issue` | assigns the number, posts the journal, queues the e-invoice (idempotent) |
| `POST /invoices/:id/void` · `POST /invoices/:id/credit-note` | |
| `GET /invoices/:id/pdf` | |
| `/payments` (POST with allocations; GET) · `POST /payments/:id/refund` · `GET /payments/:id/receipt` | |
| `/insurance-companies` CRUD · `/insurance-claims` CRUD + `/submit` `/record-response` `/record-payment` | |
| `/cash-sessions` (open/close/current) | |

### Accounting
`/accounts` (tree; CRUD; `/accounts/:id/ledger?from&to`) · `/journal-entries` (list/get; POST manual draft; `/:id/post`; `/:id/reverse`) · `/fiscal-years` · `/fiscal-periods/:id/close|reopen` · `/suppliers` CRUD · `/supplier-bills` CRUD + `/post` · `/supplier-payments` · `/expenses` CRUD + `/approve` · `/einvoices` (list, `/:invoiceId/resubmit`).

Reports `/reports/accounting/…`: `trial-balance`, `profit-and-loss`, `balance-sheet`, `cash-flow`, `general-ledger`, `ar-aging`, `ap-aging`, `vat-return`, `daily-cash`. All take `?from&to&format=json|pdf|xlsx`.

### HR
`/shifts` CRUD · `/attendance` (list; `POST /attendance/check-in`; `/check-out`; `PATCH /:id` adjust) · `/leave-types` CRUD · `/leave-balances?staffId&year` · `/leave-requests` (POST own; `/:id/approve|reject|cancel`) · `/salary-components` CRUD · `/payroll-runs` (POST create for a period; `/:id/calculate`; `/:id/approve`; `/:id/mark-paid`) · `/payslips` (list; `/:id/pdf`; `/:id/acknowledge`).

### Inventory
`/inventory/items` CRUD · `/inventory/movements` (POST adjust/consume).

### Notifications
`/notifications` (list; `/:id/read`; `/read-all`) · `/notification-preferences` · `/message-logs` (clinic admin view).

### Reports (operational)
`/reports/dashboard` · `/reports/appointments` · `/reports/no-shows` · `/reports/production?groupBy=dentist|procedure|day` · `/reports/collections` · `/reports/recalls` · `/reports/new-patients`.

### Files
`GET /files/:id` (authorised download / signed redirect) · `DELETE /files/:id`.

### Patient portal `/portal` (patient token)
`/portal/me` (GET: account, linked files and dependants; PATCH: name, email, language) · `/portal/clinics` (public: clinics with online booking) · `/portal/clinics/:slug` (public: online appointment types, bookable dentists, cancellation and lead-time rules) · `/portal/clinics/:slug/availability?appointmentTypeId&dentistId?&from&to` (public, online rules, ≤ 14 days) · `POST /portal/link-patient/start` + `POST /portal/link-patient` (OTP to the phone on the clinic file) · `POST /portal/dependants` (child under one of the account's files) · `/portal/appointments` (list; `POST` books online and opens a file at a clinic where the account has none; `POST /:id/cancel` only before `cancellationWindowHours`) · `/portal/treatment-plans` (shared plans only, never drafts; `POST /:id/accept` with signature, presented and not expired) · `/portal/billing` (issued invoices, payments, balances) · `/portal/invoices/:id/print` · `/portal/payments/:id/receipt` (same shapes as the clinic print endpoints). Every patient endpoint is limited to the account's files and their dependants; anything else is 404.

### System
`GET /health` · `GET /ready` · `GET /api/docs`.
