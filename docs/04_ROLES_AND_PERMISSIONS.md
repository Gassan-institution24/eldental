# ElDental — Roles & Permissions (fully customisable, down to the field)

---

## 1. Principles

1. **Permissions are code, roles are data.**
   - The list of permissions **and the list of fields of each resource** are typed constants in `backend/src/core/rbac/registry.ts`, exported to the frontend through the generated `frontend/src/shared/rbac/registry.ts`.
   - Roles are documents that bundle grants. They are fully editable per clinic.
2. **Deny by default.** Every route must declare `authorize(...)` or be explicitly marked `public()`. A test fails the build if any route has neither.
3. **Four levels of control:**
   - *Can the user use this module/action?* Permission key.
   - *On which records?* Scope: `own` or `all`.
   - *Which fields inside those records?* Field rules: `hidden`, `masked`, `read`, `write`.
   - *For this person specifically?* Per-staff overrides on top of their roles.
4. **Scopes, not work groups.** `own` = records where the user is the dentist, author, assignee or subject; `all` = whole clinic. This replaces Hakeemna's work-group scoping.
5. **Union of roles, then overrides.** For roles: `all` beats `own`, and for fields `write > read > masked > hidden`. Per-staff overrides are applied **after** and can both grant and restrict.
6. **Owner bypass.** The clinic owner (`staff.isOwner`, mirrored by `clinics.ownerUserId`) has every permission and every field inside **their own clinic**, whatever the roles say. Ownership is an identity, not a role or an override; see §9.
7. **The backend is the authority.** The UI hides or disables things for convenience. The API filters fields, rejects forbidden writes, and never returns hidden data.

---

## 2. Permission Key Format

```
<module>.<resource>.<action>
```
- `action` ∈ `read | create | update | delete | approve | export | print | manage` (plus specific verbs: `book`, `cancel`, `checkin`, `issue`, `post`, `void`, `refund`, `sign`).
- Example: "Employee A can see the employees" = grant `staff.member.read` (scope `all`) to A's role, or to A directly via an override.

```ts
export const PERMISSIONS = {
  'staff.member.read':   { resource: 'staff.member', scopes: ['own','all'], labelKey: 'perm.staff.member.read' },
  'staff.member.update': { resource: 'staff.member', scopes: ['all'],       labelKey: 'perm.staff.member.update' },
  // …
} as const;
export type PermissionKey = keyof typeof PERMISSIONS;
```
Labels are i18n keys (`ar`/`en` in the locale files). There are no bilingual fields in the data.

---

## 3. Permission Registry (clinic)

| Module | Permission | Scopes | Description |
|---|---|---|---|
| **clinic** | `clinic.settings.read` / `.update` | all | Clinic profile, hours, numbering, integrations |
| | `clinic.chair.manage` | all | Chairs & rooms |
| | `clinic.appointmentType.manage` | all | Appointment types |
| | `clinic.procedure.manage` | all | Clinic procedure list & prices |
| **staff** | `staff.member.read` | own, all | Staff directory (own = own profile) |
| | `staff.member.create` / `.update` / `.delete` | all | Invite, edit, deactivate staff |
| | `staff.member.export` | all | Export staff list |
| | `staff.role.manage` | all | Create/edit roles, assign roles, per-staff overrides |
| **patients** | `patients.patient.read` | own, all | own = patients with an appointment or treatment by me |
| | `patients.patient.update` | own, all | own = patients I treat (dentist template) |
| | `patients.patient.create` | all | |
| | `patients.patient.delete` | all | Soft delete / merge |
| | `patients.medicalHistory.read` / `.update` | own, all | |
| | `patients.document.read` / `.upload` / `.delete` | own, all | |
| | `patients.communication.read` / `.write` | own, all | own = patients in my patient scope. Templates: owner & receptionist all; dentist own read/write; hygienist own read |
| | `patients.patient.export` / `.print` | all | Export / print (audited) |
| **scheduling** | `scheduling.appointment.read` | own, all | own = I am the dentist or assistant |
| | `scheduling.appointment.book` | own, all | own = only into my own calendar |
| | `scheduling.appointment.update` / `.cancel` | own, all | Reschedule, cancel |
| | `scheduling.appointment.checkin` | all | Arrived / seated / complete |
| | `scheduling.schedule.read` / `.manage` | own, all | Dentist schedules & exceptions |
| | `scheduling.waitlist.manage` | all | |
| | `scheduling.recall.manage` | all | |
| **clinical** | `clinical.chart.read` / `.update` | own, all | Odontogram |
| | `clinical.treatmentPlan.read` / `.create` / `.update` / `.present` | own, all | |
| | `clinical.procedure.perform` | own | Record a performed procedure |
| | `clinical.procedure.void` | own, all | |
| | `clinical.note.read` / `.write` / `.sign` | own, all | |
| | `clinical.perio.read` / `.write` | own, all | |
| | `clinical.prescription.read` / `.write` | own, all | |
| | `clinical.certificate.read` / `.issue` | own, all | own = certificates I issued, for patients in my scope. Templates: dentist own read/issue; receptionist read all; owner all |
| | `clinical.labOrder.read` / `.manage` | own, all | |
| | `clinical.imaging.read` / `.upload` | own, all | |
| | `clinical.consent.manage` | all | |
| **billing** | `billing.invoice.read` | own, all | own = invoices where I am the header doctor **or** the doctor of at least one line (shared invoices are visible in full). Own also limits AR aging, patient statements, the patient billing summary and dashboard receivables to those invoices and to my attributed share (09 §8.1). Seeing an invoice never allows changing it. |
| | `billing.invoice.create` / `.update` / `.issue` / `.void` | all | |
| | `billing.invoice.discount` | all | Discount above the threshold |
| | `billing.payment.read` / `.create` / `.refund` | all | |
| | `billing.insurance.manage` | all | Insurers, policies, claims |
| | `billing.cashSession.manage` | all | |
| **accounting** | `accounting.account.read` / `.manage` | all | Chart of accounts |
| | `accounting.journal.read` / `.create` / `.post` / `.reverse` | all | |
| | `accounting.period.manage` | all | |
| | `accounting.supplier.manage` | all | |
| | `accounting.expense.create` / `.approve` | all | |
| | `accounting.report.read` / `.export` | all | |
| | `accounting.einvoice.manage` | all | JoFotara |
| **hr** | `hr.shift.manage` | all | |
| | `hr.attendance.read` | own, all | |
| | `hr.attendance.checkin` | own | |
| | `hr.attendance.adjust` | all | |
| | `hr.leave.request` | own | |
| | `hr.leave.read` | own, all | |
| | `hr.leave.approve` | all | |
| | `hr.leaveType.manage` | all | |
| | `hr.compensation.read` / `.update` | own, all | |
| | `hr.payroll.read` | own, all | |
| | `hr.payroll.run` / `.approve` | all | |
| **inventory** | `inventory.item.read` / `.manage`, `inventory.stock.adjust` | all | |
| **reports** | `reports.operational.read`, `reports.production.read`, `reports.dashboard.read` | own, all | |
| **logs** | `logs.audit.read` | all | Clinic audit trail |
| | `logs.activity.read` | own, all | User movements in this clinic (own = my own activity) |
| | `logs.issues.read` | all | Problems users hit in this clinic |

---

## 4. Field-Level Permissions

### 4.1 Field registry
Every resource that returns personal, financial or clinical data declares its fields in the registry, grouped for the UI:

```ts
export const RESOURCE_FIELDS = {
  'staff.member': {
    // field            group          default   flags
    name:             { group: 'basic',     default: 'read' },
    jobTitle:         { group: 'basic',     default: 'read' },
    staffType:        { group: 'basic',     default: 'read' },
    photo:            { group: 'basic',     default: 'read' },
    phone:            { group: 'contact',   default: 'read',   maskable: true },
    email:            { group: 'contact',   default: 'read',   maskable: true },
    address:          { group: 'contact',   default: 'hidden' },
    nationalId:       { group: 'identity',  default: 'hidden', maskable: true, sensitive: true },
    dateOfBirth:      { group: 'identity',  default: 'hidden' },
    licenseNumber:    { group: 'professional', default: 'read' },
    licenseExpiry:    { group: 'professional', default: 'read' },
    employment:       { group: 'employment',default: 'hidden' },
    basicSalary:      { group: 'compensation', default: 'hidden', sensitive: true },
    allowances:       { group: 'compensation', default: 'hidden', sensitive: true },
    commission:       { group: 'compensation', default: 'hidden', sensitive: true },
    bank:             { group: 'compensation', default: 'hidden', maskable: true, sensitive: true },
    roles:            { group: 'access',    default: 'read' },
  },
  'patients.patient': {
    name, fileNumber, gender, dateOfBirth, phone (maskable), altPhone (maskable), email (maskable),
    address, nationalId (maskable, sensitive), guardian, emergencyContact, insurance,
    balance (financial), medicalAlerts (clinical), tags, notes,
    referredBy, legacyFileNumber, photo, flags,                       // basic
    maritalStatus, occupation, nationality, idVerification,           // identity
    bloodType, vitals (heightCm, weightKg, bmi)                       // clinical
  },
  'billing.invoice':  { patient, lines, prices, discounts, totals, balanceDue, dentist, insuranceShare },
  'hr.payslip':       { basic, earnings, deductions, commission, socialSecurity, incomeTax, net },
  // … every resource listed in 03_DATA_MODEL.md that holds PII/financial/clinical data
} as const;
```

### 4.2 Access levels per field
| Level | Read API | Write API | UI |
|---|---|---|---|
| `hidden` | field **removed** from responses, exports, PDFs, search results, audit diffs shown to this user | forbidden | column/input not rendered |
| `masked` | returned masked by the server (e.g. `079•••••23`, `•••• 4821`); the raw value is never sent | forbidden | shows the masked value with a lock icon |
| `read` | returned | forbidden | read-only input / text |
| `write` | returned | allowed (still needs the resource's `update`/`create` action) | editable input |

### 4.3 Enforcement (backend)
- `fieldPolicy(auth, resource)` returns `{ visible: Set, masked: Set, writable: Set }`. It is computed once per request from the cached effective grants.
- **Reads:**
  - repositories build the Mongo **projection** from `visible ∪ masked`, so hidden data never leaves the DB;
  - the serializer applies masking;
  - exports, PDFs and socket payloads go through the same serializer.
- **Writes:** the controller compares the request body keys with `writable`. Any non-writable field returns `403 FIELD_FORBIDDEN { fields: [...] }`. The API **rejects** rather than silently dropping, so the UI shows a clear error.
- **No inference:** `sort`, `q` search and filters on hidden or masked fields return `422 FIELD_NOT_ALLOWED`. For example, you cannot search by national ID if you cannot see it.
- **Audit:** the audit viewer applies the viewer's field policy to `before`/`after` diffs.
- **Defaults:** if a grant has no `fields` entry, the registry default applies. `sensitive: true` fields default to `hidden` for every system role except Owner and the role that owns that data (HR for compensation, accountant for financial fields).

### 4.4 Per-staff overrides
`staff.permissionOverrides: Grant[]` is applied after roles:
- An override for a permission key **replaces** the merged result for that key, including scope and fields.
- `{ permission, revoked: true }` removes a permission that a role gives.
- Use case: "Employee A (receptionist) can see the employee list, but only names and phone numbers, not salaries". Give A an override `staff.member.read` (`all`) with fields `name: read, phone: read`, all others `hidden`.
- Overrides are listed on the staff profile ("Custom permissions" badge) and audited.

### 4.5 Frontend
- `GET /auth/me` returns `grants` with the effective scope and **field map** for every permission.
- `useFieldAccess('staff.member')` returns `{ canSee(f), canEdit(f), isMasked(f) }`.
- `RHF*` inputs accept `fieldKey`. They render nothing when the field is hidden, show a read-only masked value when masked, and are disabled when read-only, all automatically.
- DataGrid column definitions declare `fieldKey`. Hidden columns are removed, so the user cannot add them back through the column chooser.
- Detail pages hide whole sections when every field in a group is hidden.

---

## 5. System Role Templates

Seeded on clinic creation (cloned from global templates; editable). The "Owner" column is the **Full access** role (key `owner`, shown as "Full access" and given to managers by default): it holds every permission but is not the clinic owner identity (§9).

| Permission group | Owner | Dentist | Hygienist | Assistant | Receptionist | Accountant | HR Manager |
|---|---|---|---|---|---|---|---|
| clinic.* | ✅ all | – | – | – | read | read | read |
| staff.member | ✅ | read own | read own | read own | read all (basic+contact) | read all (basic) | ✅ all (all fields) |
| staff.role.manage | ✅ | – | – | – | – | – | – |
| patients.* | ✅ | read/update **own** + create | read own | read all | ✅ (no export; nationalId masked) | read all (basic + balance) | – |
| scheduling.appointment | ✅ | read/book/update **own** | read own | read all | ✅ all + checkin | read all | – |
| scheduling.schedule | ✅ | read all, manage own | read all | read all | read all | – | manage all |
| scheduling.waitlist/recall | ✅ | – | recall | – | ✅ | – | – |
| clinical.* | ✅ | ✅ **own** (+ read all chart) | chart/perio/note/imaging own | read own + imaging upload | – | – | – |
| clinical.procedure.perform | ✅ | ✅ own | ✅ own | – | – | – | – |
| billing.invoice | ✅ | read own (no discounts field) | – | – | create/issue/read all | ✅ all | – |
| billing.payment | ✅ | – | – | – | create/read | ✅ incl. refund | – |
| billing.insurance / cashSession | ✅ | – | – | – | ✅ | ✅ | – |
| accounting.* | ✅ | – | – | – | – | ✅ all | – |
| hr.attendance.checkin / leave.request | ✅ | own | own | own | own | own | own |
| hr.* (manage/approve/payroll) | ✅ | – | – | – | – | payroll.read all | ✅ all |
| hr.compensation / payroll.read | ✅ | own | own | own | own | all (read) | ✅ all |
| reports.* | ✅ | own | own | – | operational all | ✅ all | – |
| logs.* | ✅ | activity own | activity own | activity own | activity own | activity own | activity own |

The concrete grants (including field maps) live in `backend/src/core/rbac/roleTemplates.ts`. This table is the source for writing them.

---

## 6. Backend Enforcement Details

### 6.1 Token claims
```json
{ "sub": "<userId>", "kind": "staff", "cid": "<clinicId>", "sid": "<staffId>", "own": false, "pv": 7 }
```
- `pv` is the clinic's permission version, bumped on any change to roles, assignments or overrides.
- Effective grants and field maps are cached in Redis at `perm:{clinicId}:{staffId}:{pv}`. A cache miss rebuilds from Mongo.

### 6.2 Middleware
```ts
router.get('/staff',
  authorize('staff.member.read'),                 // sets req.auth.scopeFor + req.auth.fieldsFor
  validate({ query: listStaffQuery }),            // rejects sort/q on hidden fields
  controller.list);                               // repository uses fieldPolicy projection
```
- A missing permission returns `403 { error: { code: 'FORBIDDEN', permission } }`.
- Records outside the scope or tenant return `404`.

### 6.3 Scope rules (replace Hakeemna `inScope` + `queryScope` + `eval`)
```ts
export const appointmentScope: ScopeRule = {
  own: (auth) => ({ $or: [{ dentistId: auth.staffId }, { assistantIds: auth.staffId }] }),
};
```
- Lists merge `rule.own(auth)` when the scope is `own`.
- Get, update and delete apply the same filter together with `_id`.

### 6.4 Patient portal
- Patient tokens (`kind: 'patient'`) never pass clinic `authorize()`.
- `/portal/*` routes use `requirePatient()` and are filtered to the patient themself and their dependants.

---

## 7. Role & Permission Editor (UI)
- **Layout:**
  - left: list of roles, with user count;
  - right: tree **Module → Resource → Actions**, each with a checkbox and an own/all toggle.
- Expand **"Fields"** on a resource to get a table of fields grouped by `group`, with a radio per field (Hidden / Masked / Read / Write). Group bulk-set and presets ("Basic only", "Basic + contact", "Everything") are available.
- **Search box** filters permissions and fields as you type.
- **"Preview as this role":**
  - opens a read-only preview of the staff list, patient list or invoice with the role's field rules applied;
  - shows a summary sentence in the UI language, e.g. "Can see employees' names and phones, cannot see salaries".
- **Per-staff overrides:** on the staff profile there is a "Permissions" tab showing the inherited result (greyed, with the source role) and editable overrides.
- **Safety:**
  - changes are **diffed before saving** ("You are giving X access to salaries of all staff");
  - saving requires confirmation;
  - every change is audited;
  - a clinic must always keep at least one Owner.

---

## 8. Superadmin (Platform Level)

### 8.1 Root superadmin
- Created by `npm run seed` from `SEED_SUPERADMIN_EMAIL`/`PASSWORD`, with `isRootSuperadmin: true`. MFA is mandatory.
- **Sees everything and can do everything:**
  - all clinics and their data (cross-tenant explorer);
  - all users, all logs (audit, activity, issues, errors, requests);
  - platform settings and integrations (WhatsApp credentials);
  - plans, catalogs.
- **Manages other superadmins:** creates them, disables them, and grants or revokes any platform permission, including permission to manage other superadmins.
- Cannot be disabled or demoted by a non-root superadmin. There must always be at least one active root.

### 8.2 Other superadmins (granular)
`users.platformPermissions: Grant[]` from this registry:

| Permission | Description |
|---|---|
| `platform.clinic.read` / `.manage` / `.suspend` | Clinics |
| `platform.clinicData.read` | Read **any clinic's data** in the cross-tenant explorer. Supports `fields` rules like §4 and an optional `clinicIds` restriction |
| `platform.clinicData.write` | Edit clinic data (requires a reason; audited) |
| `platform.impersonate` | Log in as a clinic user (banner, audited, read-only unless `clinicData.write`) |
| `platform.plan.manage`, `platform.subscription.manage` | Billing of clinics |
| `platform.catalog.manage` | Global catalogs & role templates |
| `platform.settings.manage` | Platform settings & integrations (WhatsApp credentials) |
| `platform.user.read` / `.manage` | All users |
| `platform.superadmin.manage` | Create superadmins and grant platform permissions (see the escalation rule) |
| `platform.logs.audit.read`, `platform.logs.activity.read`, `platform.logs.issues.read`, `platform.logs.errors.read`, `platform.logs.requests.read` | Logs (see `15_LOGGING_AND_MONITORING.md`) |
| `platform.announcement.manage`, `platform.ticket.manage` | Communication & support |
| `platform.stats.read` | Platform dashboard |

- **Escalation rule:** a non-root superadmin with `platform.superadmin.manage` can grant only permissions they hold themselves, with field rules no wider than their own. They cannot modify the root or themselves.
- **Superadmin management UI** (`/admin/superadmins`):
  - list, invite (email invitation; 2-step verification is set up on first sign-in), disable/enable;
  - a grouped checklist of platform permissions; permissions the editor doesn't hold are disabled, and the server rejects granting **or removing** them (`ESCALATION_FORBIDDEN`);
  - the main superadmin and your own row show no actions (`ROOT_PROTECTED`, `SELF_PERMISSION_CHANGE`);
  - "last active" and a link to their activity timeline.
- **Clinic user accounts** (`/admin/users`, `platform.user.manage`): disable (signs out every session), enable, unlock. Platform accounts are managed only on the superadmins page.
- `platform.clinicData.*` (cross-tenant explorer) and `platform.impersonate` are defined but not implemented yet.

### 8.3 Cross-tenant access
- Superadmin requests to clinic data go through `/admin/clinics/:clinicId/...` endpoints. These set the tenant context explicitly (`skipTenant` is never used implicitly).
- Every such request is audit-logged with the superadmin's id and clinic id.
- Clinics can see in their own audit log that platform staff accessed their data.

---

## 9. Clinic Owner (protected identity)

**Who.** The person who creates the clinic (`createClinic`) becomes its only owner: `staff.isOwner = true` on their staff record and `clinics.ownerUserId` on the clinic. Inviting or creating staff never sets ownership. There is exactly one owner per clinic.

**Authority.** Inside their clinic the owner bypasses scopes and field rules (`scopeFor` → `all`, field policy bypass): all staff, roles, overrides, patients, clinical records, invoices, payments, refunds, credit notes, accounting and every report, per doctor and clinic-wide. The bypass never crosses the tenant boundary: every query is still scoped to the token's clinic, so another clinic's records return 404.

**Protection (backend, `staff.service.ts`).**
- Ownership is not part of `PUT /staff/:id/roles` (the body is strict: an `isOwner` field is rejected as `unknown_field`), nor of overrides or profile updates.
- Only the owner may change the owner's record (profile, roles, overrides, status): others get `403 OWNER_PROTECTED`.
- The owner can't be deactivated or terminated by anyone, themselves included, while they are the owner (`OWNER_PROTECTED`): transfer first. There is no hard delete of staff.
- Nobody but the owner changes their **own** roles, overrides or status (`403 SELF_PERMISSION_CHANGE`), so a manager can't widen their own access.
- The "Full access" system role (key `owner`) gives every permission but **not** the owner identity or its protection, and only the owner can grant or remove it (§9.2).

**Transfer.** `POST /staff/:id/transfer-ownership { password }`: only the current owner (`403 OWNER_ONLY` otherwise), re-confirming their own password (`422 password invalid`); the target must be an active member of the same clinic. In one transaction: old owner `isOwner=false`, new owner `isOwner=true`, `clinics.ownerUserId` = new owner's user. The previous owner keeps their roles. Audited as `ownership_transfer` (`before/after.ownerStaffId`). `authenticate` reads `isOwner` from the database on every request, so the change applies immediately.

**UI.** A distinct Owner badge (crown, warning colour) on the profile and the staff list; the roles tab is read-only on the owner's profile (and on your own) for everyone but the owner; the transfer card appears only for the owner, on another active member's profile.

**Existing clinics.** No migration: `createClinic` has always set both markers on the creator. Verified on the dev database (one clinic, owner = creator = `ownerUserId`). If a clinic ever has none or several owners, fix it manually after confirming with the clinic, never automatically.

### 9.2 Access-control boundary (`core/rbac/accessBoundary.ts`)
| Action | Owner | Everyone else |
|---|---|---|
| Grant or remove the **Full access** role (on invite or via roles) | ✅ | ❌ `403 FULL_ACCESS_OWNER_ONLY` |
| Grant or remove `staff.role.manage` (the power to manage access) through a role, a custom role, a cloned role, a role edit or an override | ✅ | ❌ `403 FULL_ACCESS_OWNER_ONLY` |
| Edit (or rename) the Full access role | ✅ | ❌ |
| Assign or change a built-in job role (Dentist, Hygienist, Assistant, Receptionist, Accountant, HR Manager) | ✅ | ✅ with `staff.member.create` (invite) or `staff.member.update` / `staff.role.manage` (`PUT /staff/:id/roles` on existing staff) |
| Assign a custom role | ✅ | only if all its grants are within the assigner's own (`403 ESCALATION_FORBIDDEN`) |
| Grant overrides | ✅ | within the assigner's own grants |
| Change your own roles, overrides or status | ✅ | ❌ `SELF_PERMISSION_CHANGE` |
| Change the owner's record / ownership | ✅ (transfer) | ❌ `OWNER_PROTECTED` / `OWNER_ONLY` |

HR (default template) has `staff.member.*` but not `staff.role.manage`: it assigns and changes job roles (on invite and on existing staff, audited as `permission_change`), but can't edit role definitions or overrides, can't grant or remove Full access or `staff.role.manage`, can't assign a custom role beyond its own grants, and can't change the owner or itself. In the UI, HR sees the profile's roles section with built-in roles only and no overrides. Built-in job roles are trusted as assignable because their definitions can only be changed by holders of `staff.role.manage`, under the same rules. The UI hides Full access from the invite role list and disables owner-controlled role chips for non-owners; the server enforces it regardless.

### 9.1 Terms
| Term | Meaning |
|---|---|
| Clinic owner | The protected identity above. One per clinic. |
| Employee role | A bundle of grants (dentist, receptionist, accountant, Full access…). Says what someone can do, never who owns the clinic. |
| Procedure doctor | `performedProcedures.dentistId`: who did the work. Fixed once recorded. |
| Invoice line doctor | `invoices.lines[].dentistId`: copied from the procedure (locked) or chosen for a manual line (default: the header doctor). Drives revenue and collection attribution. |
| Invoice header doctor | `invoices.dentistId`: the responsible doctor; required to issue; default for manual lines. |
| Invoice creator | `createdBy` / `issuedBy`: the employee who typed or issued it. Not an attribution. |
| Collection attribution | Money applied to an invoice split between its line doctors by value (09 §8.1). |

## 10. Tests (required)
- Snapshot tests of allowed and denied permissions for every system role template, including field maps.
- Route meta test: every route has `authorize` or `public`.
- Scope tests: a dentist with `own` cannot read another dentist's records (expects 404); a shared invoice is visible to every doctor on it; own-scope reports return only the caller's row/share (`test/doctorBilling.test.ts`).
- Owner tests (`test/ownership.test.ts`): HR assigns job roles but not Full access; a Full access manager can't grant/remove Full access or `staff.role.manage` by any route; custom roles stay within the assigner's grants; creator is the only owner; staff creation doesn't change it; managers can't promote themselves or change/deactivate the owner; transfer needs the owner and their password and is audited; owner rights stop at the clinic boundary.
- **Field tests:**
  - a hidden field is absent from list, get, export and socket payloads;
  - a masked field is masked in every output;
  - writing a non-writable field returns 403 `FIELD_FORBIDDEN`;
  - sort or search on a hidden field returns 422.
- **Overrides:** an override grants and restricts correctly, and revoked permissions are denied.
- **Superadmin:**
  - the root can do everything;
  - a non-root without a permission gets 403;
  - escalation beyond the granter's own permissions is rejected;
  - the root cannot be disabled by a non-root.
- Tenant isolation (see `11_SECURITY.md`).
