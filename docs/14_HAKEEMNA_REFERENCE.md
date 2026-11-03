# ElDental — Hakeemna Reference (what was kept, changed, removed)

> Hakeemna backend lives at `C:\Users\ASUS\Desktop\hakeemna\hakeemna-backend` and the frontend at `C:\Users\ASUS\Desktop\hakeemna\hakeemna-frontend`.
> Read the referenced files **for domain knowledge only**. Do not copy their code style. ElDental is TypeScript with the layering described in `02_ARCHITECTURE.md`.

---

## 1. Removed on purpose
| Hakeemna concept | Where it lived | Why removed | ElDental replacement |
|---|---|---|---|
| **Work groups** | `models/companies/unitServices/work_groups.model.js`, `utils/queryScope.js`, `utils/scopeResolver.js`, `middleware/security.js` (workGroupIds) | It was both "the doctor's calendar" and the data-scope unit. That made appointments have no doctor field, and an employee with no group saw nothing. | `appointments.dentistId` + `chairId`; permission scopes `own`/`all` |
| **Departments** | `models/companies/unitServices/departments.model.js` + `department` field on ~15 models | Not meaningful for a dental clinic | Nothing (chairs/rooms cover the physical layout) |
| **Employee engagement** | `models/companies/unitServices/employee_engagement.model.js`, `employees.selected_engagement` | The person↔clinic link with roles, salary and schedule; multi-clinic switching through an index on the user | `staff` (one document per user+clinic) + clinic chosen at login (`/auth/select-clinic`) |
| Pre-generated empty appointments | `controller/shared/appointment_config.controller.js` (`createConfig`), cron `0 22,1 * * *` | Data bloat, edits to the config don't propagate, race conditions | On-demand availability engine + slotLocks |
| Entrance management | `models/shared/entrance_management.model.js` | Duplicated appointment state | Appointment state machine + today board |
| Invoice-only accounting | `models/companies/accounting/economic_movements.model.js` (+ `income_payment_control`, `receipt_payment_voucher_num`, `provided_service_movement`, `tax_movement`, `deduction_amount`) | No ledger; `Ledger_account_*` never used | Double-entry GL (`09_MODULE_ACCOUNTING.md`) |
| Frontend payroll calculation | FE `sections/unit-service/hr/salary`, BE `monthlyReports.model.js` | Untrustworthy totals | Server-side payroll runs + payslips |
| Stakeholders marketplace, blogs, training, video calls, TPO claims integration | various | Out of scope for v1 | Possibly later |

## 2. Kept (concept), rebuilt properly
| Concept | Hakeemna source to read for domain knowledge | ElDental location |
|---|---|---|
| Permission strings + role templates (FULL_ADMIN, RECEPTIONIST, DOCTOR, NURSE, ACCOUNTANT, HR_MANAGER) | `utils/permissions.js`, `models/companies/unitServices/role.model.js`, FE `src/auth/guard/acl-guard.jsx` | `core/rbac/*`, `04_ROLES_AND_PERMISSIONS.md` |
| Owner bypass (`is_owner`) | `middleware/security.js` (`hasPermission`) | `staff.isOwner` |
| Appointment statuses & display status | `utils/appointmentLifecycle.js`, `models/shared/appointments.model.js` (`state`) | `06_MODULE_APPOINTMENTS.md` §4 |
| Appointment reminders "are you coming?" | `appointments.controller.js` `getBookedAppointments` (cron 20:00) | reminder jobs + confirmation |
| WhatsApp (Mazbot): login → JWT + apikey, ~1.1 s throttle, phone normalisation with 962 default, template ids per event | `utils/mazbot.js`, `routes/superAdmin/whatsapp.routes.js` | `core/notifications/whatsapp/mazbot.client.ts` (credentials from `platformSettings`, not env) |
| Email OTP template | `utils/emailForm.js` (`SendEmailByForm`) | `core/notifications/email/templates/*` |
| OTP for reset/activation (6 digits, hashed) | `controller/shared/auth.controller.js` | `modules/auth` (TTL shortened to 10 min) |
| JoFotara UBL 2.1 e-invoice (types 011 / 021) | `controller/companies/invoicing/invoicing.controller.js` | `modules/accounting/einvoice/*` |
| Dental chart & diagnoses | `models/patients/dental_chart.model.js`, `models/patients/dental_diagnoses.model.js`, FE `src/sections/dental` | `07_MODULE_DENTAL_CLINICAL.md` |
| Dental lab requests | `models/patients/lab_request.model.js`, `routes/patients/lab_requests.routes.js` | `labOrders` |
| Prescriptions, sick leave, medical reports | `models/patients/drugs_prescriptions.model.js`, `sick_leave.model.js`, `doctor_reports.model.js` | `prescriptions`; sick leave & medical reports → `medicalCertificates` (`07` §14, immutable, void only) |
| Extra patient details (nationality, marital status, blood type, height/weight, old file number, photo, ID check, "referred by") | `models/patients/patients.model.js`, `unit_service_patients.model.js` | `patients` fields (`03` §4); one input per field, nationality as ISO code, flags as fixed codes |
| Patient communication notes (`usp_communication`: date + free-text description per employee) | `models/patients/usp_communication.model.js` | `patientCommunications` (`03` §4): structured channel/outcome, follow-ups, own/all scope |
| Patient instructions (`instructions` linked to an `adjustable_document`) | `models/shared/instructions.model.js` | `instructionTemplates` + `patientInstructions` (`07` §15): seeded per procedure, text snapshot, portal access |
| Bringing existing patient files in (spreadsheets kept by the clinic) | — (manual entry in Hakeemna) | `POST /patients/import` + import wizard (dry run, duplicates, one audit) |
| Speciality questionnaires (per clinic activation, patient link) | `models/patients/questionnaires/*`, `utils/questionnaire.js` | medical history questionnaire (versioned) |
| Attendance late/overtime against the schedule, GPS on check-out | `controller/companies/unitServices/attendance.controller.js` | `08_MODULE_HR.md` §3 (server-side) |
| Patient per clinic (`unit_service_patients`) | `models/patients/unit_service_patients.model.js` | `patients` is tenant-scoped directly; a portal `users` record links to many clinic patients |
| Insurance companies / types / patient data | `models/companies/insurance/*` | `insuranceCompanies`, `insurancePolicies`, `insuranceClaims` |
| Service types / price list with tax & deduction | `models/companies/accounting/service_types.model.js` | `clinicProcedures` + `taxRates` |
| Audit fields (`user_creation`, `ip_address_user_creation`, …) | `middleware/saveData.js` (ADDL) | `auditFields` plugin + `auditLogs` |
| Notifications fan-out via socket rooms + Expo push | `middleware/notifications.js`, `notification.js` | `core/notifications`, socket rooms (push later) |
| System errors stored and shown to superadmin | `middleware/errorsHandler.js` | `systemErrors` + admin page |
| Bilingual fields (`name_english` / `name_arabic`), `arabic_message` | everywhere | **one input per field** (plain string) + i18n for the UI and seeded data; error `code` translated client-side |
| Demo accounts with expiry | `utils/demoAccount.js`, `middleware/demoGuard.js` | optional later: clinic `subscription.status = trialing` |
| Daily DB backup | `utils/backup.js` (mongodump → Telegram) | encrypted off-site backup (no chat apps) |

## 3. Known Hakeemna problems not to repeat
See `11_SECURITY.md` §11, plus:
- Typos and inconsistent field/route names (`/remiders`, `/calender`, `/attendence`, `Apointment`, `expences`).
- Copy-pasted `pre('save')` counters in every model → one `sequenceService`.
- Controllers write `req.error` and call `next()` → throw `ApiError`.
- Responses had no envelope; error formats were mixed (strings vs objects) → the uniform envelope in `05_API_CONVENTIONS.md`.
- Frontend: 4 date libraries, token in localStorage, header set on the global axios instead of the instance, `selected_engagement` lookups in 239 files → one dayjs, in-memory token, a single axios instance, `staff` from `/auth/me`.

## 4. Login & seed parity
Hakeemna dev users: `superadmin@hakeemna.com`, `admin@hakeemna.com`, `alaa@employee.com` (password `12345678`).

ElDental seed (Phase 1) creates:
- `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` from `backend/.env`;
- demo clinic users, all with password `Password123!` (≥ 10 chars per password policy):
  - `owner@smile.local`
  - `dentist@smile.local`
  - `reception@smile.local`
  - `accountant@smile.local`
  - `hr@smile.local`
