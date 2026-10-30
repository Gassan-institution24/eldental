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
- SVG with 32 + 20 teeth. Each tooth has 5 clickable surfaces plus a whole-tooth click.
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
