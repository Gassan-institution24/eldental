import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { applyBase } from '@/core/db/plugins';
import { tenantField } from '@/core/tenancy/tenantPlugin';

const ref = (name: string) => ({ type: Schema.Types.ObjectId, ref: name });

export const INVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid', 'void'] as const;

const invoiceLineSchema = new Schema({
  performedProcedureId: ref('PerformedProcedure'),
  clinicProcedureId: ref('ClinicProcedure'),
  description: { type: String, default: '' },
  category: String,
  toothNumbers: { type: [Number], default: [] },
  quantity: { type: Number, default: 1 },
  unitPrice: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  taxRateId: ref('TaxRate'),
  taxRate: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  lineTotal: { type: Number, default: 0 },
  insuranceShare: { type: Number, default: 0 },
  patientShare: { type: Number, default: 0 },
  revenueAccountId: ref('Account'),
  dentistId: ref('Staff'),
});

/** Invoices and credit notes (03 §7). Issued documents are immutable. */
const invoiceSchema = new Schema(
  {
    clinicId: tenantField,
    number: String,
    type: { type: String, enum: ['invoice', 'credit_note'], default: 'invoice' },
    status: { type: String, enum: INVOICE_STATUSES, default: 'draft' },
    patientId: { ...ref('Patient'), required: true },
    insurancePolicyId: ref('InsurancePolicy'),
    insuranceCompanyId: ref('InsuranceCompany'),
    appointmentId: ref('Appointment'),
    treatmentPlanId: ref('TreatmentPlan'),
    dentistId: ref('Staff'),
    lines: { type: [invoiceLineSchema], default: [] },
    invoiceDiscount: { type: Number, default: 0 },
    discountReason: { type: String, default: '' },
    subtotal: { type: Number, default: 0 },
    discountTotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    insuranceTotal: { type: Number, default: 0 },
    patientTotal: { type: Number, default: 0 },
    amountPaid: { type: Number, default: 0 },
    insurancePaid: { type: Number, default: 0 },
    balanceDue: { type: Number, default: 0 },
    creditedTotal: { type: Number, default: 0 },
    writtenOff: { type: Number, default: 0 },
    issueDate: String,
    dueDate: String,
    installmentPlan: { type: [{ dueDate: String, amount: Number, paidAmount: { type: Number, default: 0 }, _id: false }], default: [] },
    originalInvoiceId: ref('Invoice'),
    journalEntryId: ref('JournalEntry'),
    claimId: ref('InsuranceClaim'),
    notes: { type: String, default: '' },
    voidReason: String,
    issuedBy: Schema.Types.ObjectId,
    idempotencyKey: String,
    einvoice: {
      status: { type: String, enum: ['not_sent', 'queued', 'accepted', 'rejected', 'disabled'], default: 'not_sent' },
      uuid: String,
      qr: String,
      submittedAt: Date,
      response: String,
      attempts: { type: Number, default: 0 },
    },
  },
  { timestamps: true, collection: 'invoices', optimisticConcurrency: true },
);
applyBase(invoiceSchema);
invoiceSchema.index({ clinicId: 1, number: 1 }, { unique: true, partialFilterExpression: { number: { $type: 'string' } } });
invoiceSchema.index({ clinicId: 1, patientId: 1, issueDate: -1 });
invoiceSchema.index({ clinicId: 1, status: 1, dueDate: 1 });
invoiceSchema.index({ clinicId: 1, appointmentId: 1 });
// Doctor scope (04 §3): header doctor or any line doctor; the $or uses one index per branch.
invoiceSchema.index({ clinicId: 1, dentistId: 1, createdAt: -1 });
invoiceSchema.index({ clinicId: 1, 'lines.dentistId': 1, createdAt: -1 });
export type Invoice = InferSchemaType<typeof invoiceSchema>;
export type InvoiceDoc = HydratedDocument<Invoice>;
export const InvoiceModel = model('Invoice', invoiceSchema);

export const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'cheque', 'wallet', 'other'] as const;

const paymentSchema = new Schema(
  {
    clinicId: tenantField,
    number: { type: String, required: true },
    receiptNumber: String,
    payerType: { type: String, enum: ['patient', 'insurance'], default: 'patient' },
    patientId: ref('Patient'),
    insuranceCompanyId: ref('InsuranceCompany'),
    claimId: ref('InsuranceClaim'),
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    amount: { type: Number, required: true },
    receivedAt: { type: Date, default: () => new Date() },
    date: { type: String, required: true },
    reference: { type: String, default: '' },
    cheque: { number: String, bank: String, dueDate: String, status: { type: String, enum: ['under_collection', 'cleared', 'bounced'] } },
    depositAccountId: { ...ref('Account'), required: true },
    cashSessionId: ref('CashSession'),
    allocations: { type: [{ invoiceId: Schema.Types.ObjectId, amount: Number, at: Date, journalEntryId: Schema.Types.ObjectId, _id: false }], default: [] },
    unallocated: { type: Number, default: 0 },
    refunded: { type: Number, default: 0 },
    status: { type: String, enum: ['posted', 'partially_refunded', 'refunded', 'void'], default: 'posted' },
    // `invoices`: what each refund took back from invoice allocations (doctor collections, 09 §8.1).
    refunds: { type: [{ amount: Number, at: Date, reason: String, journalEntryId: Schema.Types.ObjectId, invoices: { type: [{ invoiceId: Schema.Types.ObjectId, amount: Number, _id: false }], default: undefined }, _id: false }], default: [] },
    journalEntryId: ref('JournalEntry'),
    idempotencyKey: String,
    notes: { type: String, default: '' },
    receivedBy: Schema.Types.ObjectId,
  },
  { timestamps: true, collection: 'payments' },
);
applyBase(paymentSchema);
paymentSchema.index({ clinicId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
paymentSchema.index({ clinicId: 1, patientId: 1, receivedAt: -1 });
paymentSchema.index({ clinicId: 1, date: -1 });
export type Payment = InferSchemaType<typeof paymentSchema>;
export const PaymentModel = model('Payment', paymentSchema);

const claimSchema = new Schema(
  {
    clinicId: tenantField,
    number: { type: String, required: true },
    insuranceCompanyId: { ...ref('InsuranceCompany'), required: true },
    patientId: { ...ref('Patient'), required: true },
    policyId: ref('InsurancePolicy'),
    invoiceIds: { type: [Schema.Types.ObjectId], default: [] },
    claimedAmount: { type: Number, default: 0 },
    approvedAmount: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    shortfallMode: { type: String, enum: ['write_off', 'rebill'] },
    shortfallJournalId: ref('JournalEntry'),
    status: { type: String, enum: ['draft', 'submitted', 'approved', 'partially_approved', 'rejected', 'paid'], default: 'draft' },
    submittedAt: Date,
    responseAt: Date,
    rejectionReason: String,
    notes: { type: String, default: '' },
  },
  { timestamps: true, collection: 'insuranceClaims' },
);
applyBase(claimSchema);
claimSchema.index({ clinicId: 1, insuranceCompanyId: 1, status: 1 });
export const InsuranceClaimModel = model('InsuranceClaim', claimSchema);

const cashSessionSchema = new Schema(
  {
    clinicId: tenantField,
    cashAccountId: { ...ref('Account'), required: true },
    openedBy: { type: Schema.Types.ObjectId, required: true },
    openedAt: { type: Date, default: () => new Date() },
    openingFloat: { type: Number, default: 0 },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    closedBy: Schema.Types.ObjectId,
    closedAt: Date,
    countedAmount: Number,
    expectedAmount: Number,
    difference: Number,
    differenceJournalEntryId: ref('JournalEntry'),
    notes: { type: String, default: '' },
  },
  { timestamps: true, collection: 'cashSessions' },
);
applyBase(cashSessionSchema);
cashSessionSchema.index({ clinicId: 1, cashAccountId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'open' } });
export const CashSessionModel = model('CashSession', cashSessionSchema);
