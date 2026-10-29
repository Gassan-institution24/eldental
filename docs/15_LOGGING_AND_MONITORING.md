# ElDental — Logging, Activity Tracking & Monitoring

> Requirement: **everything is recorded.** That means logs and errors, every movement a user makes, and any trouble a user faces. Superadmins can see all of it across clinics. Clinic owners can see their clinic's part.

---

## 1. What is recorded (five streams)

| Stream | Collection | What | Written by |
|---|---|---|---|
| **Audit** | `auditLogs` | Business changes: create/update/delete/status change with a before/after diff; login/logout/failed login; permission changes; exports; prints; impersonation | backend services (`auditService.record`) |
| **Activity** | `activityLogs` | User **movements**: pages opened, tabs, dialogs opened, searches, filters applied, buttons for key actions, file downloads, session start/end, clinic switch, language switch | frontend tracker → `POST /telemetry/activity` (batched), plus backend API action summaries |
| **User issues** | `clientIssues` | **Troubles users face**: JS errors/crashes (error boundary), failed API calls (4xx/5xx with code), validation failures shown to the user (which field, which rule), slow pages (> 3 s), network offline, permission denied screens, rage-clicks, and "Report a problem" submissions with an optional screenshot | frontend → `POST /telemetry/issues`; backend adds server-side 4xx context |
| **System errors** | `systemErrors` | Unhandled server errors (500), job failures, integration failures (WhatsApp, JoFotara, SMTP), with stack, request context, and an occurrence counter (deduplicated by fingerprint) | backend error handler, BullMQ failed-job hook |
| **Requests** | `requestLogs` | Every API request: method, route pattern, status, duration, user, clinic, IP, user agent, reqId. No bodies. | `pino-http` → Mongo sink (sampled 100% for mutations; reads configurable) + stdout |

Shared fields on all streams:
- `at`
- `clinicId?`
- `userId?`, `staffId?`, `impersonatorUserId?`
- `sessionId` (a random id per login session, sent as the `X-Session-Id` header)
- `reqId` (correlates a UI issue with the server request and error)
- `ip`, `userAgent`
- `appVersion`
- `locale`

All five streams are linked by `sessionId` and `reqId`, so a superadmin can open **one user session timeline** and see:

> pages visited → actions → validation errors → failed request → server error → audit changes

---

## 2. Data shapes

```ts
activityLogs: {
  type: 'page_view' | 'action' | 'search' | 'filter' | 'download' | 'session_start' | 'session_end' | 'clinic_switch' | 'language_switch',
  route: string,            // route pattern, e.g. /clinic/patients/:id/chart
  entity?: string, entityId?: string,
  action?: string,          // e.g. 'appointment.book.click'
  meta?: Record<string, unknown>,   // small, PII-free (ids, counts, filter names — never values typed by the user)
  durationMs?: number,      // time on page
}

clientIssues: {
  kind: 'js_error' | 'api_error' | 'validation_error' | 'slow_page' | 'offline' | 'permission_denied' | 'rage_click' | 'user_report',
  severity: 'low' | 'medium' | 'high',
  message: string, code?: string,            // error code (e.g. APPOINTMENT_SLOT_TAKEN)
  route: string, component?: string,
  stack?: string,                            // source-mapped on the server if source maps are uploaded
  api?: { method, path, status, durationMs, reqId },
  validation?: { form: string, fields: [{ field, rule }] },   // which field failed which rule — never the value
  userComment?: string, screenshotFileId?: FileRef,           // "Report a problem"
  status: 'new' | 'acknowledged' | 'resolved' | 'ignored',
  fingerprint: string, occurrences: number, firstAt, lastAt,  // grouped
}

systemErrors: {
  fingerprint, message, code, stack, route, method, status, reqId,
  source: 'http' | 'job' | 'socket' | 'integration',
  integration?: 'whatsapp' | 'jofotara' | 'smtp' | 'storage',
  occurrences, firstAt, lastAt, status: 'new' | 'acknowledged' | 'resolved', resolvedBy?, notes?
}
```

**Privacy rules:**
- Logs never store passwords, tokens, OTPs, raw national IDs, full card or bank numbers, or field **values** typed into forms. Only field names and rule names.
- Clinical text never goes into activity or issue logs.

---

## 3. Frontend tracking
- `lib/telemetry.ts`:
  - a queue that flushes every 5 s or 20 events, and on `visibilitychange`/`pagehide` (via `navigator.sendBeacon`);
  - retries when offline;
  - an `X-Session-Id` header on every request.
- **Automatic:** page views (router listener), API errors (axios interceptor), JS errors (`ErrorBoundary` + `window.onerror` + `unhandledrejection`), slow navigation (Performance API), offline/online.
- **Validation tracking:** a hook in the shared RHF form wrapper sends `validation_error` once per submit attempt, with `{form, fields:[{field, rule}]}`. This shows which inputs confuse users.
- **Key actions:** `track('appointment.book.click')` on important buttons. A list of required action names lives in `shared/telemetry/actions.ts`.
- **"Report a problem":** a button in the user menu and on every error screen. It opens a dialog with a comment, an optional screenshot (`html2canvas`, user-confirmed), and automatically attached context (route, last 20 activity events, last failed reqIds).
- Error screens show a friendly ar/en message, a **reference code** (`reqId`) and the report button.

## 4. Backend
- **`requestLogger`:** pino-http with redaction; writes `requestLogs` asynchronously (buffered bulk insert) so it never blocks the request.
- **`errorHandler`:**
  - 4xx errors are logged in `requestLogs` with the error code;
  - 5xx errors are stored or incremented in `systemErrors` by fingerprint (error name + top stack frame + route);
  - superadmins get a notification and socket event `system-error` (throttled: at most 1 per fingerprint per 10 min).
- **BullMQ:** the `failed` event on every queue goes to `systemErrors` (`source: job`). Integrations log each failure with the provider response.
- **Retention** (configurable in platform settings), enforced with TTL indexes:
  - `requestLogs` 30 days;
  - `activityLogs` 180 days;
  - `clientIssues` 365 days;
  - `systemErrors` until resolved + 365 days;
  - `auditLogs` kept permanently by default.
- Logs are written to separate collections (optionally a separate database `eldental_logs`), so log volume never slows clinical data.

## 5. Viewing logs (UI)
**Superadmin** (`/admin/logs`, permissions `platform.logs.*`):
- Tabs: Audit · Activity · User issues · System errors · Requests.
- Filters on every tab: clinic, user, date range, type/kind, severity, status, route, error code, reqId. Full-text search on messages.
- **User timeline:** pick a user (or click any log row) to see a chronological merge of all five streams for a session or date range, with colour-coded rows and drill-down to the entity.
- **Issues board:** issues grouped by fingerprint with occurrences, users affected, first/last seen, status workflow (new → acknowledged → resolved), notes, and an "assign to" field.
- **Dashboard widgets:** errors in the last 24h, top failing endpoints, top validation failures by form/field, slowest pages, active users now, failed logins (security).
- Export to CSV (audited).

**Clinic** (`/clinic/settings/logs`, permissions `logs.*`):
- The clinic's own audit, activity and issues, using the same UI filtered to the clinic.
- Field rules apply.
- Staff with `logs.activity.read` (own) see only their own activity.

## 6. Alerts
- New `systemErrors` fingerprint or a spike (> N per 5 min) → superadmin notification (in-app + email).
- More than 10 failed logins for one account or IP in 10 min → security alert + temporary lock (see `11_SECURITY.md`).
- Integration down (WhatsApp/JoFotara failing for more than 15 min) → alert, plus a banner in the affected clinics' settings.

## 7. Tests
- Error handler: a 500 creates or increments `systemErrors` with the same fingerprint.
- The telemetry endpoints reject oversized payloads and strip unknown fields. Redaction unit tests confirm no secrets in logs.
- Field rules are applied when viewing audit diffs.
- Retention TTL indexes exist.
