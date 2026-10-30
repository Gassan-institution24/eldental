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
6. **Owner bypass.** `staff.isOwner = true` grants everything inside that clinic. This is audited.
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
| | `clinical.labOrder.read` / `.manage` | own, all | |
| | `clinical.imaging.read` / `.upload` | own, all | |
| | `clinical.consent.manage` | all | |
| **billing** | `billing.invoice.read` | own, all | own = invoices where I am the dentist |
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
    balance (financial), medicalAlerts (clinical), tags, notes
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

Seeded on clinic creation (cloned from global templates; editable).

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
  - list, invite, disable;
  - the same tree and field editor as §7;
  - "last active" and a link to their activity log.

### 8.3 Cross-tenant access
- Superadmin requests to clinic data go through `/admin/clinics/:clinicId/...` endpoints. These set the tenant context explicitly (`skipTenant` is never used implicitly).
- Every such request is audit-logged with the superadmin's id and clinic id.
- Clinics can see in their own audit log that platform staff accessed their data.

---

## 9. Tests (required)
- Snapshot tests of allowed and denied permissions for every system role template, including field maps.
- Route meta test: every route has `authorize` or `public`.
- Scope tests: a dentist with `own` cannot read another dentist's records (expects 404).
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
