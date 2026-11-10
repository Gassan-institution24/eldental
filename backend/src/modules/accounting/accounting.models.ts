import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { applyBase } from '@/core/db/plugins';
import { tenantField } from '@/core/tenancy/tenantPlugin';

const ref = (name: string) => ({ type: Schema.Types.ObjectId, ref: name });

/* ---------- chart of accounts (03 §8) ---------- */

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

const accountSchema = new Schema(
  {
    clinicId: tenantField,
    code: { type: String, required: true },
    name: { type: String, default: null },
    systemKey: String,
    searchName: String,
    type: { type: String, enum: ACCOUNT_TYPES, required: true },
    subtype: { type: String, default: '' },
    parentId: ref('Account'),
    isGroup: { type: Boolean, default: false },
    isSystem: { type: Boolean, default: false },
    normalBalance: { type: String, enum: ['debit', 'credit'], required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'accounts' },
);
applyBase(accountSchema);
accountSchema.index({ clinicId: 1, code: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
accountSchema.index({ clinicId: 1, systemKey: 1 }, { unique: true, partialFilterExpression: { systemKey: { $type: 'string' } } });
export type Account = InferSchemaType<typeof accountSchema>;
export const AccountModel = model('Account', accountSchema);

/* ---------- fiscal years & periods ---------- */

const fiscalYearSchema = new Schema(
  {
    clinicId: tenantField,
    year: { type: Number, required: true },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    closingEntryId: ref('JournalEntry'),
  },
  { timestamps: true, collection: 'fiscalYears' },
);
applyBase(fiscalYearSchema);
fiscalYearSchema.index({ clinicId: 1, year: 1 }, { unique: true });
export const FiscalYearModel = model('FiscalYear', fiscalYearSchema);

const fiscalPeriodSchema = new Schema(
  {
    clinicId: tenantField,
    fiscalYearId: { ...ref('FiscalYear'), required: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    status: { type: String, enum: ['open', 'soft_closed', 'closed'], default: 'open' },
    history: { type: [{ status: String, at: Date, byUserId: Schema.Types.ObjectId, reason: String, _id: false }], default: [] },
  },
  { timestamps: true, collection: 'fiscalPeriods' },
);
applyBase(fiscalPeriodSchema);
fiscalPeriodSchema.index({ clinicId: 1, startDate: 1 }, { unique: true });
export const FiscalPeriodModel = model('FiscalPeriod', fiscalPeriodSchema);

/* ---------- journal (immutable once posted) ---------- */

export const JOURNAL_SOURCES = ['invoice', 'credit_note', 'payment', 'refund', 'credit_application', 'cheque', 'expense', 'supplier_bill', 'supplier_payment', 'payroll', 'payroll_payment', 'cash_session', 'claim', 'manual', 'opening', 'closing', 'reversal', 'void', 'inventory'] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

const lineSchema = new Schema(
  {
    accountId: { ...ref('Account'), required: true },
    debit: { type: Number, default: 0 },
    credit: { type: Number, default: 0 },
    patientId: ref('Patient'),
    supplierId: ref('Supplier'),
    staffId: ref('Staff'),
    dentistId: ref('Staff'),
    insuranceCompanyId: ref('InsuranceCompany'),
    description: { type: String, default: '' },
  },
  { _id: false },
);

const journalSchema = new Schema(
  {
    clinicId: tenantField,
    number: String,
    date: { type: String, required: true },
    fiscalPeriodId: ref('FiscalPeriod'),
    source: { type: String, enum: JOURNAL_SOURCES, required: true },
    sourceId: Schema.Types.ObjectId,
    memo: { type: String, default: '' },
    lines: { type: [lineSchema], default: [] },
    total: { type: Number, default: 0 },
    status: { type: String, enum: ['draft', 'posted', 'reversed'], default: 'draft' },
    reversalOfId: ref('JournalEntry'),
    reversedById: ref('JournalEntry'),
    postedAt: Date,
    postedBy: Schema.Types.ObjectId,
    createdByUserId: Schema.Types.ObjectId,
    attachments: { type: [Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true, collection: 'journalEntries' },
);
applyBase(journalSchema);
journalSchema.index({ clinicId: 1, date: 1 });
journalSchema.index({ clinicId: 1, source: 1, sourceId: 1 });
journalSchema.index({ clinicId: 1, 'lines.accountId': 1, date: 1 });
journalSchema.index({ clinicId: 1, number: 1 }, { unique: true, partialFilterExpression: { number: { $type: 'string' } } });
export type JournalEntry = InferSchemaType<typeof journalSchema>;
export type JournalLine = { accountId: string; debit: number; credit: number; patientId?: string; supplierId?: string; staffId?: string; dentistId?: string; insuranceCompanyId?: string; description?: string };
export const JournalEntryModel = model('JournalEntry', journalSchema);

/* ---------- suppliers, bills, payments, expenses ---------- */

const supplierSchema = new Schema(
  {
    clinicId: tenantField,
    name: { type: String, required: true },
    searchName: String,
    kind: { type: String, enum: ['lab', 'supplies', 'equipment', 'services', 'other'], default: 'supplies' },
    taxNumber: String,
    contact: { phone: String, email: String, person: String, address: String },
    payableAccountId: ref('Account'),
    balance: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'suppliers' },
);
applyBase(supplierSchema);
export const SupplierModel = model('Supplier', supplierSchema);

const billSchema = new Schema(
  {
    clinicId: tenantField,
    number: { type: String, required: true },
    supplierRef: { type: String, default: '' },
    supplierId: { ...ref('Supplier'), required: true },
    billDate: { type: String, required: true },
    dueDate: String,
    lines: { type: [{ description: String, expenseAccountId: Schema.Types.ObjectId, amount: Number, taxRateId: Schema.Types.ObjectId, taxAmount: Number, labOrderId: Schema.Types.ObjectId, _id: false }], default: [] },
    subtotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    amountPaid: { type: Number, default: 0 },
    status: { type: String, enum: ['draft', 'posted', 'partially_paid', 'paid', 'void'], default: 'draft' },
    journalEntryId: ref('JournalEntry'),
    notes: { type: String, default: '' },
  },
  { timestamps: true, collection: 'supplierBills', optimisticConcurrency: true },
);
applyBase(billSchema);
billSchema.index({ clinicId: 1, supplierId: 1, billDate: -1 });
billSchema.index({ clinicId: 1, status: 1, dueDate: 1 });
export const SupplierBillModel = model('SupplierBill', billSchema);

const supplierPaymentSchema = new Schema(
  {
    clinicId: tenantField,
    number: { type: String, required: true },
    supplierId: { ...ref('Supplier'), required: true },
    date: { type: String, required: true },
    amount: { type: Number, required: true },
    method: { type: String, enum: ['cash', 'bank_transfer', 'cheque', 'card', 'other'], default: 'bank_transfer' },
    paidFromAccountId: { ...ref('Account'), required: true },
    reference: { type: String, default: '' },
    allocations: { type: [{ billId: Schema.Types.ObjectId, amount: Number, _id: false }], default: [] },
    journalEntryId: ref('JournalEntry'),
  },
  { timestamps: true, collection: 'supplierPayments' },
);
applyBase(supplierPaymentSchema);
export const SupplierPaymentModel = model('SupplierPayment', supplierPaymentSchema);

const expenseSchema = new Schema(
  {
    clinicId: tenantField,
    number: { type: String, required: true },
    date: { type: String, required: true },
    categoryAccountId: { ...ref('Account'), required: true },
    amount: { type: Number, required: true },
    taxRateId: ref('TaxRate'),
    taxAmount: { type: Number, default: 0 },
    paidFromAccountId: { ...ref('Account'), required: true },
    payee: { type: String, default: '' },
    description: { type: String, default: '' },
    receiptFileId: ref('FileAsset'),
    status: { type: String, enum: ['pending_approval', 'approved', 'void'], default: 'approved' },
    journalEntryId: ref('JournalEntry'),
    approvedBy: Schema.Types.ObjectId,
  },
  { timestamps: true, collection: 'expenses' },
);
applyBase(expenseSchema);
expenseSchema.index({ clinicId: 1, date: -1 });
export const ExpenseModel = model('Expense', expenseSchema);

export type AccountDoc = HydratedDocument<Account>;
