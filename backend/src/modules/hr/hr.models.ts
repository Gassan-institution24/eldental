import { Schema, model, type InferSchemaType } from 'mongoose';
import { applyBase } from '@/core/db/plugins';
import { tenantField } from '@/core/tenancy/tenantPlugin';

const ref = (name: string) => ({ type: Schema.Types.ObjectId, ref: name });

/* ---------- shifts (08 §2) ---------- */

const shiftSchema = new Schema(
  {
    clinicId: tenantField,
    name: { type: String, required: true },
    searchName: String,
    weekly: { type: [{ weekday: Number, start: String, end: String, breakMinutes: { type: Number, default: 0 }, _id: false }], default: [] },
    graceMinutes: { type: Number, default: 10 },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'shifts' },
);
applyBase(shiftSchema);
export type Shift = InferSchemaType<typeof shiftSchema>;
export const ShiftModel = model('Shift', shiftSchema);

/* ---------- attendance (08 §3) ---------- */

const punch = { at: Date, method: { type: String, enum: ['web', 'qr', 'manual'] }, geo: { lat: Number, lng: Number } };
const attendanceSchema = new Schema(
  {
    clinicId: tenantField,
    staffId: { ...ref('Staff'), required: true },
    date: { type: String, required: true },
    checkIn: punch,
    checkOut: punch,
    scheduledStart: Date,
    scheduledEnd: Date,
    lateMinutes: { type: Number, default: 0 },
    earlyLeaveMinutes: { type: Number, default: 0 },
    overtimeMinutes: { type: Number, default: 0 },
    overtimeApproved: { type: Boolean, default: false },
    workedMinutes: { type: Number, default: 0 },
    status: { type: String, enum: ['present', 'absent', 'on_leave', 'holiday', 'weekend'], default: 'present' },
    leaveRequestId: ref('LeaveRequest'),
    adjustedBy: Schema.Types.ObjectId,
    adjustmentReason: String,
    payrollRunId: ref('PayrollRun'),
  },
  { timestamps: true, collection: 'attendance', optimisticConcurrency: true },
);
applyBase(attendanceSchema);
attendanceSchema.index({ clinicId: 1, staffId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ clinicId: 1, date: 1 });
export type Attendance = InferSchemaType<typeof attendanceSchema>;
export const AttendanceModel = model('Attendance', attendanceSchema);

/* ---------- leave (08 §4) ---------- */

const leaveTypeSchema = new Schema(
  {
    clinicId: tenantField,
    code: { type: String, required: true },
    name: { type: String, default: null },
    systemKey: String,
    searchName: String,
    paid: { type: Boolean, default: true },
    annualEntitlementDays: { type: Number, default: 0 },
    accrual: { type: String, enum: ['yearly', 'monthly'], default: 'yearly' },
    carryOverMaxDays: { type: Number, default: 0 },
    requiresAttachment: { type: Boolean, default: false },
    /** Extra days after N years of service (e.g. annual 21 after 5 years) — a seed default, editable. */
    seniorityRule: { afterYears: Number, days: Number },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'leaveTypes' },
);
applyBase(leaveTypeSchema);
leaveTypeSchema.index({ clinicId: 1, code: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
export const LeaveTypeModel = model('LeaveType', leaveTypeSchema);

const leaveBalanceSchema = new Schema(
  {
    clinicId: tenantField,
    staffId: { ...ref('Staff'), required: true },
    leaveTypeId: { ...ref('LeaveType'), required: true },
    year: { type: Number, required: true },
    entitled: { type: Number, default: 0 },
    carriedOver: { type: Number, default: 0 },
    taken: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'leaveBalances' },
);
applyBase(leaveBalanceSchema);
leaveBalanceSchema.index({ clinicId: 1, staffId: 1, leaveTypeId: 1, year: 1 }, { unique: true });
export const LeaveBalanceModel = model('LeaveBalance', leaveBalanceSchema);

const leaveRequestSchema = new Schema(
  {
    clinicId: tenantField,
    staffId: { ...ref('Staff'), required: true },
    leaveTypeId: { ...ref('LeaveType'), required: true },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    halfDay: { type: Boolean, default: false },
    days: { type: Number, required: true },
    reason: { type: String, default: '' },
    attachmentFileId: ref('FileAsset'),
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending' },
    decision: { byStaffId: Schema.Types.ObjectId, byUserId: Schema.Types.ObjectId, at: Date, comment: String },
    scheduleExceptionId: ref('ScheduleException'),
  },
  { timestamps: true, collection: 'leaveRequests', optimisticConcurrency: true },
);
applyBase(leaveRequestSchema);
leaveRequestSchema.index({ clinicId: 1, staffId: 1, startDate: 1 });
leaveRequestSchema.index({ clinicId: 1, status: 1 });
export const LeaveRequestModel = model('LeaveRequest', leaveRequestSchema);

/* ---------- compensation & payroll (08 §5–6) ---------- */

const componentSchema = new Schema(
  {
    clinicId: tenantField,
    name: { type: String, required: true },
    searchName: String,
    kind: { type: String, enum: ['earning', 'deduction'], required: true },
    calc: { type: String, enum: ['fixed', 'percent_of_basic', 'per_hour'], default: 'fixed' },
    taxable: { type: Boolean, default: true },
    subjectToSocialSecurity: { type: Boolean, default: false },
    accountId: ref('Account'),
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'salaryComponents' },
);
applyBase(componentSchema);
export const SalaryComponentModel = model('SalaryComponent', componentSchema);

const runSchema = new Schema(
  {
    clinicId: tenantField,
    year: { type: Number, required: true },
    month: { type: Number, required: true },
    status: { type: String, enum: ['draft', 'calculated', 'approved', 'paid', 'cancelled'], default: 'draft' },
    totals: { gross: { type: Number, default: 0 }, deductions: { type: Number, default: 0 }, employerContributions: { type: Number, default: 0 }, net: { type: Number, default: 0 } },
    oneOffLines: { type: [{ staffId: Schema.Types.ObjectId, kind: { type: String, enum: ['earning', 'deduction'] }, name: String, amount: Number, reason: String }], default: [] },
    calculatedBy: Schema.Types.ObjectId,
    calculatedAt: Date,
    approvedBy: Schema.Types.ObjectId,
    approvedAt: Date,
    paidAt: Date,
    paidFromAccountId: ref('Account'),
    journalEntryId: ref('JournalEntry'),
    paymentJournalEntryId: ref('JournalEntry'),
  },
  { timestamps: true, collection: 'payrollRuns', optimisticConcurrency: true },
);
applyBase(runSchema);
runSchema.index({ clinicId: 1, year: 1, month: 1 }, { unique: true, partialFilterExpression: { status: { $ne: 'cancelled' } } });
export const PayrollRunModel = model('PayrollRun', runSchema);

const payslipLine = { name: String, componentId: Schema.Types.ObjectId, amount: Number, _id: false };
const payslipSchema = new Schema(
  {
    clinicId: tenantField,
    payrollRunId: { ...ref('PayrollRun'), required: true },
    staffId: { ...ref('Staff'), required: true },
    year: Number,
    month: Number,
    workedDays: Number,
    daysInMonth: Number,
    basic: { type: Number, default: 0 },
    earnings: { type: [payslipLine], default: [] },
    deductions: { type: [payslipLine], default: [] },
    overtime: { minutes: { type: Number, default: 0 }, amount: { type: Number, default: 0 } },
    absenceDeduction: { type: Number, default: 0 },
    absentDays: { type: Number, default: 0 },
    unpaidLeaveDeduction: { type: Number, default: 0 },
    unpaidLeaveDays: { type: Number, default: 0 },
    commission: { basis: String, base: Number, percent: Number, amount: { type: Number, default: 0 }, sourceIds: { type: [Schema.Types.ObjectId], default: [] } },
    socialSecurity: { base: Number, employee: { type: Number, default: 0 }, employer: { type: Number, default: 0 } },
    incomeTax: { type: Number, default: 0 },
    advances: { type: Number, default: 0 },
    gross: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    net: { type: Number, default: 0 },
    status: { type: String, enum: ['draft', 'final'], default: 'draft' },
    acknowledgedAt: Date,
  },
  { timestamps: true, collection: 'payslips' },
);
applyBase(payslipSchema);
payslipSchema.index({ clinicId: 1, payrollRunId: 1, staffId: 1 }, { unique: true });
payslipSchema.index({ clinicId: 1, staffId: 1, year: -1, month: -1 });
export const PayslipModel = model('Payslip', payslipSchema);
