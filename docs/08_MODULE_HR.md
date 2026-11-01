# ElDental — Module: HR & Payroll

> Replaces Hakeemna's engagement-based HR. In Hakeemna:
> - salary math was done in the frontend;
> - leave was stored as attendance rows with no approval;
> - monthly reports were only totals.
>
> In ElDental, **all calculations are server-side**, leave has a workflow, and payroll posts to the ledger.

---

## 1. Staff Lifecycle
1. **Invite.** HR/Owner creates a `staff` document with name, phone/email, staffType, roles and compensation. If the user doesn't exist yet, a `users` document is created with `mustChangePassword`, and an invite (email/WhatsApp) is sent with a one-time token (`/auth/invitations/accept`). If the user already exists (works at another clinic), they are only linked.
2. **Active.** The staff member appears in schedules and can log in to this clinic.
3. **Deactivate / terminate.**
   - `status: inactive|terminated` with `employment.endDate`; their sessions for this clinic are revoked.
   - Future appointments for a dentist being deactivated must be reassigned or cancelled first. The API returns `409 STAFF_HAS_FUTURE_APPOINTMENTS` with a list.
4. **Documents.** License, contract, ID and certificates are stored as `fileAssets` with `ownerType: staff`. A daily job warns 30 days before `licenseExpiry`.

## 2. Shifts
- A shift is a weekly template (`start`, `end` and `breakMinutes` per weekday) plus `graceMinutes`.
- Each staff member has a default `shiftId`. Dentists can also use their `dentistSchedules` as their attendance expectation (setting `attendanceSource: shift|dentistSchedule`).

## 3. Attendance
- **Check-in/out:**
  - web button, QR code at reception (a rotating signed QR, replacing Hakeemna's QR cron), or a manual entry by HR;
  - optional geolocation check (clinic location + radius setting).
- **Server computes** (in the clinic TZ):
  - `scheduledStart/End` from the shift or schedule;
  - `lateMinutes = max(0, checkIn − scheduledStart − grace)`;
  - `earlyLeaveMinutes`;
  - `overtimeMinutes = max(0, worked − scheduled)`, counted only if `overtimeRequiresApproval` is false or it has been approved.
- A **nightly job** (per clinic TZ) creates `absent` rows for scheduled staff without a check-in, and `on_leave` or `holiday` rows from approved leave and holidays.
- **Adjustments:** HR edits with a mandatory reason, which is audited. Rows linked to a finalised payroll run are locked.
- **Reports:** monthly attendance sheet per staff, late summary, overtime summary.

## 4. Leave
- **Leave types:** code, paid or unpaid, annual entitlement, accrual method, carry-over cap, attachment required (e.g. sick leave > 1 day).
  - Seeded for Jordan: annual 14 days (21 after 5 years of service, a configurable rule), sick 14 days paid, maternity 70 days, hajj (once), unpaid.
  - Values are configurable per clinic. The docs and code must not hard-code legal values; they are seed defaults.
- **Balances:** `leaveBalances` per staff, type and year. A yearly job creates them (with carry-over); a monthly job accrues when `accrual: monthly`.
- **Request flow:**
  ```
  pending ──approve──► approved ──(start date passes)──► taken (derived)
     │  └──reject──► rejected
     └──cancel (by requester, or HR before start)──► cancelled
  ```
  - `days` is computed server-side and excludes weekends and holidays.
  - It is validated against the remaining balance (`pending` is reserved); unpaid leave skips the check. Overlapping requests are rejected.
  - On **approve** (transaction):
    - update the balance;
    - for dentists, create `scheduleExceptions(type: time_off, leaveRequestId)`;
    - if the dentist has booked appointments in the range, the approver must confirm. The response lists the conflicts, and a reschedule task is created for reception.
  - Notifications go to the requester and the approvers.
- **Approvers:** anyone with `hr.leave.approve`. Optionally a `managerStaffId` on staff for a two-step flow (later).

## 5. Compensation
- Kept on `staff.compensation` and guarded by `hr.compensation.*`.
- **Salary components** (`salaryComponents`): each is an earning or deduction, `fixed` / `percent_of_basic` / `per_hour`, taxable, subject to social security, and mapped to a GL account.
- **Dentist commission:** basis `production` (performed procedures in the period) or `collection` (their attributed share of money applied to invoices in the period, net of refunds — 09 §8.1), with a percentage per procedure category and an optional lab-cost deduction (`netOfLabCost: true`).
- **Social security (Jordan SSC):** employee and employer rates are configured per clinic (defaults are seeded, editable). Applied to the components marked `subjectToSocialSecurity`.
- **Income tax:** pluggable `IncomeTaxCalculator` interface. The default implementation has a configurable bracket table per clinic. Ships with a "none" option so the clinic chooses.

## 6. Payroll Run

```
draft ──calculate──► calculated ──approve──► approved ──mark-paid──► paid
  └─────────────── cancel (only before approve) ──────────────► cancelled
```

1. **Create** `POST /payroll-runs { year, month }`: one run per clinic per period. It includes active staff with compensation.
2. **Calculate** (idempotent; can be re-run while `draft`/`calculated`). For each staff member, it creates or replaces a payslip:
   - `basic` (pro-rated for hires or terminations within the month, by calendar days);
   - fixed earnings and deductions from compensation;
   - overtime = approved overtime minutes × hourly rate × multiplier (setting, default 1.25);
   - absence deduction = absent days × daily rate; unpaid leave deduction the same way;
   - commission (see §5), with the list of procedure/payment ids for transparency;
   - SSC employee and employer;
   - income tax;
   - `gross`, `totalDeductions`, `net`.

   All money is in integer minor units, with banker's rounding at line level. The calculation must be a **pure function** `calculatePayslip(input) → payslip` with unit tests.
3. **Review.** HR can add one-off lines (bonus, advance recovery) with a reason, then recalculate totals.
4. **Approve** (`hr.payroll.approve`; cannot be the same user who calculated it, if the setting `fourEyes` is on):
   - locks the attendance rows and payslips;
   - posts the **payroll journal** (see `09_MODULE_ACCOUNTING.md` §4.7);
   - notifies staff (payslip available).
5. **Mark paid.** Choose the payment account (bank/cash). Posts the payment journal (Dr Salaries Payable / Cr Bank).
6. **Payslip acknowledgement.** Staff view and acknowledge their payslip in the app (`acknowledgedAt`). This replaces Hakeemna's owner-only signature flow.

Payslip PDF: in the staff member's language (ar or en), clinic header, earnings/deductions table, net in words (Arabic and English).

## 7. Permissions recap
See `04_ROLES_AND_PERMISSIONS.md`:
- `hr.shift.manage`
- `hr.attendance.*`
- `hr.leave.request` / `.read` / `.approve`
- `hr.leaveType.manage`
- `hr.compensation.*`
- `hr.payroll.read` / `.run` / `.approve`

Staff always see their own attendance, leave and payslips (`own`).

## 8. Tests (must exist)
- `calculatePayslip` with tables of cases: pro-rata, overtime, unpaid leave, commission on production vs collection, SSC caps, rounding.
- Leave day counting across weekends and holidays; balance reservation; overlap rejection.
- Approve leave creates schedule exceptions and blocks availability.
- Payroll approve posts a balanced journal; re-approve is impossible; attendance is locked.
