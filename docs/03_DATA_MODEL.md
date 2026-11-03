# ElDental — Data Model

> MongoDB 7 + Mongoose 8. All names camelCase. "T" = tenant-scoped (`clinicId` + `tenantPlugin`). "G" = global (platform-owned).
> Every model also gets: `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `deletedAt`, `deletedBy` (unless noted).

---

## 1. Shared Types

### 1.1 One input per text field (no ar/en duplicates)
Hakeemna had **two inputs for every name** (`name_english` + `name_arabic`, `general_info` + `general_info_arabic`). ElDental has **one field and one input**. The user types the value once, in whatever language they want (Arabic or English), and it is stored as a plain `string`.

- **Interface language ≠ data language.** The UI (labels, menus, buttons, errors, emails, PDFs) is fully translated ar/en with i18n. **User-entered data** (patient names, procedure names, notes, clinic name, …) is stored and shown exactly as typed.
- **System-seeded records** (chart of accounts, role templates, leave types, salary components, tooth conditions, procedure catalog, appointment types, permission labels) carry a `systemKey` (e.g. `accounts.AR_PATIENTS`) and **no stored translation**. Display rule: `name ?? t('seed.' + systemKey)`. The record is shown in the current UI language until the clinic renames it. Once renamed, the custom `name` is shown as typed. A **"Reset to default name"** action clears `name`.
- Search must work in both scripts. Store a normalised `searchName` (lowercased, Arabic diacritics/tatweel removed, أ/إ/آ→ا, ة→ه, ى→ي) and index it.
- Text direction is auto-detected per value on display (`dir="auto"`), so mixed Arabic/English data renders correctly in both UI languages.
- Patient names keep the Arabic four-part structure as **separate inputs of one language each** (first, father, grandfather, family). That is structure, not translation.

```ts
type Money = number;                                      // integer minor units (JOD fils: 1 JOD = 1000)
type Phone = { countryCode: string; number: string; e164: string };
type Address = { line1?: string; cityId?: ObjectId; countryId?: ObjectId; postalCode?: string };
type TimeOfDay = string;                                  // "HH:mm" in clinic timezone
type FileRef = ObjectId;                                  // → fileAssets
```

---

## 2. Platform (G)

### `clinics`
| Field | Type | Notes |
|---|---|---|
| name | string | |
| slug | string | unique; used in the public booking URL |
| logoFileId | FileRef | |
| phone, email, address | | |
| taxNumber, commercialRegNo | string | |
| timezone | string | default `Asia/Amman` |
| currency | string | ISO 4217, default `JOD` |
| locale | `ar`\|`en` | |
| workingHours | `[{ weekday:0-6, open:TimeOfDay, close:TimeOfDay, closed:boolean }]` | clinic-level opening hours |
| settings | object | numbering formats, `cancellationWindowHours`, `onlineBookingEnabled`, `defaultAppointmentMinutes`, `vatRegistered`, `invoiceFooter` (string), `fiscalYearStartMonth` |
| integrations.jofotara | `{ enabled, clientId, secretKeyEnc, activityNumber, incomeSourceSequence }` | secrets encrypted with `FIELD_ENCRYPTION_KEY` |
| integrations.whatsapp | `{ enabled, senderName? }` | clinic on/off switch only; provider credentials and templates live in `platformSettings` (superadmin) |
| planId | → plans | |
| subscription | `{ status: trialing\|active\|past_due\|suspended\|cancelled, currentPeriodEnd: Date, trialEndsAt }` | |
| status | `active`\|`suspended` | |
| ownerUserId | → users | |

Indexes: `slug` unique, `status`.

### `plans`
`code` (unique), `name` (string), `description`, `priceMonthly`, `priceYearly` (Money, in `currency`), `currency`, `trialDays` (used when a clinic is created on this plan), `limits { chairs, staff, patients, monthlyMessages, storageGb }` (0 = unlimited; shown, not enforced yet), `features: string[]` (feature keys), `isActive`, `sortOrder`. A plan used by any clinic can't be deleted (`409 PLAN_IN_USE`); deactivate it instead.

Clinic subscription fields live on `clinics`: `planId`, `subscription { status: trialing|active|past_due|suspended|cancelled, trialEndsAt, currentPeriodEnd }`. Past due, suspended and cancelled make the clinic read-only, as does `clinics.status = suspended`.

### `subscriptionInvoices`
Platform → clinic billing history: `clinicId`, `planId`, `period {from,to}`, `amount`, `status`, `paidAt`, `reference`.

### `platformSettings` (singleton)
Integration credentials are entered by the superadmin in **Admin → Settings → Integrations**. They are **never put in `.env` or in the repo**.

`whatsapp { enabled, provider: 'mazbot', baseUrl, email, passwordEnc, apiKeyEnc, defaultCountryCode, templates: { otp, appointmentBooked, appointmentReminder, appointmentCancelled, appointmentRescheduled, recall } }`, `smtpOverride?`, `updatedBy`, `updatedAt`.

Secrets are encrypted with `FIELD_ENCRYPTION_KEY` and never returned to the client; the UI shows `••••` plus "Replace". It also offers a **"Send test message"** button.

### `systemErrors`, `announcements`, `supportTickets`
These keep Hakeemna's super-admin features in a simplified form.

---

## 3. Identity & Access

### `users` (G)
| Field | Type | Notes |
|---|---|---|
| email | string | lowercased, unique sparse |
| phone | Phone | unique sparse on `phone.e164` |
| passwordHash | string | `select:false` |
| kind | `platform`\|`staff`\|`patient` | |
| platformRole | `superadmin` \| null | only for kind=platform |
| isRootSuperadmin | boolean | the main superadmin (created by the seed). Sees and does **everything**, and is the only one who can create superadmins and grant their permissions by default. Cannot be disabled or demoted by others; at least one must always exist. |
| platformPermissions | Grant[] | for non-root superadmins: platform permissions + optional cross-clinic data access with field rules (see `04_ROLES_AND_PERMISSIONS.md` §8) |
| displayName | string | |
| avatarFileId | FileRef | |
| locale | `ar`\|`en` | |
| emailVerifiedAt, phoneVerifiedAt | Date | |
| passwordChangedAt | Date | tokens issued before this are rejected |
| mustChangePassword | boolean | invited staff |
| mfa | `{ enabled, secretEnc, recoveryCodesHash[] }` | optional TOTP for staff |
| status | `active`\|`disabled`\|`locked` | |
| failedLoginCount, lockedUntil | | brute-force protection |
| lastLoginAt | Date | |

### `staff` (T) — replaces Hakeemna `employees` + `employee_engagement`
One document per (user, clinic).

| Field | Type | Notes |
|---|---|---|
| userId | → users | unique with clinicId |
| fileNumber | string | sequence `STF-0001` |
| name | string | |
| gender, dateOfBirth, nationalId, nationality | | |
| jobTitle | string | |
| staffType | `dentist`\|`hygienist`\|`assistant`\|`receptionist`\|`accountant`\|`hr`\|`manager`\|`other` | |
| isOwner | boolean | the clinic owner (one per clinic, mirrored by `clinics.ownerUserId`); bypasses RBAC inside the clinic; changed only by the ownership transfer (04 §9) |
| roleIds | → roles[] | **multiple roles**; effective permissions = union |
| permissionOverrides | `(Grant \| { permission, revoked: true })[]` | per-person customisation applied after roles (see `04_ROLES_AND_PERMISSIONS.md` §4.4) |
| specialties | DentalSpecialty[]? | dentists and hygienists only; fixed codes from `shared/dental/specialties.ts` (07 §13), names via i18n |
| primarySpecialty | DentalSpecialty? | required when `specialties` is set, must be one of them |
| specialtyLegacy | string? (not selected) | the old free-text value, kept by `npm run migrate:specialties` for recovery |
| licenseNumber, licenseExpiry | | expiry alert job |
| signatureFileId, stampFileId | FileRef | used on prescriptions and reports |
| color | string | calendar colour for dentists |
| bookableOnline | boolean | dentist appears in portal booking |
| defaultChairId | → chairs | |
| employment | `{ type: full_time\|part_time\|contractor, hireDate, endDate, probationEndDate }` | |
| compensation | `{ basicSalary: Money, currency, payFrequency: monthly, allowances:[{componentId, amount}], deductions:[{componentId, amount}], socialSecurity: {enrolled, employeeRate, employerRate}, commission?: {basis: production\|collection, percent, appliesTo: procedureCategoryIds[] } }` | read/write needs `hr.compensation.*` |
| bank | `{ bankName, iban }` | |
| shiftId | → shifts | default shift |
| leaveBalances | computed | from `leaveBalances` |
| status | `active`\|`inactive`\|`terminated` | |

Indexes: `{clinicId, userId}` unique; `{clinicId, staffType, status}`.

### Global catalogs (G)
`procedureCatalog` and `toothConditionsCatalog` (name `null` → shown from i18n by `code`), `medicines`, and the reference lists `countries { code ISO-3166 alpha-2 (unique), name, dialCode, currency, isActive }`, `cities { countryCode, name, isActive }`, `currencies { code ISO-4217 (unique), name, symbol, decimals, isActive }`. Managed in Admin → Catalogs (`platform.catalog.manage`).

### `roles` (T) and `roleTemplates` (G)
Role templates edited by the platform (Admin → Role templates) get `customizedAt`; the seed then stops overwriting them, and "reset" restores the built-in version. The Full access template (`owner`) can't be edited. Templates apply to clinics created afterwards; existing clinics keep their own roles.

Global templates live in their own `roleTemplates` collection (same shape, no `clinicId`) so every document in `roles` is tenant-scoped by the `tenantPlugin`. Clinic roles: `clinicId`, `key` (e.g. `dentist`, unique per clinic), `name` string, `description`, `permissions: Grant[]`, `isSystem` (templates cannot be edited; clinics clone them), `status`.

```ts
type Grant = {
  permission: PermissionKey;
  scope: 'own' | 'all';
  // Field-level access for this resource (see 04_ROLES_AND_PERMISSIONS.md §4).
  // Missing key = the resource's default from the registry.
  fields?: Record<FieldKey, 'hidden' | 'read' | 'write'>;
};
```

Index: `{clinicId, key}` unique.

Platform (superadmin) permissions are stored on `users.platformPermissions` with the same `Grant` shape (scope `all`). See `04_ROLES_AND_PERMISSIONS.md` §8.

### `refreshTokens` (G)
`userId`, `clinicId?`, `tokenHash` (sha256), `familyId` (rotation chain), `expiresAt` (TTL index), `revokedAt`, `replacedByHash`, `userAgent`, `ip`.

### `otpCodes` (G)
`target` (email or phone), `purpose` (`verify_email`\|`verify_phone`\|`reset_password`\|`link_patient`\|`login`), `codeHash`, `attempts`, `expiresAt` (TTL).

### `auditLogs` (T or G)
`clinicId?`, `actorUserId`, `actorStaffId?`, `impersonatorUserId?`, `action` (`create`/`update`/`delete`/`status_change`/`login`/`logout`/`login_failed`/`export`/`print`/`impersonate`/`permission_change`), `entity`, `entityId`, `before`, `after` (diff only), `ip`, `userAgent`, `reqId`, `sessionId`, `at`. Append-only; no soft delete; TTL is configurable (default: keep).

### `activityLogs`, `clientIssues`, `systemErrors`, `requestLogs` (G, with `clinicId?`)
User movements, problems users hit, and server errors. Full spec in `15_LOGGING_AND_MONITORING.md`.

### `counters` (T)
`{ clinicId, key, year?, value }`, unique `{clinicId, key, year}`.

---

## 4. Patients (T)

### `patients`
| Field | Type | Notes |
|---|---|---|
| fileNumber | string | sequence `P-000123`, unique per clinic |
| userId | → users | null until the patient links a portal account |
| name | `{ first, father?, grandfather?, family }` + computed `fullName` + `searchName` | four-part name, **one input per part, typed once** (no ar/en duplicates) |
| gender, dateOfBirth | | |
| nationalId, passportNo | string | encrypted search hash for lookups |
| phone, altPhone, email, address | | |
| guardian | `{ patientId?, name, relation, phone }` | for minors |
| familyGroupId | ObjectId | links family members |
| emergencyContact | `{ name, relation, phone }` | |
| referralSource | string | free text "how did you hear about us" (kept alongside `referredBy`) |
| referredBy | `{ type: patient|doctor|campaign|other, patientId?, name?, note? }` | `patient` needs `patientId` (an existing patient of the clinic, not self); `doctor`/`campaign` need `name`; `other` needs `name` or `note` |
| nationality | string | ISO 3166-1 alpha-2 (`JO`); names come from `Intl.DisplayNames` in the UI |
| maritalStatus | `single|married|divorced|widowed` | |
| occupation | string ≤ 80 | |
| bloodType | `A+|A-|B+|B-|AB+|AB-|O+|O-` | |
| heightCm, weightKg | int 30–250, number 1–400 (one decimal) | BMI is derived in the API (`bmi`), never stored |
| legacyFileNumber | string ≤ 30, uppercased | old paper file number; unique per clinic, searchable, part of the duplicate check |
| photoFileId | → fileAssets (`category: photo`) | re-encoded on upload; served through `/files/:id` |
| idVerifiedAt, idVerifiedBy | Date, → staff | set by `POST /patients/:id/verify-id`; needs a document with category `id`; audited |
| flags | `{ code, note? }[]` | non-medical: `anxious, gag_reflex, wheelchair, hearing_impaired, interpreter, vip, payment_issue, often_late, other`; `other` requires a note; unique codes |
| preferredDentistId | → staff | |
| preferredLanguage | `ar`\|`en` | |
| communicationPrefs | `{ whatsapp, sms, email, marketing: boolean }` | |
| medicalAlerts | string[] | denormalised summary for UI badges |
| balance | Money | cached; recomputed from the ledger subledger |
| tags | string[] | VIP, ortho, … |
| status | `active`\|`inactive`\|`deceased`\|`merged` | |
| mergedIntoId | → patients | |

Indexes:
- `{clinicId, fileNumber}` unique;
- `{clinicId, 'phone.e164'}`;
- text index on names;
- `{clinicId, nationalIdHash}`;
- `{clinicId, legacyFileNumber}` unique, partial (only when set);
- `{clinicId, 'referredBy.patientId'}` (referrals list and report).

### `medicalHistories`
`patientId`, `version`, `answers` (structured questionnaire: conditions, medications, pregnancy, smoker, bleeding disorders, …), `allergies: [{ substance, reaction, severity }]`, `reviewedBy`, `reviewedAt`, `signedFileId`. A new version is created on every update and history is kept.
Structured fields (rules in `shared/patients.ts`, used by the editor and the API):
| Field | Type | Notes |
|---|---|---|
| medicationsList | `{ name, medicineId?, dose?, frequency?, since? }[]` ≤ 30 | `medicineId` → global `medicines` (must exist; `422 not_found`); the name is kept as typed; `since` not in the future |
| medications | string ≤ 1000 | free-text "other notes about medicines" (first form version) |
| surgeries | `{ name, year?, note? }[]` ≤ 20 | year 1900 – this year |
| lifestyle | `{ smoking?: none|former|light|heavy, alcohol?: none|light|heavy }` | |
| pregnancyWeeks | int 1–42 | only when the `pregnancy` condition is ticked (`pregnancy_required`) |

### `insurancePolicies`
`patientId`, `insuranceCompanyId`, `planName`, `memberNumber`, `relationToSubscriber`, `validFrom`, `validTo`, `coveragePercentOverride?`, `annualMax?: Money`, `usedThisYear: Money`, `isPrimary`.

### `fileAssets`
`ownerType` (`patient`\|`staff`\|`clinic`\|`labOrder`\|…), `ownerId`, `category` (`xray`\|`photo`\|`document`\|`consent`\|`id`\|`other`), `storageKey`, `mime`, `size`, `sha256`, `originalName`, `toothNumbers?: number[]`, `takenAt?`, `notes`.

---

## 5. Scheduling (T)

### `chairs`
`name` string, `roomName?`, `color`, `isActive`, `sortOrder`.

### `appointmentTypes`
`name` string, `code`, `defaultDurationMin`, `color`, `bufferAfterMin`, `allowOnline`, `requiresDeposit?`, `defaultProcedureIds[]`, `isActive`.

### `dentistSchedules`
Recurring weekly template per dentist.

`staffId`, `effectiveFrom`, `effectiveTo?`, `weekly: [{ weekday, blocks: [{ start:TimeOfDay, end:TimeOfDay, chairId?, appointmentTypeIds?: [], onlineBookable: boolean }] }]`, `slotGranularityMin` (default 15).

Validation: blocks may not overlap within a day; `effectiveFrom/To` ranges may not overlap for the same staff.

### `scheduleExceptions`
`staffId?` (null = whole clinic, e.g. public holiday), `chairId?`, `type` (`time_off`\|`extra_hours`\|`holiday`\|`chair_maintenance`), `start: Date`, `end: Date`, `reason`, `leaveRequestId?` (auto-created when leave is approved).

### `appointments`
| Field | Type | Notes |
|---|---|---|
| number | string | sequence |
| patientId | → patients | required (walk-in creates a quick patient) |
| dentistId | → staff | **required — replaces Hakeemna work_group** |
| chairId | → chairs | optional but recommended |
| assistantIds | → staff[] | |
| appointmentTypeId | → appointmentTypes | |
| start, end | Date (UTC) | `end > start` |
| status | `scheduled`\|`confirmed`\|`arrived`\|`in_chair`\|`completed`\|`cancelled`\|`no_show` | state machine in `06_MODULE_APPOINTMENTS.md` |
| statusHistory | `[{ from, to, at, byUserId, reason? }]` | |
| source | `staff`\|`online`\|`walk_in`\|`recall` | |
| plannedItems | `[{ treatmentPlanItemId?, procedureId, toothNumbers?, surfaces? }]` | |
| notes, patientNotes | string | |
| cancellation | `{ reason: patient_request\|clinic\|no_show\|other, comment, byUserId, at, lateCancel: boolean }` | |
| rescheduledFromId | → appointments | |
| reminders | `{ sent24hAt?, sent2hAt?, confirmationRequestedAt? }` | |
| checkInAt, seatedAt, completedAt | Date | |
| invoiceId | → invoices | |

Indexes:
- `{clinicId, dentistId, start}`;
- `{clinicId, chairId, start}`;
- `{clinicId, patientId, start:-1}`;
- `{clinicId, status, start}`.

Overlap is prevented in the service (see the module doc) **inside a transaction**, together with a `slotLocks` collection.

### `slotLocks`
`clinicId`, `resourceType` (`dentist`\|`chair`), `resourceId`, `bucketStart` (Date, one per 5-minute bucket), `appointmentId`.

Index: unique `{clinicId, resourceType, resourceId, bucketStart}`. This guarantees no double booking even under concurrency. Rows are deleted on cancel and reschedule.

### `waitingList`
`patientId`, `dentistId?`, `appointmentTypeId?`, `preferredDays[]`, `preferredTimeRange?`, `notes`, `priority`, `status` (`waiting`\|`offered`\|`booked`\|`removed`), `appointmentId?`.

### `recalls`
`patientId`, `type` (`cleaning`\|`checkup`\|`ortho_adjustment`\|`custom`), `dueDate`, `intervalMonths`, `status` (`due`\|`contacted`\|`booked`\|`dismissed`), `lastContactAt`, `appointmentId?`.

---

## 6. Clinical (T)

### `procedureCatalog` (G) and `clinicProcedures` (T)
- **Global:** `code` (CDT-like, e.g. `D2740`), `name` string, `category` (`diagnostic`, `preventive`, `restorative`, `endodontics`, `periodontics`, `prosthodontics`, `oral_surgery`, `orthodontics`, `implants`, `cosmetic`, `other`), `toothRequired`, `surfacesRequired`, `defaultDurationMin`.
- **Clinic:** `catalogId?` (null = clinic custom), `code`, `name`, `category`, `price: Money`, `vatRateId`, `isActive`, `labRequired: boolean`, `insurancePrices: [{ insuranceCompanyId, price }]`, `commissionEligible: boolean`.

### `toothConditionsCatalog` (G)
`code` (`caries`, `filling`, `crown`, `missing`, `implant`, `rct`, `bridge_pontic`, `bridge_abutment`, `veneer`, `fracture`, `impacted`, `sealant`, …), `name` string, `color`, `appliesTo` (`tooth`\|`surface`).

### `toothCharts`
One per patient (current state) plus history via `chartEntries`.

`patientId` (unique per clinic), `dentition` (`permanent`\|`primary`\|`mixed`), `teeth: { [fdi: string]: { status: present|missing|implant|unerupted, conditions: [{ code, surfaces?: ('M'|'O'|'D'|'B'|'L'|'I'|'F'|'P')[], notedAt, entryId }] } }`.

### `chartEntries` (append-only)
`patientId`, `toothNumber` (FDI 11–48, 51–85), `surfaces[]`, `kind` (`existing`\|`finding`\|`planned`\|`completed`), `conditionCode?`, `procedureId?`, `appointmentId?`, `staffId`, `notes`, `at`.

### `treatmentPlans`
`patientId`, `number`, `title`, `dentistId`, `status` (`draft`\|`presented`\|`accepted`\|`partially_accepted`\|`rejected`\|`in_progress`\|`completed`\|`cancelled`), `phases: [{ name, order }]`, `items: [{ _id, phaseIndex, clinicProcedureId, toothNumbers[], surfaces[], quantity, unitPrice, discount, insuranceEstimate, patientEstimate, status: proposed|accepted|rejected|scheduled|completed, completedProcedureId? }]`, `totals { gross, discount, insurance, patient }`, `presentedAt`, `acceptance { at, byPatient: bool, signatureFileId, ip }`, `validUntil`.

### `performedProcedures`
The source of truth for production and billing.

`patientId`, `appointmentId?`, `treatmentPlanItemId?`, `clinicProcedureId`, `code`, `toothNumbers[]`, `surfaces[]`, `dentistId`, `assistantIds[]`, `performedAt`, `quantity`, `unitPrice`, `discount`, `status` (`completed`\|`voided`), `invoiceLineRef?`, `notes`.

### `clinicalNotes`
`patientId`, `appointmentId?`, `authorId`, `templateId?`, `format` (`soap`\|`free`), `content { subjective, objective, assessment, plan }` or `text`, `signedAt` (locked after signing; amendments create `amendsNoteId`).

### `noteTemplates`
`name`, `content`, `appointmentTypeIds[]`.

### `perioCharts`
`patientId`, `examDate`, `examinerId`, `teeth: { [fdi]: { pocketDepth: number[6], recession: number[6], bleeding: boolean[6], suppuration: boolean[6], mobility: 0-3, furcation?: number[] } }`, `notes`.

### `prescriptions`
`patientId`, `appointmentId?`, `dentistId`, `items: [{ medicineId?, name, dose, route, frequency, durationDays, instructions }]`, `printedAt`, `number`.

### `labOrders`
`patientId`, `dentistId`, `labSupplierId` (→ suppliers), `items: [{ type: crown|bridge|denture|veneer|aligner|night_guard|other, toothNumbers[], material, shade, notes }]`, `status` (`draft`\|`sent`\|`in_progress`\|`received`\|`fitted`\|`remake`\|`cancelled`), `sentAt`, `dueDate`, `receivedAt`, `cost: Money` (posts a supplier bill), `attachments: FileRef[]`.

### `consentTemplates` / `consents`
- Template: `title` string, `body` string (with placeholders), `procedureCategories[]`.
- Consent: `patientId`, `templateId`, `renderedBody`, `signedAt`, `signatureFileId`, `witnessStaffId?`, `appointmentId?`.

---

## 7. Billing (T)

### `insuranceCompanies`
`name` string, `code`, `contact`, `defaultCoveragePercent`, `coverageRules: [{ procedureCategory, percent, requiresPreApproval }]`, `payerAccountId` (→ accounts, AR-insurance subaccount), `isActive`.

### `invoices`
| Field | Type | Notes |
|---|---|---|
| number | string | sequence per fiscal year; assigned **on issue**, not on draft |
| type | `invoice`\|`credit_note` | |
| status | `draft`\|`issued`\|`partially_paid`\|`paid`\|`void` | issued invoices are immutable; corrections via credit note |
| patientId | → patients | |
| billTo | `patient`\|`insurance` | split invoices allowed |
| insurancePolicyId? | | |
| appointmentId?, treatmentPlanId? | | |
| dentistId | → staff | responsible (header) doctor: an active dentist/hygienist of the clinic; required to issue (`DENTIST_REQUIRED`); default doctor of manual lines. `lines[].dentistId` is the doctor of each line (locked for lines from a performed procedure) and is what attribution uses (09 §8.1) |
| lines | `[{ performedProcedureId?, clinicProcedureId?, description: string, quantity, unitPrice, discount, taxRateId, taxAmount, lineTotal, revenueAccountId }]` | |
| subtotal, discountTotal, taxTotal, total, amountPaid, balanceDue | Money | computed server-side |
| issueDate, dueDate | Date | |
| installmentPlan | `[{ dueDate, amount, paidAmount }]` | |
| originalInvoiceId | → invoices | for credit notes |
| journalEntryId | → journalEntries | |
| einvoice | `{ status: not_sent\|queued\|accepted\|rejected, uuid, qr, submittedAt, response, attempts }` | |
| voidReason | | |

Indexes: `{clinicId, number}` unique (partial: number exists); `{clinicId, patientId, issueDate}`; `{clinicId, status, dueDate}`; plus the two doctor-scope indexes below.

**Doctor-scope indexes** (defined in `billing.models.ts`). The own-scope and doctor-filter query is `{ clinicId, $or: [{ dentistId: X }, { 'lines.dentistId': X }] }` sorted by `createdAt: -1`; MongoDB uses one index per `$or` branch and merges them (`SORT_MERGE`, verified with `explain`):
| Name | Keys | Options |
|---|---|---|
| `clinicId_1_dentistId_1_createdAt_-1` | `{ clinicId: 1, dentistId: 1, createdAt: -1 }` | none (not unique) |
| `clinicId_1_lines.dentistId_1_createdAt_-1` | `{ clinicId: 1, 'lines.dentistId': 1, createdAt: -1 }` | none (multikey on `lines`) |

**Production deployment** (`autoIndex` is off in production, so these are not created by the app):
1. Back up first (`mongodump`), and check free disk space (each index ≈ the size of its keys).
2. Create them explicitly, **before** deploying the code that relies on them, outside peak hours. Do **not** run Mongoose `syncIndexes()` against production for this: it also drops indexes that aren't declared in the schemas.
   ```js
   // mongosh, on the primary
   db.invoices.createIndex({ clinicId: 1, dentistId: 1, createdAt: -1 }, { name: 'clinicId_1_dentistId_1_createdAt_-1' })
   db.invoices.createIndex({ clinicId: 1, 'lines.dentistId': 1, createdAt: -1 }, { name: 'clinicId_1_lines.dentistId_1_createdAt_-1' })
   ```
   On MongoDB ≥ 4.2 the build holds an exclusive lock only briefly at start and end; reads and writes continue meanwhile, and replica-set members build it together. `createIndex` with the same keys and name is a no-op, so it is safe to re-run.
3. Verify: `db.invoices.getIndexes()` lists both; `db.invoices.find({ clinicId: <id>, $or: [{ dentistId: <id> }, { 'lines.dentistId': <id> }] }).sort({ createdAt: -1 }).explain()` shows `IXSCAN` on both names (no `COLLSCAN`).
4. Rollback (only if needed, e.g. a failed build): `db.invoices.dropIndex('<name>')`. The application still works without them (the queries fall back to slower plans).

Payments: `refunds[].invoices[] {invoiceId, amount}` records what each refund took back from invoice allocations (attribution by refund date).

### `payments`
`number`, `patientId?`, `payerType` (`patient`\|`insurance`), `insuranceCompanyId?`, `method` (`cash`\|`card`\|`bank_transfer`\|`cheque`\|`wallet`\|`other`), `amount`, `receivedAt`, `reference`, `cheque? { number, bank, dueDate, status }`, `depositAccountId` (→ accounts: cash box / bank), `allocations: [{ invoiceId, amount }]` (sum ≤ amount; the remainder is patient credit), `unallocated: Money`, `status` (`posted`\|`refunded`\|`partially_refunded`\|`void`), `refunds: [{ amount, at, reason, journalEntryId }]`, `journalEntryId`, `idempotencyKey` (unique per clinic), `receiptNumber`.

### `insuranceClaims`
`number`, `insuranceCompanyId`, `patientId`, `policyId`, `invoiceIds[]`, `lines[]`, `claimedAmount`, `approvedAmount`, `paidAmount`, `status` (`draft`\|`submitted`\|`approved`\|`partially_approved`\|`rejected`\|`paid`), `submittedAt`, `responseAt`, `rejectionReason`, `attachments[]`.

### `priceLists` (optional)
`name`, `insuranceCompanyId?`, `items: [{ clinicProcedureId, price }]`, `validFrom/To`.

---

## 8. Accounting (T) — see `09_MODULE_ACCOUNTING.md`

### `accounts` (chart of accounts)
`code` (e.g. `1110`), `name` string, `type` (`asset`\|`liability`\|`equity`\|`revenue`\|`expense`), `subtype` (`cash`, `bank`, `accounts_receivable`, `inventory`, `fixed_asset`, `accounts_payable`, `tax_payable`, `payroll_payable`, `patient_credit`, …), `parentId`, `isGroup` (group accounts cannot be posted to), `isSystem` (system-mapped, cannot be deleted), `systemKey?` (e.g. `AR_PATIENTS`, `VAT_OUTPUT`), `normalBalance` (`debit`\|`credit`), `currency`, `isActive`.

Index: `{clinicId, code}` unique; `{clinicId, systemKey}` unique sparse.

### `journalEntries` (immutable once posted)
`number`, `date`, `fiscalPeriodId`, `source` (`invoice`\|`credit_note`\|`payment`\|`refund`\|`expense`\|`supplier_bill`\|`supplier_payment`\|`payroll`\|`manual`\|`opening`\|`closing`\|`reversal`), `sourceId`, `memo`, `lines: [{ accountId, debit: Money, credit: Money, patientId?, supplierId?, staffId?, dentistId?, description }]`, `status` (`draft`\|`posted`\|`reversed`), `reversalOfId?`, `reversedById?`, `postedAt`, `postedBy`, `approvedBy?` (manual entries).

Invariants:
- Σdebit = Σcredit > 0;
- every line has exactly one of debit or credit > 0;
- the period is open;
- group accounts are rejected.

Indexes: `{clinicId, date}`, `{clinicId, source, sourceId}`, `{clinicId, 'lines.accountId', date}`.

### `fiscalYears` / `fiscalPeriods`
`year`, `startDate`, `endDate`, `status` (`open`\|`closed`). Periods are monthly with status `open`\|`soft_closed`\|`closed`.

### `taxRates`
`name` string, `rate` (basis points, e.g. 1600 = 16%), `jofotaraCategory` (`S`\|`Z`\|`O`), `outputAccountId`, `inputAccountId`, `isDefault`. Medical services in Jordan are often exempt; configure per clinic.

### `suppliers`
`name` string, `kind` (`lab`\|`supplies`\|`equipment`\|`services`\|`other`), `taxNumber`, `contact`, `payableAccountId`, `balance`.

### `supplierBills`
`number`, `supplierId`, `billDate`, `dueDate`, `lines: [{ description, expenseAccountId, amount, taxRateId, labOrderId?, itemId? }]`, `total`, `status` (`draft`\|`posted`\|`partially_paid`\|`paid`\|`void`), `journalEntryId`.

### `supplierPayments`
`supplierId`, `amount`, `method`, `paidFromAccountId`, `allocations: [{ billId, amount }]`, `journalEntryId`.

### `expenses`
Quick expenses without a supplier bill: `date`, `categoryAccountId`, `amount`, `taxRateId?`, `paidFromAccountId`, `payee`, `receiptFileId`, `status` (`draft`\|`approved`\|`void`), `journalEntryId`.

### `cashSessions` (daily cash close)
`cashAccountId`, `openedBy`, `openedAt`, `openingFloat`, `closedAt`, `countedAmount`, `expectedAmount`, `difference`, `differenceJournalEntryId?`.

---

## 9. HR (T) — see `08_MODULE_HR.md`

### `shifts`
`name` string, `weekly: [{ weekday, start, end, breakMinutes }]`, `graceMinutes`, `isDefault`.

### `attendance`
`staffId`, `date` (clinic-local `YYYY-MM-DD`), `checkIn { at, method: web|qr|manual, geo? }`, `checkOut { … }`, `scheduledStart`, `scheduledEnd`, `lateMinutes`, `earlyLeaveMinutes`, `overtimeMinutes`, `workedMinutes` (computed server-side), `status` (`present`\|`absent`\|`on_leave`\|`holiday`\|`weekend`), `leaveRequestId?`, `adjustedBy?`, `adjustmentReason?`, `payrollRunId?` (locked once in payroll).

Index: `{clinicId, staffId, date}` unique.

### `leaveTypes`
`name` string, `code` (`annual`, `sick`, `unpaid`, `maternity`, `hajj`, …), `paid: boolean`, `annualEntitlementDays`, `accrual` (`yearly`\|`monthly`), `carryOverMaxDays`, `requiresAttachment`.

### `leaveBalances`
`staffId`, `leaveTypeId`, `year`, `entitled`, `carriedOver`, `taken`, `pending`, `remaining` (virtual).

### `leaveRequests`
`staffId`, `leaveTypeId`, `startDate`, `endDate`, `halfDay?`, `days` (computed: excludes weekends and holidays), `reason`, `attachmentFileId?`, `status` (`pending`\|`approved`\|`rejected`\|`cancelled`), `decision { byStaffId, at, comment }`. On approval it creates `scheduleExceptions` (for dentists) and marks attendance.

### `salaryComponents`
`name` string, `kind` (`earning`\|`deduction`), `calc` (`fixed`\|`percent_of_basic`\|`per_hour`), `taxable`, `subjectToSocialSecurity`, `accountId` (expense or liability).

### `payrollRuns`
`period { year, month }`, `status` (`draft`\|`calculated`\|`approved`\|`paid`\|`cancelled`), `payslipIds[]`, `totals { gross, deductions, employerContributions, net }`, `approvedBy`, `approvedAt`, `journalEntryId`, `paymentJournalEntryId`.

### `payslips`
`payrollRunId`, `staffId`, `basic`, `earnings: [{ componentId, name, amount }]`, `deductions: [{ … }]`, `overtime { minutes, amount }`, `absenceDeduction`, `unpaidLeaveDeduction`, `commission { basis, base, percent, amount, procedureIds[] }`, `socialSecurity { employee, employer }`, `incomeTax`, `gross`, `net`, `status` (`draft`\|`final`), `acknowledgedAt` (employee e-acknowledges, replacing Hakeemna's salary signature).

---

## 10. Inventory (T, later phase)
- `inventoryItems`: `sku`, `name`, `unit`, `reorderLevel`, `costMethod: average`, `quantityOnHand`, `averageCost`, `inventoryAccountId`, `expenseAccountId`.
- `stockMovements`: `itemId`, `type` (`purchase`\|`consumption`\|`adjustment`\|`return`), `quantity`, `unitCost`, `refType`, `refId`, `journalEntryId?`.

---

## 11. Notifications (T)
- `notifications`: `userId`, `type`, `title` string, `body` string, `link`, `data`, `readAt`, `priority`.
- `messageLogs`: `channel` (`whatsapp`\|`email`\|`sms`\|`push`), `to`, `template`, `payload`, `status` (`queued`\|`sent`\|`delivered`\|`failed`), `providerMessageId`, `error`, `attempts`, `relatedType`, `relatedId`.
- `notificationPreferences`: `userId`, `channels per event type`.

---

## 12. Entity Relationship Overview

```
Clinic 1─* Staff *─* Role
Clinic 1─* Patient 1─* Appointment *─1 Staff(dentist)
                                    *─1 Chair
Patient 1─1 ToothChart, 1─* ChartEntry, 1─* TreatmentPlan 1─* items
Appointment 1─* PerformedProcedure ─→ InvoiceLine
Invoice *─* Payment (allocations)   Invoice ─→ JournalEntry
Payment ─→ JournalEntry            PayrollRun 1─* Payslip ─→ JournalEntry
Supplier 1─* SupplierBill ─→ JournalEntry
JournalEntry 1─* lines ─→ Account (tree)
```
