# ElDental — Product Requirements (PRD)

> Multi-clinic SaaS for dental practices: scheduling, dental charting, treatment plans, billing with full double-entry accounting, HR & payroll, and a patient portal.
> Built on the same domain model as **Hakeemna**, without work groups, departments or employee engagements, and rebuilt to current best practice.

---

## 1. Vision

A dental clinic in Jordan (and the wider region) should be able to sign up, configure its chairs, dentists, procedures and prices in under an hour, and then run its entire day from ElDental:
- book the patient;
- chart the teeth;
- plan treatment;
- perform procedures;
- invoice, collect payment and send the e-invoice to JoFotara;
- pay staff.

Every financial event posts to a real general ledger automatically.

Arabic is the default language (RTL); English is fully supported.

---

## 2. Applications

| App | URL prefix | Users |
|---|---|---|
| **Superadmin panel** | `/admin` | Platform owner and the platform's support staff |
| **Clinic dashboard** | `/clinic` | Clinic owner, dentists, hygienists, assistants, receptionists, accountants, HR |
| **Patient portal** | `/portal` | Patients (and guardians of child patients) |
| **Public pages** | `/`, `/book/:clinicSlug` | Anyone; public clinic page with online booking |

One backend serves all apps. One frontend codebase contains all route trees.

---

## 3. Personas

| Persona | Primary goals |
|---|---|
| **Superadmin** (level 1: full; level 2: limited by permissions) | Onboard clinics, manage plans and subscriptions, manage global reference data (procedure code library, medicines, tooth conditions), monitor system health, support |
| **Clinic Owner** | Everything inside their clinic; financial reports; staff and roles; settings |
| **Dentist** | See own schedule, chart teeth, write treatment plans, record procedures and notes, prescribe, order lab work, see own production and commission |
| **Hygienist / Assistant** | Perio charting, assist in clinical notes, prepare chair, imaging |
| **Receptionist** | Book, reschedule and cancel appointments; check in patients; register patients; take payments; manage waiting list and recalls |
| **Accountant** | Invoices, payments, expenses, suppliers, journal entries, insurance claims, reports, period closing |
| **HR Manager** | Staff profiles and contracts, shifts, attendance, leave approval, payroll runs, payslips |
| **Patient** | Book online, see upcoming and past appointments, treatment plans (accept or decline), invoices and balance, download documents, update profile, manage family members |

A user can have **multiple roles** inside one clinic (e.g. Owner + Dentist).

---

## 4. Feature Scope (by module)

### 4.1 Platform (Superadmin)
- **Clinics:** create, suspend, activate, set plan, set subscription expiry, impersonate (audited, read-only by default).
- **Plans & subscriptions:** limits (chairs, staff, patients, SMS/WhatsApp quota), billing history.
- **Global catalogs:**
  - procedure code library (CDT-like; seeded names shown in the UI language via i18n);
  - tooth conditions;
  - medicines;
  - countries, cities and currencies;
  - VAT presets;
  - role templates.
- **Monitoring:** system errors log, audit log viewer, announcements to clinics, support tickets.

### 4.2 Clinic setup
- Clinic profile: name (one input), logo, address, tax number, working hours, timezone, currency, invoice footer.
- **Chairs (operatories)** and **rooms**.
- **Procedure price list.** Clinic prices are based on the global library, can be customised, and may include an insurance price per insurer.
- Appointment types (exam, cleaning, root canal session, …) with default duration and colour.
- Integration settings: WhatsApp templates, JoFotara credentials (stored encrypted), SMTP override.
- Roles & permissions editor (see `04_ROLES_AND_PERMISSIONS.md`).

### 4.3 Patients
- Registration and search (name, phone, national ID, file number).
- Clinic-scoped file number.
- Demographics, emergency contact and guardian.
- Medical history questionnaire, allergies and alerts.
- Insurance policies.
- Documents and imaging.
- Family linking.
- Merge duplicates.
- Patient timeline: appointments, procedures, invoices, notes.

### 4.4 Appointments & scheduling (see `06_MODULE_APPOINTMENTS.md`)
- Dentist schedules, schedule exceptions (vacation, extra hours) and chair availability.
- Free-slot search computed on demand.
- Booking by staff, online by patient, or walk-in.
- Status lifecycle, reschedule, cancel (with reason), no-show tracking.
- Waiting list, recalls (e.g. 6-month cleaning), reminders (WhatsApp, email, push).
- Day, week and resource (chair/dentist) calendar views; front-desk "today" board.

### 4.5 Clinical / Dental (see `07_MODULE_DENTAL_CLINICAL.md`)
- Odontogram (FDI, permanent and primary dentition), conditions per tooth and surface.
- Treatment plans: phases, items, estimates, insurance coverage estimate, patient acceptance with signature.
- Procedures performed, linked to tooth and surface, dentist and appointment.
- Clinical notes (templates, SOAP), perio chart.
- Prescriptions (printable), lab orders (crowns, dentures, aligners) with tracking.
- Imaging (X-ray, intraoral photos, CBCT links).
- Consent forms with e-signature.

### 4.6 Billing & Accounting (see `09_MODULE_ACCOUNTING.md`)
- Invoices from completed procedures or manual lines; discounts; VAT; installments and payment plans.
- Payments (cash, card, bank transfer, cheque, insurance); receipts; refunds; credit notes.
- Patient balances and statements; AR aging.
- Insurance: insurers, coverage rules, claims, claim payments, patient/insurer split.
- Expenses and suppliers (bills, supplier payments).
- **Double-entry general ledger:**
  - chart of accounts;
  - automatic journal entries;
  - manual journals (with approval);
  - fiscal periods and closing.
- Reports: trial balance, P&L, balance sheet, cash flow, daily cash close, dentist production, collections.
- JoFotara e-invoice submission with QR on the printed invoice.

### 4.7 HR & Payroll (see `08_MODULE_HR.md`)
- Staff profiles, contracts, documents and licence expiry alerts.
- Shifts and attendance (check-in/out, late, overtime).
- Leave types, balances, requests and an approval workflow.
- Payroll runs:
  - basic pay, allowances and deductions;
  - social security;
  - income tax hook;
  - dentist commission on collected or produced amounts.
- Payslips, plus a ledger posting for each run.

### 4.8 Inventory (spec: `08b_MODULE_INVENTORY.md`)
- Items with lots and expiry, stock per location (stores, chair cabinets, medication preparation, quarantine).
- Purchasing: purchase order → goods receipt → supplier bill → payment (through accounting).
- Individual containers (bottles, vials) with opening, partial use, multi-dose and single-use rules.
- Materials used recorded on performed procedures, suggested from per-procedure defaults; perpetual accounting.
- Low-stock and expiry alerts.

### 4.9 Notifications
- In-app notifications (socket), email, WhatsApp, and push in the future.
- Per-user notification preferences.
- All outbound messages are queued and logged.

### 4.10 Patient portal
- Sign up with phone/email and OTP verification; link to an existing clinic patient record via OTP.
- Online booking (only appointment types and dentists the clinic allows online).
- View and cancel appointments within the clinic's cancellation window.
- View treatment plans and accept them.
- View invoices, balance and receipts (PDF).
- Family members (guardian manages child profiles).

---

## 5. Non-Goals (explicit)

These Hakeemna concepts are **intentionally not built**:

| Removed | Replacement |
|---|---|
| **Work groups** (calendar owner + data-scope unit) | Appointments reference `dentistId` + `chairId` directly. Data scope comes from permission scopes `own`/`all`. |
| **Departments** | None. A dental clinic is a single unit; chairs and rooms cover the physical layout. |
| **Employee engagement** (a person engaged to many clinics, `selected_engagement`) | `Staff` = one document per (user, clinic). A user who works at two clinics has two Staff documents, and the clinic is chosen at login. |

Also out of scope for v1:
- native mobile apps (the web app is responsive and installable as a PWA);
- video calls;
- blogs;
- marketplace / stakeholder ordering.

---

## 6. Non-Functional Requirements

| Area | Requirement |
|---|---|
| **Tenancy** | Strict isolation. Every tenant document has `clinicId`, enforced in the data layer and covered by automated tests. |
| **Security** | OWASP ASVS L2 mindset. See `11_SECURITY.md`. |
| **Performance** | p95 API < 300 ms for list endpoints at 100k patients per clinic. Calendar week view < 500 ms. |
| **Availability** | Stateless API (horizontal scale), jobs in BullMQ, Mongo replica set. |
| **Auditability** | All writes to clinical and financial data are audit-logged (who, when, before/after). Journal entries are immutable. |
| **i18n** | ar (default, RTL) and en; dates in the clinic timezone; currency per clinic (JOD default, 3 decimals). |
| **Accessibility** | WCAG 2.1 AA for the patient portal. |
| **Data retention** | Soft delete everywhere; clinical and financial data are never hard-deleted by users. |
| **Backups** | Daily encrypted backups, restore tested (see `11_SECURITY.md`). |

---

## 7. Success Metrics
- A clinic is onboarded and the first appointment is booked in under 30 minutes.
- The front desk books an appointment in under 3 clicks after the patient is found.
- 0 cross-tenant data leaks (automated tenant-isolation test suite).
- Trial balance always balances (enforced by invariant tests).
