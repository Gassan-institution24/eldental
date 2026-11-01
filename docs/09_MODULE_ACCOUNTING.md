# ElDental — Module: Billing & Double-Entry Accounting

> Hakeemna was invoice-centric. It had `Ledger_account_1/2` fields that were never used, and no general ledger.
> ElDental keeps a **real general ledger**. Every financial event posts a balanced, immutable journal entry automatically. Reports are built **from the ledger**, never from invoice tables.

---

## 1. Principles
1. **Money is integers** (minor units, JOD has 3 decimals: 1.500 JOD = 1500). Floats are never used. All arithmetic goes through `shared/money.ts` (add, sub, mulRate(basisPoints), allocate(total, weights) with remainder distribution, format(locale, currency)).
2. **Immutable ledger.**
   - Posted journal entries are never edited or deleted.
   - Corrections are made with a **reversal** entry (mirror lines) plus a new entry.
   - Issued invoices are immutable. Corrections use a credit note.
3. **Balanced always.** The service rejects any entry where Σdebit ≠ Σcredit. A DB-level invariant test runs in CI, and a nightly job checks the trial balance per clinic and alerts superadmins if it doesn't balance.
4. **Posting is automatic and transactional.** A business document (invoice, payment, …) and its journal entry are written in the **same Mongo transaction**. If posting fails, the document is not issued.
5. **Account mapping via system keys.** Posting rules reference `systemKey`s (e.g. `AR_PATIENTS`), never hard-coded account ids. Clinics can rename or renumber accounts but cannot delete system-mapped ones.
6. **Closed periods are sacred.** Posting into a `closed` period returns `423 PERIOD_CLOSED`. `soft_closed` allows posting only for users with `accounting.period.manage`.
7. **Single currency per clinic in v1** (the clinic currency). Multi-currency is out of scope; fields are kept for future use.

---

## 2. Default Chart of Accounts (seeded per clinic)

```
1000 Assets (group)
  1100 Cash & Banks (group)
    1110 Cash on Hand – Reception            [CASH_DEFAULT]
    1120 Petty Cash
    1130 Bank – Current Account              [BANK_DEFAULT]
    1140 Card Clearing (POS)                 [CARD_CLEARING]
    1150 Cheques Under Collection            [CHEQUES_UNDER_COLLECTION]
  1200 Receivables (group)
    1210 Accounts Receivable – Patients      [AR_PATIENTS]
    1220 Accounts Receivable – Insurance     [AR_INSURANCE]
    1230 Staff Advances                      [STAFF_ADVANCES]
  1300 Inventory – Dental Supplies           [INVENTORY]
  1400 Prepaid Expenses
  1500 Fixed Assets (group)
    1510 Dental Equipment
    1520 Furniture & Fit-out
    1530 Computers
    1590 Accumulated Depreciation
2000 Liabilities (group)
  2100 Accounts Payable – Suppliers          [AP_SUPPLIERS]
  2110 Accounts Payable – Dental Labs        [AP_LABS]
  2200 VAT / Sales Tax Payable               [VAT_OUTPUT]
  2210 VAT Recoverable (input)               [VAT_INPUT]
  2300 Salaries Payable                      [SALARIES_PAYABLE]
  2310 Social Security Payable               [SSC_PAYABLE]
  2320 Income Tax Withheld Payable           [INCOME_TAX_PAYABLE]
  2400 Patient Deposits / Credits            [PATIENT_CREDIT]
  2500 Commissions Payable                   [COMMISSIONS_PAYABLE]
3000 Equity (group)
  3100 Owner's Capital
  3200 Owner's Drawings
  3300 Retained Earnings                     [RETAINED_EARNINGS]
  3900 Opening Balance Equity                [OPENING_BALANCE]
4000 Revenue (group)
  4100 Treatment Revenue (group)            — child per procedure category (optional)
    4110 Diagnostic & Preventive
    4120 Restorative
    4130 Endodontics
    4140 Periodontics
    4150 Prosthodontics
    4160 Oral Surgery
    4170 Orthodontics
    4180 Implants
    4190 Cosmetic
    4199 Other Treatment Revenue             [REVENUE_DEFAULT]
  4200 Product Sales
  4800 Discounts Given (contra-revenue)      [DISCOUNTS]
  4900 Other Income
5000 Cost of Services (group)
  5100 Dental Lab Fees                       [LAB_COST]
  5200 Dental Supplies Consumed              [SUPPLIES_COST]
6000 Operating Expenses (group)
  6100 Salaries & Wages                      [SALARIES_EXPENSE]
  6110 Employer Social Security              [SSC_EXPENSE]
  6120 Dentist Commissions                   [COMMISSIONS_EXPENSE]
  6200 Rent
  6300 Utilities
  6400 Marketing
  6500 Maintenance & Repairs
  6600 Bank & Card Fees                      [BANK_FEES]
  6700 Depreciation
  6800 Bad Debts                             [BAD_DEBT]
  6900 Cash Over/Short                       [CASH_OVER_SHORT]
  6990 Miscellaneous
```

- Seeded from `backend/src/modules/accounting/seed/chartOfAccounts.jo.ts` (names come from i18n keys `seed.accounts.<systemKey>`; the clinic can rename them).
- Revenue mapping: `clinicProcedures.category` → revenue account (configurable table `revenueMapping`); fallback `REVENUE_DEFAULT`.

---

## 3. Billing Documents

### 3.1 Invoice flow
```
draft ──issue──► issued ──payments──► partially_paid ──► paid
  │                 └──void (only if no payments; same period)──► void (posts reversal)
  └──delete (drafts only)
issued/paid ──credit-note──► new credit_note document (negative), linked by originalInvoiceId
```
- **Draft:**
  - built manually or automatically from `appointment.completed` / `procedure.completed`;
  - editable;
  - **no number, no journal**.
- **Doctors:**
  - the header doctor (`dentistId`) and every manually chosen line doctor must be an **active dentist or hygienist of the clinic** (`422 not_dentist`; other clinics' staff are invisible to the tenant-scoped check);
  - a draft may be saved without a header doctor, but it **cannot be issued** (`409 DENTIST_REQUIRED`); manual lines without a doctor take the header doctor at issue;
  - a line from a performed procedure keeps the procedure's doctor: sending another one returns `409 PROCEDURE_DENTIST_LOCKED`;
  - **deactivated doctors** keep all history: their performed procedures, invoice lines, ledger dimensions and collections are never changed. A draft whose header doctor has left can't be issued until billing chooses an active responsible doctor; its procedure lines stay with the departed doctor;
  - **wrong performer:** void the performed procedure with a reason and record it again under the right doctor (07 §4). The voided record stays (status `voided`, reason, audit `create` + `status_change`), its chart entries are voided, not deleted; it leaves the draft so the patient is charged once. An invoiced procedure needs a credit note first (`PROCEDURE_INVOICED`);
  - `GET /billing/dentists` returns id + name only, for the picker (no staff-directory access needed).
- **Issue** (`POST /invoices/:id/issue`, idempotent):
  1. Validate lines and recompute totals server-side (the client's totals are ignored).
  2. Assign the sequential number `INV-{YYYY}-{000001}` (gapless per fiscal year, via the counter inside the transaction).
  3. Post the journal (§4.1); set `issued`; update the patient balance cache.
  4. After commit: queue the JoFotara job if enabled; emit `invoice.issued`.
- **Insurance split:**
  - if the patient has an active policy and the procedures are covered, issue as **one invoice** with each line split into a `patientShare` and an `insuranceShare`;
  - post AR to `AR_PATIENTS` and `AR_INSURANCE` separately;
  - the insurance share is later grouped into an `insuranceClaim`.
- **Discounts:** line-level and invoice-level (spread across lines). Above `clinic.settings.maxDiscountPercentWithoutApproval` the caller needs `billing.invoice.discount`.
- **Installment plans:** a schedule of `{dueDate, amount}`. Reminders are sent before each due date. AR aging uses installment due dates.

### 3.2 Payments
- One payment can settle several invoices (`allocations`). An over-payment goes to `PATIENT_CREDIT` (unallocated) and can be applied to future invoices: `POST /payments/:id/allocate`.
- Methods map to deposit accounts:
  - cash → the current open **cash session** account;
  - card → `CARD_CLEARING`;
  - transfer → bank;
  - cheque → `CHEQUES_UNDER_COLLECTION`. When the cheque clears, a cheque-cleared journal moves the amount to the bank. A bounced cheque reverses the payment.
- **Refunds:** partial or full, with a reason, posting a reversal of the cash side. If the payment was allocated, the invoice balance reopens or a credit note is required first (business rule: refund the unallocated credit first).
- **Receipts:** a numbered receipt PDF (`RCPT-{YYYY}-{000001}`) for each payment.
- **Idempotency-Key** is required on `POST /payments` from the UI.

### 3.3 Cash sessions (daily cash close)
- Reception opens a session with an opening float, and cash payments post to that session's cash account.
- Closing:
  - enter the counted cash;
  - the system computes the expected amount from the ledger;
  - any difference posts to `CASH_OVER_SHORT`;
  - a summary PDF is produced (payments by method, refunds, expected vs counted).
- Only one open session per cash account.

### 3.4 Insurance claims
`draft → submitted → approved | partially_approved | rejected → paid`

- The claim groups insurance-share lines for one insurer and period.
- Approved < claimed: the difference is either written off (Dr `DISCOUNTS` or `BAD_DEBT` / Cr `AR_INSURANCE`) or re-billed to the patient (Dr `AR_PATIENTS` / Cr `AR_INSURANCE`), chosen per claim.
- Insurer payment is a `payment` with `payerType: insurance`, allocated to the claim's invoices.

### 3.5 Suppliers, bills, expenses
- Supplier bill:
  - `draft → posted → partially_paid → paid` (or `void` via reversal);
  - lines map to expense or inventory accounts;
  - lab orders create bill drafts automatically.
- Quick expense: a one-step expense with a receipt photo and the account it was paid from. It needs `accounting.expense.approve` if over the threshold.
- Supplier payment: allocations to bills.

---

## 4. Posting Rules (journal templates)

All entries carry `source`, `sourceId`, `date` (document date) and dimensions on the lines (`patientId`, `dentistId`, `supplierId`, `staffId`) for subledgers and reports.

### 4.1 Invoice issued (patient only, with VAT)
| Account | Dr | Cr |
|---|---|---|
| AR_PATIENTS (patientId) | total | |
| DISCOUNTS | discountTotal | |
| Revenue per line category (dentistId) | | gross line amounts |
| VAT_OUTPUT | | taxTotal |

> Discounts are shown gross (contra-revenue) for analysis. Setting `postDiscountsNet: true` posts revenue net instead.

### 4.2 Invoice with insurance split
Same as 4.1, except AR is split: Dr `AR_PATIENTS` (patient share) + Dr `AR_INSURANCE` (insurer share, `insuranceCompanyId` dimension).

### 4.3 Credit note
The mirror of the original lines (Cr AR, Dr Revenue, Dr VAT), for the credited amount.

### 4.4 Payment received
| Account | Dr | Cr |
|---|---|---|
| Deposit account (cash session / card clearing / bank / cheques) | amount | |
| AR_PATIENTS or AR_INSURANCE (per allocation) | | allocated |
| PATIENT_CREDIT | | unallocated |

Applying credit later: Dr `PATIENT_CREDIT` / Cr `AR_PATIENTS`.

### 4.5 Refund
Dr `AR_PATIENTS` or `PATIENT_CREDIT` / Cr deposit account.

### 4.6 Supplier bill / expense / supplier payment
- Bill: Dr expense/inventory lines + Dr `VAT_INPUT` / Cr `AP_SUPPLIERS` or `AP_LABS`.
- Quick expense: Dr expense (+ `VAT_INPUT`) / Cr cash/bank.
- Supplier payment: Dr `AP_*` / Cr bank/cash.

### 4.7 Payroll approved
| Account | Dr | Cr |
|---|---|---|
| SALARIES_EXPENSE (staffId dimension per line or summarised) | gross earnings | |
| COMMISSIONS_EXPENSE | commissions | |
| SSC_EXPENSE | employer SSC | |
| SSC_PAYABLE | | employee + employer SSC |
| INCOME_TAX_PAYABLE | | tax withheld |
| STAFF_ADVANCES | | advance recoveries |
| SALARIES_PAYABLE | | net pay |

Payroll paid: Dr `SALARIES_PAYABLE` / Cr bank or cash.

### 4.8 Cash over/short
- Short: Dr `CASH_OVER_SHORT` / Cr cash.
- Over: the reverse.

### 4.9 Opening balances
A one-time `opening` entry per clinic, balanced against `OPENING_BALANCE`. Includes an import wizard for patient balances (creates opening AR per patient).

### 4.10 Year-end close
Close all revenue and expense accounts to `RETAINED_EARNINGS` (`closing` entry), lock all periods of the year, and open the next fiscal year.

Implementation: `accounting/posting/postingRules.ts` exports one pure builder per event, `(doc, accountMap) → JournalLine[]`, with unit tests asserting the balance and the expected lines. `journalService.post(entryDraft, session)` validates and persists.

---

## 5. Manual Journals
- Created as `draft` (`accounting.journal.create`), posted by `accounting.journal.post` (four-eyes optional).
- Attachments are allowed. Group accounts and system-only accounts (AR/AP control accounts) are blocked from manual lines unless the setting `allowManualControlAccounts` is enabled.

## 6. Fiscal Periods
- A fiscal year is created on clinic setup, using `fiscalYearStartMonth` (default January). There are 12 monthly periods.
- **Soft close** blocks normal users. **Close** blocks everyone. **Reopen** needs `accounting.period.manage` and a reason, and is audited.

## 7. JoFotara (Jordan National E-Invoicing)
- Ported from Hakeemna `controller/companies/invoicing/invoicing.controller.js`, which built UBL 2.1 XML and posted to `https://backend.jofotara.gov.jo/core/invoices/`. It is rewritten as a typed service: `einvoice/jofotara.builder.ts` (pure XML builder) + `jofotara.client.ts` (HTTP with retry) + a BullMQ `einvoice` worker.
- Credentials are per clinic and encrypted (`clinic.integrations.jofotara`).
- Invoice types:
  - cash invoice 011 vs receivable 021 (Hakeemna sent receivable invoices as 021);
  - credit notes use the return type, referencing the original UUID.
- The worker sets `invoice.einvoice.status`, stores the QR returned, and retries with backoff. Permanent errors are surfaced in the UI (`/einvoices` list, resubmit).
- The printed invoice shows the JoFotara QR when accepted.

## 8. Reports (all from the ledger unless noted)
| Report | Notes |
|---|---|
| Trial balance | Per period / as-of date; debit, credit, balance per account; must balance |
| Profit & Loss | Range; comparison to the previous period; by revenue category; optional by dentist (line dimension) |
| Balance sheet | As-of date; current-year earnings computed |
| Cash flow | Indirect method (v1: direct from cash/bank account movements) |
| General ledger | Account + range, with running balance and drill-down to the source document |
| AR aging | Patients and insurers: 0–30 / 31–60 / 61–90 / 90+ by due date (installments respected) |
| AP aging | Suppliers |
| Patient statement | Opening balance, invoices, payments, credits, closing (PDF, sendable) |
| VAT return | Output vs input VAT for the period |
| Daily cash | Cash sessions summary |
| Dentist production / collection | Production from performed procedures (by performer); collection from money applied to invoices, split by doctor (§8.1). Own scope = the caller's row only |
| Treatment plan conversion | Presented vs accepted value (clinical + billing) |

Own scope: AR aging, patient statement, the patient billing summary and the dashboard receivables follow `billing.invoice.read` = own — only invoices that include the doctor's work, with **their share** of open balances; the own-scope statement is built from those invoices only (not from the patient's whole ledger). With `accounting.report.read` or `billing.invoice.read` = all (owner, manager, accountant, reception) they are clinic-wide.

### 8.1 Doctor attribution of collections
- **Weights.** For each invoice, a doctor's weight is the sum of `lineTotal` of their lines (after line and spread invoice discounts, tax included). A line without a doctor counts for the header doctor, else "unassigned".
- **What is split.** Every amount applied to the invoice: each payment allocation (positive) and each refund taken back from it (negative). Unallocated credit is not attributed until it is applied.
- **When.** An allocation counts on the payment date, or on the day it was applied when that was later (advance payment allocated afterwards). A refund counts on the refund date (`payments.refunds[].invoices`). Refunds recorded before that field existed are already netted into the allocation.
- **Rounding.** Largest-remainder split in integer minor units (`shared/money.allocate`): the doctors' parts always add up to the amount exactly; ties go to the earlier line order.
- **Write-offs** (insurance shortfall with `write_off`): the amount taken from each invoice is split by each doctor's **outstanding share** of that invoice at that moment (its balance due split by the weights), largest remainder. The claim journal's DISCOUNTS debit is posted **per doctor** (dentist dimension) — same total, one entry, so the ledger carries the attribution and nothing is duplicated. The production report's "Written off" column reads those ledger lines. A `rebill` moves the amount to the patient and isn't a write-off.
- **Credit notes** scale every line by the same factor, so weights don't change; they reduce what is owed, not what was collected. **Voided** invoices have no payments by rule, so they collect nothing. Payment **methods** don't matter: cash, card, cheque, transfer and insurer payments are all allocations.
- **Ledger.** Revenue is already recognised per line doctor (`lines.dentistId` dimension on revenue/discount lines, §4.1). Attribution is a report over payments; it posts nothing, so nothing is recognised twice. Σ doctors' collections = Σ allocations − Σ refunds from invoices = cash kept for invoices (test: `test/doctorBilling.test.ts`).
- Used by: the production report, dashboard receivables (share of open balances) and the collection-basis commission (08 §5).

Exports: JSON for the UI, PDF and XLSX via report jobs for large ranges.

> **v1 printing:** invoices, receipts, statements and every report render as print-ready A4 pages in the browser (Print / Save as PDF), which keeps Arabic text correct. Server-side PDF/XLSX jobs for e-mail attachments and very large ranges come later.

## 9. Tests (must exist)
- Every posting rule builder gives balanced output, for many fixture cases.
- An end-to-end ledger scenario: issue → partial pay → pay rest → credit note → refund. The trial balance stays balanced and AR is zero at the end.
- Money helpers: rounding and `allocate` (sum preserved).
- Period closed → 423; reversal of a reversal is not allowed; double issue (same Idempotency-Key) → single entry.
- Concurrency: two simultaneous issues of the same draft give one number and one journal.
