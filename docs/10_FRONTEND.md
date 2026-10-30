# ElDental — Frontend

---

## 1. Stack
| Concern | Choice |
|---|---|
| Build | Vite 5, React 18, TypeScript 5 (`strict`) |
| UI | MUI v5 (+ `@mui/x-date-pickers`, `@mui/x-data-grid`), Emotion with `stylis-plugin-rtl`, `@iconify/react` or `lucide-react` |
| Routing | React Router 6.2x (data router `createBrowserRouter`), lazy routes |
| Server state | TanStack Query v5 (all API data; no API data in global stores) |
| Client state | Zustand: auth session (access token in memory, current clinic) and UI prefs only |
| Forms | react-hook-form + Zod (`@hookform/resolvers/zod`); Zod schemas mirror the backend DTOs |
| HTTP | axios instance with interceptors (see §4) |
| i18n | i18next + react-i18next + `i18next-browser-languagedetector`; `ar` default (RTL), `en` |
| Dates | dayjs (+ utc, timezone, localizedFormat, `ar` locale); always display in the clinic timezone |
| Calendar | Own `TimeGrid` component (resource day view + week view). FullCalendar v6 stays available for free views; its resource views are premium and are not used. |
| Charts | Recharts |
| Tables | MUI DataGrid (server-side pagination/sort/filter) |
| Realtime | socket.io-client |
| Notifications | notistack |
| PDF view | Open the server-generated PDFs in a new tab (no client-side PDF generation for financial docs) |
| Signature | `react-signature-canvas` |
| Tests | Vitest + Testing Library; Playwright e2e |
| Quality | ESLint (typescript-eslint, react-hooks, jsx-a11y), Prettier |

Fonts: **Tajawal** or **Cairo** for Arabic, **Inter** for English, loaded through Fontsource (self-hosted).

---

## 2. Folder Structure
```
frontend/src/
├── main.tsx
├── app/
│   ├── App.tsx                 # providers: Theme, Query, i18n, Snackbar, Auth bootstrap
│   ├── router.tsx              # all route trees
│   └── providers/
├── config/env.ts               # reads import.meta.env with zod
├── lib/
│   ├── api/axios.ts            # instance + interceptors
│   ├── api/queryClient.ts
│   ├── socket.ts
│   └── money.ts, dates.ts, phone.ts
├── shared/
│   ├── components/             # Page, PageHeader, DataTable, ConfirmDialog, MoneyText, DateText, StatusChip, EmptyState, FileUpload, SignaturePad, AutoDirText
│   ├── form/                   # RHF wrappers: RHFTextField, RHFSelect, RHFDate, RHFMoney, RHFPatientPicker, RHFStaffPicker …
│   ├── rbac/                   # permissions.ts (generated), usePermission, <Can>, <RequirePermission>
│   ├── hooks/
│   └── types/
├── layouts/
│   ├── AdminLayout/            # superadmin
│   ├── ClinicLayout/           # sidebar + topbar (clinic switcher, language, theme, notifications, user menu)
│   ├── PortalLayout/           # patient-facing, mobile-first
│   └── AuthLayout/
├── features/                   # one folder per module — mirrors backend modules
│   ├── auth/                   # login, select-clinic, forgot/reset, invitation accept, mfa
│   ├── admin/                  # clinics, plans, catalog, users, system-errors, tickets
│   ├── clinic-settings/
│   ├── staff/                  # staff list/profile, roles editor
│   ├── patients/
│   ├── scheduling/             # calendar, today board, availability picker, waitlist, recalls, schedules
│   ├── clinical/               # chart, treatment plans, notes, perio, rx, lab orders, imaging, consents
│   ├── billing/                # invoices, payments, cash session, insurance & claims
│   ├── accounting/             # accounts tree, journals, suppliers, bills, expenses, periods, reports
│   ├── hr/                     # shifts, attendance, leave, payroll, payslips
│   ├── inventory/
│   ├── reports/
│   ├── notifications/
│   └── portal/                 # patient portal pages
│       └── <feature>/
│           ├── api/            # query keys + hooks: usePatients(), useCreatePatient()…
│           ├── components/
│           ├── pages/
│           ├── schemas.ts      # zod form schemas
│           └── types.ts
├── locales/{ar,en}/{common,errors,<feature>}.json
└── theme/                      # palette, typography, components overrides, rtl
```
Rule: a feature imports from `shared/` and `lib/`, never from another feature's internals. If two features need the same thing, move it to `shared/`.

---

## 3. Routing & Guards
```
/                         → redirect based on session
/login, /forgot-password, /reset-password, /invite/:token      (GuestGuard)
/select-clinic                                                (AuthGuard)
/admin/*                  (AuthGuard + KindGuard('platform'))
/clinic/*                 (AuthGuard + KindGuard('staff') + ClinicGuard + SubscriptionGuard)
    /clinic/dashboard
    /clinic/calendar, /clinic/today, /clinic/waitlist, /clinic/recalls
    /clinic/patients, /clinic/patients/:id/(overview|chart|plans|notes|perio|imaging|documents|billing|history)
    /clinic/billing/(invoices|payments|cash|insurance|claims)
    /clinic/accounting/(accounts|journals|suppliers|bills|expenses|periods|reports/*)
    /clinic/hr/(staff|shifts|attendance|leave|payroll|my-payslips)
    /clinic/settings/(general|chairs|appointment-types|procedures|roles|integrations|taxes)
/portal/*                 (AuthGuard + KindGuard('patient')), plus public /book/:clinicSlug
```
- Each route declares `handle: { perm?: PermissionKey, title: i18nKey }`. `<RequirePermission>` reads it.
- The sidebar nav config is generated from the same route metadata (hidden if not permitted).
- `SubscriptionGuard`: if the clinic subscription is suspended, show a read-only banner and block mutations. This replaces Hakeemna's "Licence expired".

---

## 4. Auth on the client
- **Access token in memory** (Zustand, not localStorage). The refresh token is an httpOnly cookie set by the backend.
- On app load: `POST /auth/refresh` (with `withCredentials`). On success, store the token and fetch `/auth/me`. On failure, the user is a guest.
- Axios request interceptor: add `Authorization` and `X-Requested-With`.
- Axios response interceptor:
  - `401 TOKEN_EXPIRED` → single-flight refresh (queue concurrent requests), then retry once;
  - refresh fails → logout and redirect to `/login?next=`.
- The interceptor normalises errors to an `ApiError { code, message, details, status }`. `getErrorMessage(err, t)` translates `errors.<code>`.
- Multi-tab: a BroadcastChannel `auth` syncs logout and refreshed tokens.
- Clinic switcher: `POST /auth/select-clinic` → new token → `queryClient.clear()` → navigate to `/clinic/dashboard`.

## 5. Data fetching conventions
- Query keys come from factories: `patientKeys.list(params)`, `patientKeys.detail(id)`.
- Mutations invalidate precise keys. Calendar mutations do an optimistic update with rollback on `409`.
- Socket events → `queryClient.invalidateQueries` (e.g. `appointment:changed` invalidates the appointments range plus the today board).
- Lists use server-side pagination (DataGrid `paginationMode="server"`) with URL-synced query state (`useSearchParams`).

## 6. Theming & i18n
- `ThemeProvider` direction comes from the language (`ar` → `rtl`), with an RTL Emotion cache. Light/dark mode and a primary colour preset are stored in localStorage (UI prefs only).
- Every visible string goes through `t()`. Arabic is written properly (not machine-translated placeholders). Keys are namespaced per feature.
- User data is shown exactly as typed with `dir="auto"` (`<AutoDirText>`). System-seeded records use `useSeedName()(record)`, which returns `record.name ?? t("seed." + record.systemKey)`.
- Numbers and money: `Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 3 })` for JOD. Show Western digits by default; Arabic-Indic digits are a user preference.
- Dates: always formatted in `clinic.timezone`.

## 7. Key UI Components (spec)
| Component | Notes |
|---|---|
| `<ToothChart>` | SVG odontogram (see `07_MODULE_DENTAL_CLINICAL.md` §2), keyboard accessible |
| `<PerioChartGrid>` | Fast entry grid, auto-advance |
| `<TimeGrid>` | Resource/day columns, drag/drop, exception backgrounds, status colours |
| `<SlotPicker>` | Availability results grouped by day, dentist filter |
| `<PatientPicker>` | Async typeahead (`/patients/search`), "create quick patient" |
| `<PatientHeader>` | Name, file no., age, alerts banner, balance, quick actions (book, invoice, pay) |
| `<InvoiceEditor>` | Lines from procedures; insurance split preview; totals computed via the API preview endpoint (no client math for final totals) |
| `<PaymentDialog>` | Method, amount, allocations to open invoices, Idempotency-Key generated per dialog open |
| `<MoneyInput>` | Edits decimal strings, emits integer minor units |
| `<RoleEditor>` | Permission matrix grouped by module, with own/all toggles |
| `<SignaturePad>` | Canvas → PNG upload |
| `<StatusChip>` | Unified colours for appointment/invoice/plan/leave/payroll statuses |

## 8. Patient Portal
- Mobile-first, PWA (manifest + offline shell), large tap targets, Arabic-first.
- Pages:
  - home (next appointment);
  - book (clinic → dentist/any → type → slot → confirm);
  - my appointments (cancel within the window);
  - treatment plans (view and accept with signature);
  - invoices and payments (PDF);
  - family;
  - profile.

## 9. Quality bar
- No `any` (lint error). No API calls outside `features/*/api`. No hard-coded strings in JSX.
- Every form validates with Zod and shows server field errors mapped from `details.fields`.
- Loading, empty and error states on every list and page.
- Accessibility: labelled inputs, focus management in dialogs, colour contrast AA.
