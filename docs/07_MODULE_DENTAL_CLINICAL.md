# ElDental — Module: Dental Clinical

---

## 1. Tooth Numbering (FDI / ISO 3950)

| Quadrant | Permanent | Primary |
|---|---|---|
| Upper right | 11–18 | 51–55 |
| Upper left | 21–28 | 61–65 |
| Lower left | 31–38 | 71–75 |
| Lower right | 41–48 | 81–85 |

- Constants live in `shared/dental/teeth.ts`: `PERMANENT_TEETH`, `PRIMARY_TEETH`, `isValidTooth(n)`, `quadrantOf(n)`, `isAnterior(n)`, and a display helper that converts to Universal numbering (display preference only; FDI is always stored).
- Surfaces: `M` mesial, `D` distal, `O` occlusal (posterior), `I` incisal (anterior), `B` buccal, `F` facial/labial (anterior), `L` lingual, `P` palatal. Validation: `O` is only valid on posterior teeth and `I` only on anterior teeth.

## 2. Odontogram (Tooth Chart)

**Data:** `toothCharts` (current state snapshot) + `chartEntries` (append-only history). See `03_DATA_MODEL.md` §6.

**Entry kinds:**
- `existing`: work found on arrival (e.g. old crown);
- `finding`: a diagnosis (e.g. caries on 36 MO);
- `planned`: created automatically from treatment plan items;
- `completed`: created automatically when a procedure is performed.

**Rules:**
- Adding an entry updates the snapshot in the same transaction.
- Entries are never edited. A mistake is fixed with a new entry `kind: existing|finding` and `voidsEntryId` (audit trail).
- Snapshot conditions are derived. For example, a completed `D3310` (RCT) on 46 adds `rct`, and a completed extraction sets `status: missing`.
- Mapping lives in `procedureCatalog.chartEffect`: `{ setStatus?, addCondition?, removeConditions? }`.

**UI component `<ToothChart>`** (frontend `features/clinical/chart`):
- 32 + 20 teeth, each drawn as an anatomical tooth with a 5-zone surface wheel. Clicking a wheel zone selects that surface; clicking the tooth selects the whole tooth.
- The tooth drawings come from the MIT-licensed [React-Odontogram-Modul](https://github.com/ZoliQua/React-Odontogram-Modul) artwork, by way of Hakeemna (`components/odontogram/NOTICE.md`). Condition codes map to artwork layers in `odontogram/layers.ts`, for example caries and fillings per surface, crown, RCT/post, implant, bridge, veneer, fracture and impacted. Codes the artwork cannot draw (mobility, abscess, custom codes) show as coloured badges. Planned work shows as markers, never as finished work. The artwork is loaded as its own chunk the first time a chart opens.
- View toggles, display only and never saved: occlusal view (premolars/molars), wisdom teeth, bone & gum, pulp.
- Layers can be toggled: existing / findings / planned / completed, with colours from `toothConditionsCatalog`.
- Mode switch: permanent / primary / mixed.
- Clicking a tooth opens a side panel with history for that tooth and quick actions: add finding, add to plan, record procedure.
- RTL-safe: chart orientation follows dental convention (patient's right on the viewer's left), **not** text direction.
- Printable chart (PDF).

> **PDF output:** plans, prescriptions and consents are rendered as print-ready A4 pages in the browser ("Print / Save as PDF"). This keeps Arabic shaping and RTL correct without a server-side font pipeline; server-side PDF (for e-mail attachments) can be added later.

## 3. Treatment Plans

**Lifecycle:** `draft → presented → accepted | partially_accepted | rejected → in_progress → completed`; can be `cancelled` from any non-completed state.

- The dentist builds a plan from chart findings ("add to plan") or by picking procedures. Each item has tooth, surfaces, procedure, quantity and price (clinic price, or the insurer price if a policy is selected).
- Optional **phases**: Urgent / Phase 1 / Phase 2 / Maintenance.
- **Alternatives:** a plan can have several options (e.g. "Implant" vs "Bridge"). Implemented as separate plans grouped with `alternativeGroupId`; accepting one rejects its siblings.
- **Estimates per item:**
  - `insuranceEstimate` = price × coverage% for the procedure category, capped at the policy's remaining annual max;
  - `patientEstimate` = rest.
- **Present:**
  - generates a PDF (clinic letterhead, items, totals, validity date, terms);
  - optionally sends a portal link;
  - `presentedAt` is set.
- **Accept:**
  - per item or whole plan;
  - captures a signature (canvas → PNG → `fileAssets`), plus who, when and IP;
  - from the portal or on a tablet in the clinic.
- Accepted items can be **scheduled**: booking with `plannedItems` links the appointment to plan items, which become `scheduled`.
- When a linked procedure is performed, the item becomes `completed`. When all accepted items are completed, the plan becomes `completed`.
- The plan stores its own prices (frozen at presentation). Later price-list changes do not affect it.

## 4. Performed Procedures (production source of truth)

`POST /performed-procedures` with `{ patientId, appointmentId?, treatmentPlanItemId?, clinicProcedureId, toothNumbers, surfaces, dentistId, assistantIds, quantity, unitPrice?, discount?, notes }`

Validation:
- the tooth is required if the procedure's `toothRequired`;
- surfaces are valid for the tooth;
- with `own` scope, the dentist must be the caller;
- price defaults to the clinic or insurer price;
- overriding the price needs `billing.invoice.discount`.

Effects (in one transaction):
- add a chart entry with `kind: completed`;
- update the plan item;
- emit `procedure.completed`. Subscribers: billing (add a line to the visit's draft invoice), HR commission (accrue if `commissionEligible`), recalls.

Void: `POST /:id/void { reason }`. Allowed only if the linked invoice line is still a draft; otherwise a credit note is required first.

## 5. Clinical Notes
- SOAP or free text, from templates (e.g. "RCT visit", "Extraction", "New patient exam").
- Templates support placeholders: `{{patient.name}}`, `{{tooth}}`, `{{procedures}}`.
- **Sign** locks the note (`signedAt`). After that, only **amend** is possible, which creates a new note referencing the original. The original stays visible.
- Unsigned notes older than 24h appear on the dentist's dashboard as a to-do.

## 6. Periodontal Chart
- 6 sites per tooth (MB, B, DB, ML, L, DL): probing depth, recession, bleeding on probing (BOP), suppuration. Per tooth: mobility (0–3), furcation (I–III), plaque.
- Computed: CAL = PD + recession; %BOP; number of sites ≥ 4 mm / ≥ 6 mm.
- Fast keyboard entry UI (type digits and it auto-advances sites) and a comparison view between two exams.

## 7. Prescriptions
- Items come from the global medicines catalog or free text.
- The PDF headings follow the clinic's print language (ar or en, via i18n) and includes the dentist's name, license number, signature and stamp, and a QR code with the prescription number for verification.
- Common dental presets: analgesics, antibiotics, chlorhexidine mouthwash.

## 8. Lab Orders
- **Lifecycle:** `draft → sent → in_progress → received → fitted`. Side branches: `remake` (back to sent with a reason) and `cancelled`.
- Linked to the lab supplier, the patient and the plan items. `dueDate` drives a reminder to reception 2 days before.
- `cost` is entered on receipt and creates a **supplier bill draft** (accounting), so lab cost per case is visible in profitability reports.

## 9. Imaging & Documents
- Upload X-rays (periapical, bitewing, panoramic), intraoral photos and scanned documents. Tag them with tooth numbers, category and the date taken.
- The viewer has a lightbox with zoom, pan, brightness/contrast and side-by-side comparison. DICOM/CBCT is out of scope for v1; store a link or file only.
- All files go through `fileAssets` and the authorised download endpoint (no public URLs).

## 10. Consent Forms
- Templates are written once (one text input, any language) with placeholders (patient, procedure, tooth, risks, date).
- Rendered at signing time, then frozen into `renderedBody` and signed (patient signature, optional witness). A PDF is stored.
- A setting can require consent for some procedure categories (surgery, implants). Recording that procedure without a signed consent shows a warning, or blocks it when the setting is `strict`.

## 11. Medical History & Alerts
- A structured questionnaire, versioned, reviewed by the dentist at least every 6 months (a reminder badge when overdue).
- Each version records conditions, regular medicines (autocomplete from the global medicine catalog, or typed), previous surgeries, smoking/alcohol, pregnancy weeks (only when pregnant), allergies and notes. The version viewer shows exactly what each version recorded; the overview shows a "Medical background" card.
- Allergies and critical conditions (anticoagulants, bisphosphonates, pregnancy, heart conditions, diabetes) are denormalised into `patients.medicalAlerts`. They appear as a red banner on every clinical screen and on the appointment card.

## 12. Dental Procedure Catalog (seed)
Seed a starter global catalog of about 80 common procedures and categories. Seeded names come from i18n keys (`seed.procedure.<code>`), so they show in the UI language until the clinic renames them. Examples:

| Code | Category | Name (en) | chartEffect |
|---|---|---|---|
| D0120 | diagnostic | Periodic oral evaluation | — |
| D0150 | diagnostic | Comprehensive oral evaluation | — |
| D0210 | diagnostic | Full-mouth X-rays | — |
| D1110 | preventive | Prophylaxis – adult | recall 6m |
| D1351 | preventive | Sealant – per tooth | addCondition sealant |
| D2140–D2394 | restorative | Amalgam / composite fillings (1–4 surfaces) | addCondition filling (surfaces) |
| D2740 | restorative | Crown – porcelain/ceramic | addCondition crown |
| D3310–D3330 | endodontics | Root canal – anterior / premolar / molar | addCondition rct |
| D4341 | periodontics | Scaling & root planing per quadrant | — |
| D5110 / D5120 | prosthodontics | Complete denture upper/lower | — |
| D6010 | implants | Implant body placement | setStatus implant |
| D7140 | oral_surgery | Extraction – erupted tooth | setStatus missing |
| D7210 | oral_surgery | Surgical extraction | setStatus missing |
| D8080 | orthodontics | Comprehensive ortho treatment | recall ortho_adjustment monthly |
| D9972 | cosmetic | External bleaching per arch | — |

> Codes are "CDT-like" for internal standardisation. The clinic can rename them and set its own codes. Check licensing before shipping the official CDT descriptors; ship our own wording.

## 13. Dental Specialties
- **Fixed catalog** in `backend/src/shared/dental/specialties.ts` (synced to the frontend): `general`, `orthodontics`, `oral_surgery`, `endodontics`, `periodontics`, `prosthodontics`, `pediatric`, `implantology`, `cosmetic`, `oral_medicine`. Codes are stable and stored; names come from i18n (`staff:specialties.<code>`, ar + en), never from the database. Clinics can't add their own (for now).
- **On staff:** `specialties[]` + `primarySpecialty`, dentists and hygienists only (`422 not_allowed_for_staff_type`). When any are set, exactly one is primary and it is in the list (`required` / `primary_not_in_list`). Changing the staff type to a non-clinical one clears them. Field access key: `staff.member.specialties`.
- **Clinic specialties** are derived from its active doctors (`GET /staff/specialties`); there is no separate clinic catalog.
- **Used for:** doctor search (`GET /staff?specialty=`), availability (`GET /availability?specialty=`, ready for online booking), the doctor label in the booking drawer, prescriptions and treatment-plan prints (primary specialty), and future reports by specialty.
- **Never** for permissions, and never to block a procedure: specialties guide, they don't restrict.
- **Migration from the old free-text field:** `npm run migrate:specialties` (dry run: reports what maps and what doesn't), `-- --apply` (maps recognised English/Arabic wording, keeps the old text in `specialtyLegacy`, leaves unmapped values untouched for review), `-- --rollback` (restores the old text and removes the structured fields of migrated records; specialty edits made after the migration are lost).

## 14. Medical Certificates
- Types: **sick leave**, **medical report**, **attendance certificate**. A dentist or hygienist issues them in their own name with the next `MC` number; the period is `from`–`to` (one day when `to` is empty, at most 60) and the days are derived.
- The drawer suggests wording per type (translated, with the patient's name and dates) until the dentist edits it.
- **Immutable:** there is no edit route and the model rejects changes. A wrong certificate is **voided with a reason** and a new one is issued; voided certificates stay on file and print with a "VOID" banner.
- Printed on the clinic letterhead with the patient, period, diagnosis, text, recommendations, the dentist's name/specialty/license and a signature line (signature and stamp images when on file). Prints are audited.
- Permissions `clinical.certificate.read` / `.issue` (own = certificates I issued). Shown on the patient timeline and moved on merge. The patient sees them in the portal (`My documents`, slice 5).

## 15. Post-treatment Instructions
- **Templates** (`instructionTemplates`, Settings → Care instructions): seeded defaults for extraction, filling, root canal, scaling, braces, dentures and whitening, shown in the UI language until the clinic edits them; each lists the procedure codes it is meant for.
- **Giving** (patient → Instructions): the drawer suggests templates whose codes were performed for this patient today (clinic time), fills the title and text, and the dentist adjusts them. What was given is stored as a **snapshot** with who gave it and when; it can be printed on the letterhead.
- **Portal → My documents** lists the account's certificates (`§14`) and instructions across its files and prints them through `/portal/*` endpoints limited to the account's own patients (others → 404).
