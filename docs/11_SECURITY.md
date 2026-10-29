# ElDental — Security

---

## 1. Authentication
| Topic | Rule |
|---|---|
| Passwords | bcrypt cost 12; min 10 chars; checked against a common-password list; never logged |
| Access token | JWT HS256 (`JWT_ACCESS_SECRET`), 15 min, claims `sub, kind, cid, sid, own, pv, iat, exp, jti`; kept **in memory** on the client |
| Refresh token | Opaque random 256-bit, **stored hashed** (sha256) in `refreshTokens`; httpOnly + Secure + SameSite=Strict cookie scoped to `/api/v1/auth`; 30 days; **rotated on every use** |
| Reuse detection | Presenting an already-rotated refresh token revokes the **whole family** and forces re-login (stolen-token defense) |
| Password change / reset | Sets `passwordChangedAt`; access tokens with `iat` < it are rejected; all refresh tokens are revoked except the current one |
| Lockout | 5 failed logins → exponential lockout (`lockedUntil`); per-IP and per-account rate limits on `/auth/*` |
| OTP | 6 digits, hashed, 10 min TTL, max 5 attempts, resend cooldown 60 s |
| Enumeration | Login and forgot-password responses do not reveal whether an account exists |
| MFA | Optional TOTP for staff; **required** for superadmins |
| `/auth/me` | Always verifies the token signature. Hakeemna used an unverified `jwtDecode` here; **never** do that. |
| Impersonation | Superadmin → clinic: a separate token with an `imp` claim, read-only by default, banner in the UI, every request audited |

## 2. Authorization
- Deny by default; `authorize()` or `public()` on every route (enforced by a test). See `04_ROLES_AND_PERMISSIONS.md`.
- Records outside the scope or tenant return **404**.
- Never trust client-sent `clinicId`, `createdBy`, `dentistId` (with own scope), totals, prices, or a status other than the action requested. The server derives or validates them.
- Mass assignment: Zod DTOs whitelist fields. Mongoose `strict: 'throw'` in dev and test.

## 3. Tenant Isolation
- `tenantPlugin` on every tenant model, plus explicit `clinicId` in repositories.
- Aggregations must start with `$match: { clinicId }`. A lint rule or helper `tenantAggregate()` enforces it.
- **Automated suite** `test/tenant-isolation.test.ts`: seeds clinics A and B, then for every registered route checks that A's token cannot read, list, update or delete B's records.
- Files: storage keys are prefixed with `clinics/{clinicId}`, and the download endpoint re-checks ownership.
- Sockets join only their own clinic room. Events never include other tenants' data.

## 4. HTTP Hardening
- `helmet()` with a strict CSP for the API (JSON only). The frontend host sets its own CSP (default-src 'self', no inline scripts).
- CORS: an allow-list from `CORS_ORIGINS`, `credentials: true`. **Never `*`**, including Socket.IO.
- Rate limits (Redis store):
  - global 300/min/IP;
  - `/auth/*` 10/min/IP and 5/min/account;
  - public booking 20/min/IP;
  - export endpoints 5/hour/user.
- Body limit 1 MB (uploads go through multer with their own limits).
- `express-mongo-sanitize` and `hpp`. All regex search input is escaped.
- `trust proxy` is configured to the actual number of proxies (not `true`).
- Errors: no stack traces or Mongo messages to clients in production.

## 5. Input & Output
- Zod validation on params, query and body for every route. Output DTO mappers strip internal fields (`passwordHash`, `__v` → `version`, encrypted secrets).
- HTML is never rendered from user input on the server. PDFs escape text.
- Phone numbers are normalised to E.164 (`libphonenumber-js`).

## 6. Files
- Allowed types: JPEG, PNG, WebP, PDF (plus DICOM later). Detected by **magic bytes** (`file-type`), not by extension or header.
- Size limit from `MAX_UPLOAD_MB`. Images are re-encoded (sharp) to strip EXIF/GPS.
- Stored outside the web root or in a private bucket. Downloads only through the authorised endpoint / short-lived signed URLs.
- File names are generated (uuid). The original name is metadata only.

## 7. Data Protection
- Sensitive fields:
  - national ID and passport: AES-256-GCM encrypted at rest, plus an HMAC search hash;
  - integration secrets: encrypted with `FIELD_ENCRYPTION_KEY`;
  - bank IBAN: encrypted.
- Logs redact authorization headers, cookies, passwords, tokens, OTPs, national IDs and phone numbers.
- Patient data export is audited and rate-limited.
- Soft delete by default. Hard delete only via a superadmin GDPR-style erase job that anonymises patient PII and keeps financial records (legal retention).
- Backups:
  - daily `mongodump --archive --gzip`;
  - **encrypted** (age/gpg) to off-site storage with 30-day retention;
  - a monthly restore drill is documented.

  Do **not** send database dumps through chat apps; Hakeemna sent them via Telegram.

## 8. Secrets & Config
- Infrastructure secrets (DB, Redis, JWT, encryption key, SMTP) go only in `.env` (gitignored) or the deployment secret store. `.env.example` has placeholders only.
- **Third-party integration credentials (WhatsApp/Mazbot, JoFotara) are never in `.env` or the repo.**
  - WhatsApp is entered by the superadmin in Admin → Settings → Integrations; JoFotara by each clinic in its settings.
  - Both are stored encrypted (`FIELD_ENCRYPTION_KEY`) and are write-only from the API.
- `env.ts` validates at boot, enforcing secret length ≥ 32 and `COOKIE_SECURE=true` in production.
- Rotate JWT secrets by supporting `JWT_ACCESS_SECRET_PREVIOUS` during the transition.

## 9. Audit Log
Logged: authentication events, role/permission changes, clinical record changes (chart, notes, plans, procedures), all financial actions (issue, void, refund, payments, journals, period close/reopen), HR compensation and payroll actions, exports, impersonation, settings changes.

## 10. Dependency & Supply Chain
- `npm audit` in CI (fail on high). Renovate/Dependabot. Lockfiles committed. No unused packages: Hakeemna shipped `fs`, `http` and `http2` stub packages, `mongoose-sequence` unused, and 4 different date libraries.

## 11. "Never Do" List (lessons from Hakeemna)
1. ❌ Unauthenticated destructive endpoints. Hakeemna had `DELETE /delete`, which wiped recent data in every collection.
2. ❌ Importing helmet and never calling `app.use(helmet())`.
3. ❌ Socket.IO `cors: { origin: '*' }`.
4. ❌ `eval()` of strings to resolve scopes (`inScope('…', 'req.params.id')`).
5. ❌ Decoding JWTs without verifying them (`jwtDecode` in `/me`).
6. ❌ Long-lived JWT in `localStorage` with no refresh/rotation.
7. ❌ Controllers swallowing errors into `req.error` and calling `next()`. In Hakeemna, routes without a trailing handler silently returned 404.
8. ❌ Running cron jobs in every cluster worker (duplicate reminders and double-processing). Use BullMQ repeatables.
9. ❌ Public static folders for patient uploads (`/uploaded-files`).
10. ❌ Generic `?populate=&select=` passthrough from the query string.
11. ❌ Rate limit of 100 req/**second** per IP (effectively none).
12. ❌ Money as floating-point numbers.
13. ❌ Unauthenticated third-party resource creation (Hakeemna's `POST /api/daily/create-room`).
