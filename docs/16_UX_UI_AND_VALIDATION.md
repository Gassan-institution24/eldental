# ElDental — UX/UI Design System & Input Validation

> Goal: a **complete, polished product**, not a template with forms.
> - Every screen is designed for its user's real task.
> - Every input is validated clearly, in Arabic and English, on the client **and** the server.
> - Every state (loading, empty, error, success, no permission) is handled.

---

## 1. Design Principles
1. **Task-first.** Design each screen around the job (e.g. the receptionist books in under 3 clicks after finding the patient). Primary action top-right in LTR, top-left in RTL; one primary button per view.
2. **Arabic-first, perfect RTL.**
   - Layout, icons with direction (arrows, chevrons, back), DataGrid, date pickers, charts and the calendar all mirror correctly.
   - The tooth chart **does not** mirror (dental convention).
   - Test every screen in both languages before marking it done.
3. **One input per value.** Users type data once (see `03_DATA_MODEL.md` §1.1). Inputs use `dir="auto"`, so Arabic or English text aligns naturally in either UI language.
4. **Forgiving and clear.** Validate early but not aggressively. Explain what's wrong and how to fix it. Never lose typed data (drafts autosave for long forms).
5. **Consistency.** The same patterns everywhere: list → detail → edit drawer/dialog, the same status colours, the same empty states.
6. **Speed.** Keyboard shortcuts, typeaheads, smart defaults, optimistic updates where safe, skeleton loaders (not spinners) for content.
7. **Accessible.** WCAG 2.1 AA: contrast, focus rings, labelled controls, ARIA for custom widgets (tooth chart, calendar), full keyboard support. Minimum touch target 44×44 px.

---

## 2. Visual Design System
| Token | Value |
|---|---|
| Primary | Indigo `#4F46E5` (light) / `#8B87FF` (dark), with a full 50–900 scale |
| Secondary | Cyan `#06B6D4` (light) / `#22D3EE` (dark) |
| Brand gradient | `linear-gradient(135deg, #4F46E5, #7C3AED 55%, #06B6D4)` for primary buttons, the logo mark, highlights |
| Sidebar | Deep navy gradient `#0B1020 → #111936` in both modes, white text, gradient pill for the active item |
| Semantic | success `#10B981`, warning `#F59E0B`, error `#EF4444`, info `#0EA5E9` |
| Neutrals | background `#F5F6FB` (light) / `#0A0F1E` (dark); paper `#FFFFFF` / `#11172B` |
| Typography | Arabic **IBM Plex Sans Arabic** or **Tajawal**; Latin **Inter**. Scale: h1 32, h2 26, h3 22, h4 18, body 15, small 13; line-height 1.6 for Arabic |
| Radius | 16 px (cards), 12 px (inputs, buttons), 20 px (dialogs) |
| Spacing | 4-px grid; page gutter 24 desktop / 16 mobile |
| Elevation | Cards with a 1 px border and a soft shadow; deeper shadows on hover and floating elements; frosted (blurred) top bars |
| Icons | One icon set only (Iconify Solar or Lucide), 20 px default |
| Motion | 150–200 ms ease-out; respects `prefers-reduced-motion` |
| Dark mode | Full support; user toggle + system default |

**Status colours** (one `<StatusChip>` everywhere):
| Group | Statuses |
|---|---|
| Appointment | scheduled (grey), confirmed (blue), arrived (amber), in_chair (purple), completed (green), cancelled (red outline), no_show (red) |
| Invoice | draft (grey), issued (blue), partially_paid (amber), paid (green), void (red outline) |
| Leave / payroll / plan | Same mapping logic |

**Breakpoints:** xs < 600 (phone), sm 600–900 (tablet: front desk and chairside), md 900–1200, lg ≥ 1200.
- The clinic dashboard is fully usable on a tablet.
- The patient portal is mobile-first.

---

## 2.1 Public website
Marketing pages live at `/` (home), `/features`, `/pricing`, `/about`, `/security`, `/contact`, `/privacy`, `/terms` in `PublicLayout`. Signed-in users reach their app via `/app`. Contact requests are stored in `contactRequests` (`POST /public/contact`, public, rate-limited).

## 3. Layout & Navigation
- **Clinic app shell:**
  - collapsible side nav grouped by module, filtered by permissions;
  - top bar: global search (patients, appointments, invoices; `Ctrl/⌘+K`), quick actions (+ appointment, + patient, + payment), notifications bell, clinic switcher, language toggle (ع / EN), theme toggle, user menu (profile, my payslips, report a problem, logout).
- **Breadcrumbs** on detail pages. **Page header:** title, subtitle/count, primary action, secondary actions in an overflow menu.
- **Patient workspace:**
  - sticky `<PatientHeader>`: name, file no., age, alerts banner in red, balance, next appointment, quick actions;
  - tabs: Overview, Chart, Treatment plans, Notes, Perio, Imaging, Documents, Billing, History.
- **Lists:**
  - DataGrid with server pagination, sticky header, column chooser (only permitted fields), density toggle;
  - saved filters per user; filters reflected in the URL (shareable);
  - bulk actions with a confirmation;
  - CSV/XLSX export if permitted.
- **Create/edit:**
  - short forms (≤ 8 fields) open in a **right drawer** (left in RTL);
  - long forms open on a **full page with sections** and a sticky save bar;
  - wizards for multi-step flows: clinic onboarding, payroll run, online booking.
- **Dialogs** only for confirmations and small focused tasks.

---

## 4. Required States (every page / component)
| State | Requirement |
|---|---|
| Loading | Skeletons shaped like the content; buttons show an inline spinner and are disabled while submitting |
| Empty | Illustration + one sentence + primary action ("No patients yet, add your first patient") |
| Empty search | "No results for "x"", plus a clear-filters button |
| Error | Friendly message + retry + reference code (`reqId`) + "Report a problem" (see `15_LOGGING_AND_MONITORING.md`) |
| No permission | A 403 screen explaining what's missing ("You need permission: View employees"). Hidden in navigation anyway. |
| Read-only | Subscription suspended or period closed: banner + disabled actions with a tooltip explaining why |
| Offline | Top banner; mutations disabled; retry when online |
| Success | Snackbar (bottom, auto-hide 4 s) with **Undo** where possible (soft delete, cancel), or navigate to the created record |
| Unsaved changes | Leaving a dirty form shows a confirmation; long forms autosave drafts to localStorage |
| Destructive actions | Confirmation dialog naming the object ("Cancel appointment for Ahmad at 10:30?") + reason input where the domain requires it |

---

## 5. Input Validation — Rules

### 5.1 Architecture (single source of truth)
- Validation schemas are written **once in Zod** per DTO. They live in `backend/src/modules/<m>/<x>.schemas.ts` and are mirrored or shared in `frontend/src/features/<m>/schemas.ts`. Optionally a shared `packages/schemas` workspace; at minimum, keep the rules identical and covered by tests.
- Zod issues use **error codes, not sentences**: `z.string().min(2, { message: 'too_short' })`. The UI maps `validation.<code>` to an ar/en message with params (`{{min}}`, `{{max}}`, `{{field}}`).
- **The server always re-validates** and returns `422 VALIDATION_ERROR { details.fields: [{ path, code, params }] }`. The form maps them onto the matching inputs with `setError` automatically (shared helper `applyServerErrors(form, error)`).
- Business-rule errors (slot taken, period closed, balance exceeded) are shown as an **alert at the top of the form** plus the related field highlighted when there is one.

### 5.2 When to show errors (UX timing)
- **On blur** for the first validation of a field (not while the user is still typing).
- After the first error on a field, re-validate **on change**, so the error disappears as soon as it is fixed.
- **On submit:** validate everything, scroll to and focus the first invalid field, and show an error summary at the top ("3 fields need attention", each linking to its field).
- Async checks (e.g. "phone already registered", "file number exists") run debounced (400 ms) on blur, with an inline spinner. They show as a **warning with a link** ("A patient with this phone exists: open"), not a hard block, when duplicates are allowed.
- Required fields are marked with `*`, with a legend "* required" at the top of long forms. Optional fields can say "(optional)" instead when most fields are required.
- Inputs show **helper text** for the format before any error ("e.g. 0791234567").
- Character counters on limited text fields (notes, reasons) once 80% is used.
- The submit button is **never disabled just because the form is invalid**. The user clicks, and the errors are explained. It is disabled only while submitting.

### 5.3 Standard field rules (use these everywhere)
| Field type | Rule | Client UX | Error codes |
|---|---|---|---|
| Name (person part, clinic, item) | trim; 2–60 chars (clinic/item up to 120); letters (Arabic or Latin), spaces, `' - .`; no digits for person names; collapse double spaces | `dir=auto`, auto-trim on blur | `required`, `too_short`, `too_long`, `invalid_chars` |
| Free text (notes, description) | trim; max 2000 (notes 10 000); strip control chars | autosize textarea, counter | `too_long` |
| Phone | `libphonenumber-js`; default country JO (+962); stored as E.164; mobile required where the phone is used for WhatsApp/OTP (Jordan `07[789]xxxxxxx`) | country selector + formatted as you type; accepts Arabic-Indic digits and converts them | `required`, `invalid_phone`, `not_mobile` |
| Email | RFC-lite regex + lowercased + max 254 | `type=email`, `inputmode=email` | `invalid_email` |
| Password | ≥ 10 chars, ≥ 1 letter and 1 digit, not in the common list, not equal to the email/phone | strength meter + show/hide + rule checklist that ticks live | `weak_password`, `password_mismatch` |
| OTP | exactly 6 digits | 6 boxes, auto-advance, paste support, numeric keyboard | `invalid_code`, `code_expired` |
| National ID (Jordan) | 10 digits; check format per nationality; other nationalities: passport 5–20 alphanumeric | masked input | `invalid_national_id` |
| Date of birth | not in the future; age ≤ 120; for patients a guardian is required if age < 18 | date picker in the clinic locale + typing allowed (`DD/MM/YYYY`) | `date_in_future`, `invalid_date`, `guardian_required` |
| Date range | `from ≤ to`; max range per screen (e.g. calendar 42 days, reports 366) | range picker with presets (Today, This week, This month, Last month, This year) | `range_invalid`, `range_too_long` |
| Time | `HH:mm`, aligned to the slot granularity where relevant | time picker with step | `invalid_time`, `not_aligned` |
| Money | ≥ 0 (or > 0 where required); max 3 decimals for JOD; max 1 000 000; entered as decimal text, stored in minor units | `<MoneyInput>` with currency adornment, thousands separators, Arabic-Indic digits accepted | `invalid_amount`, `too_many_decimals`, `must_be_positive`, `exceeds_balance` |
| Percentage | 0–100, max 2 decimals | `%` adornment | `out_of_range` |
| Quantity | integer ≥ 1 (≤ 999) | stepper | `invalid_quantity` |
| Tooth number | FDI valid set (11–48, 51–85) | picked from the chart, never typed | `invalid_tooth` |
| Surfaces | allowed for the tooth (O only posterior, I only anterior) | surface toggles on the tooth | `invalid_surface` |
| Select / enum | must be one of the allowed values | searchable select for more than 7 options | `required`, `invalid_option` |
| Reference (patient, dentist, supplier…) | must exist, be active, and be in the tenant | async autocomplete with "create new" when permitted | `not_found`, `inactive` |
| File upload | allowed types (JPEG, PNG, WebP, PDF), max `MAX_UPLOAD_MB`, magic-byte check on the server | drag & drop zone, preview, progress bar, remove/replace | `file_type_not_allowed`, `file_too_large` |
| Colour | hex `#RRGGBB` | swatch picker | `invalid_color` |
| IBAN | IBAN checksum, JO format `JO\d{2}[A-Z]{4}\d{22}` | grouped display | `invalid_iban` |
| Tax number | digits, 8–15 | | `invalid_tax_number` |
| Slug (clinic URL) | `^[a-z0-9-]{3,40}$`, unique | live preview of the booking URL + availability check | `invalid_slug`, `slug_taken` |

### 5.4 Cross-field rules (examples to implement)
- `end > start` for appointments and shifts. Leave `endDate ≥ startDate`.
- Payment allocations sum ≤ payment amount. Each allocation ≤ that invoice's balance.
- Discount ≤ line amount. A discount above the threshold needs permission (a clear message saying who can approve).
- Journal entry: Σdebit = Σcredit (live totals bar turns green when balanced), at least 2 lines, no group accounts.
- Refund ≤ refundable amount.
- Password confirmation matches.
- Insurance policy `validTo ≥ validFrom`; coverage % with an annual max.

### 5.5 Normalisation (silent, before validation)
- Trim all strings; collapse internal whitespace in names.
- Convert Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) and Persian digits to Western digits in numeric, phone, ID and money inputs.
- Lowercase emails and slugs.
- Phone numbers to E.164.
- Remove the tatweel (ـ) from names for search (`searchName`); the display value keeps what the user typed.

### 5.6 Validation messages (i18n)
Files: `locales/{ar,en}/validation.json`. Messages are short, human and actionable. Examples:

| code | en | ar |
|---|---|---|
| required | {{field}} is required | {{field}} مطلوب |
| too_short | {{field}} must be at least {{min}} characters | يجب ألا يقل {{field}} عن {{min}} أحرف |
| too_long | {{field}} must be at most {{max}} characters | يجب ألا يزيد {{field}} عن {{max}} حرفًا |
| invalid_phone | Enter a valid phone number, e.g. 0791234567 | أدخل رقم هاتف صحيح، مثال: 0791234567 |
| not_mobile | This must be a mobile number | يجب أن يكون رقم هاتف محمول |
| invalid_email | Enter a valid email address | أدخل بريدًا إلكترونيًا صحيحًا |
| weak_password | Use at least 10 characters with letters and numbers | استخدم 10 أحرف على الأقل تتضمن حروفًا وأرقامًا |
| date_in_future | Date can't be in the future | لا يمكن أن يكون التاريخ في المستقبل |
| invalid_amount | Enter a valid amount | أدخل مبلغًا صحيحًا |
| too_many_decimals | Use up to {{max}} decimal places | استخدم {{max}} منازل عشرية كحد أقصى |
| exceeds_balance | Amount exceeds the remaining balance ({{balance}}) | المبلغ يتجاوز الرصيد المتبقي ({{balance}}) |
| file_too_large | File is larger than {{max}} MB | حجم الملف أكبر من {{max}} ميغابايت |
| file_type_not_allowed | Allowed types: {{types}} | الأنواع المسموحة: {{types}} |
| slot_taken (business) | This time was just booked by someone else. Pick another slot. | تم حجز هذا الوقت للتو. اختر وقتًا آخر. |

Field names in messages come from the same i18n label used by the input, so the message always matches what the user sees.

### 5.7 Tests for validation
- Each Zod schema has unit tests: valid examples, every error code, normalisation (Arabic digits, phone formats).
- API tests: invalid payloads return 422 with the correct `path` and `code`.
- Frontend tests: errors appear on blur and on submit, focus moves to the first invalid field, and server errors map onto fields.
- Translation completeness test: every `validation.*` and `errors.*` key exists in both `ar` and `en`, and every code the backend can return has a translation.

---

## 6. Key Screen Specs (UX)
| Screen | Must have |
|---|---|
| Login | Email/phone + password; show/hide; "remember this device"; language toggle on the page; clear lockout message with countdown; MFA step |
| Clinic onboarding wizard | Steps: clinic info → hours → chairs → dentists → procedures & prices (import from catalog with a bulk price editor) → done. Progress saved on each step. |
| Calendar | See `06_MODULE_APPOINTMENTS.md` §9. Today button, date jump, dentist/chair filters with avatars, legend, keyboard navigation |
| Quick book drawer | Patient typeahead → type → dentist (or any) → suggested slots (chips) → notes → confirm. Conflict message offers the next 3 free slots. |
| Today board | Columns with counts, drag between columns for status (with confirmation for complete/no-show), wait-time timers, patient alert icons |
| Patient form | Sections: Personal, Contact, Guardian (auto-shown if under 18), Emergency, Insurance, Preferences. Duplicate-phone warning. |
| Tooth chart | Toolbar (mode, layers, legend), click/keyboard per tooth, side panel, undo of the last entry, print |
| Invoice editor | Lines from procedures, a line-add typeahead, live totals from the preview endpoint, insurance split visible, discount with a reason, "Issue" with a confirmation explaining that the invoice becomes final |
| Payment dialog | Amount defaults to the balance, method tiles, allocation table auto-filled oldest-first and editable, a change calculator for cash |
| Role editor | See `04_ROLES_AND_PERMISSIONS.md` §7 |
| Payroll wizard | Period → review the staff list with warnings (missing attendance, no compensation) → calculate → per-payslip review → approve (with a summary) → mark paid |
| Logs | See `15_LOGGING_AND_MONITORING.md` §5 |
| Patient portal booking | 4 steps on mobile, large slot chips, a summary screen, add-to-calendar link |

---

## 7. Definition of Done (UI, per screen)
- [ ] Works and looks right in **Arabic RTL and English LTR**, light and dark, phone/tablet/desktop
- [ ] All states from §4 are implemented
- [ ] All inputs follow §5 (schema, timing, messages ar/en, normalisation, server-error mapping)
- [ ] Permissions: hidden/masked/read-only fields respected via `fieldKey` (see `04_ROLES_AND_PERMISSIONS.md` §4.5)
- [ ] Keyboard navigable; focus visible; labels and ARIA present
- [ ] Telemetry: page view + key actions + validation failures tracked (`15_LOGGING_AND_MONITORING.md` §3)
- [ ] No hard-coded strings, no inline colours
