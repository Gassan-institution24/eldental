import { randomUUID } from 'node:crypto';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { on } from '@/core/events/bus';
import { nextSequence } from '@/core/db/sequence';
import { defineJob, enqueue } from '@/core/jobs/queue';
import { runInTenant, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { PatientModel } from '@/modules/patients/patient.models';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { TaxRateModel } from '@/modules/clinic/clinic.models';
import { decrypt } from '@/shared/crypto';
import { InvoiceModel } from '../billing.models';
import { buildJoFotaraXml, type JoFotaraInvoice } from './jofotara.builder';

/**
 * JoFotara submission (09 §7): credentials are per clinic, encrypted, entered in the app —
 * never in `.env`. `JOFOTARA_ENABLED` is only a platform kill switch.
 */
type SubmitResult = { ok: boolean; status?: string; qr?: string; body: string; permanent: boolean };

export async function submitToJoFotara(xml: string, creds: { clientId: string; secretKey: string }): Promise<SubmitResult> {
  const res = await fetch(env.JOFOTARA_BASE_URL, {
    method: 'POST',
    headers: { 'Client-Id': creds.clientId, 'Secret-Key': creds.secretKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoice: Buffer.from(xml).toString('base64') }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: { EINV_STATUS?: string; EINV_QR?: string } = {};
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    /* non-JSON error page */
  }
  const ok = res.ok && data.EINV_STATUS === 'SUBMITTED';
  // 4xx are validation problems (fix data, resubmit by hand); 5xx/timeouts are retried.
  return { ok, ...(data.EINV_STATUS ? { status: data.EINV_STATUS } : {}), ...(data.EINV_QR ? { qr: data.EINV_QR } : {}), body: text.slice(0, 4000), permanent: res.status >= 400 && res.status < 500 };
}

async function buildFor(clinicId: string, invoiceId: string): Promise<{ xml: string; creds: { clientId: string; secretKey: string } } | null> {
  const clinic = await runWithoutTenant(() => ClinicModel.findById(clinicId).select('+integrations.jofotara.secretKeyEnc name taxNumber currency integrations').lean());
  const jf = clinic?.integrations?.jofotara;
  if (!clinic || !jf?.enabled || !jf.clientId || !jf.secretKeyEnc) return null;
  return runInTenant(clinicId, async () => {
    const inv = await InvoiceModel.findById(invoiceId);
    if (!inv || !inv.number) return null;
    const patient = await PatientModel.findById(inv.patientId).select('fullName phone +nationalIdEnc').lean();
    const taxes = new Map((await TaxRateModel.find({}).lean()).map((t) => [String(t._id), t]));
    const original = inv.originalInvoiceId ? await InvoiceModel.findById(inv.originalInvoiceId).lean() : null;
    if (!inv.einvoice?.uuid) {
      inv.set('einvoice.uuid', randomUUID());
      await inv.save();
    }
    const doc: JoFotaraInvoice = {
      kind: inv.type === 'credit_note' ? 'credit_note' : 'invoice',
      number: inv.number,
      uuid: inv.einvoice!.uuid!,
      issueDate: inv.issueDate ?? new Date().toISOString().slice(0, 10),
      paymentType: (inv.amountPaid ?? 0) >= (inv.total ?? 0) ? 'cash' : 'receivable',
      currency: clinic.currency ?? 'JOD',
      seller: { taxNumber: clinic.taxNumber ?? '', name: clinic.name, activityNumber: jf.activityNumber ?? jf.incomeSourceSequence ?? '' },
      buyer: { name: patient?.fullName ?? '', ...(patient?.nationalIdEnc ? { nationalId: decrypt(patient.nationalIdEnc) } : {}), ...(patient?.phone?.e164 ? { phone: patient.phone.e164 } : {}) },
      counter: await nextSequence('jofotaraIcv'),
      ...(original?.number ? { original: { number: original.number, uuid: original.einvoice?.uuid ?? '', total: original.total ?? 0 } } : {}),
      lines: inv.lines.map((l) => ({
        name: l.description || 'Dental service',
        quantity: l.quantity ?? 1,
        unitPrice: l.unitPrice ?? 0,
        discount: l.discount ?? 0,
        taxRate: l.taxRate ?? 0,
        taxAmount: l.taxAmount ?? 0,
        taxCategory: (taxes.get(String(l.taxRateId))?.jofotaraCategory as 'S' | 'Z' | 'O' | undefined) ?? (l.taxRate ? 'S' : 'O'),
      })),
      totals: { discount: inv.discountTotal ?? 0, taxExclusive: (inv.subtotal ?? 0) - (inv.discountTotal ?? 0), tax: inv.taxTotal ?? 0, taxInclusive: inv.total ?? 0 },
    };
    return { xml: buildJoFotaraXml(doc), creds: { clientId: jf.clientId!, secretKey: decrypt(jf.secretKeyEnc!) } };
  });
}

defineJob('einvoice', 'jofotara.submit', async (data) => {
  const clinicId = String(data.clinicId);
  const invoiceId = String(data.invoiceId);
  if (!env.JOFOTARA_ENABLED) {
    await runInTenant(clinicId, () => InvoiceModel.updateOne({ _id: invoiceId }, { $set: { 'einvoice.status': 'disabled' } }));
    return;
  }
  const built = await buildFor(clinicId, invoiceId);
  if (!built) return;
  const r = await submitToJoFotara(built.xml, built.creds).catch((err: unknown) => ({ ok: false, body: String((err as Error).message), permanent: false }) as SubmitResult);
  await runInTenant(clinicId, () =>
    InvoiceModel.updateOne(
      { _id: invoiceId },
      { $set: { 'einvoice.status': r.ok ? 'accepted' : r.permanent ? 'rejected' : 'queued', 'einvoice.submittedAt': new Date(), 'einvoice.response': r.body, ...(r.qr ? { 'einvoice.qr': r.qr } : {}) }, $inc: { 'einvoice.attempts': 1 } },
    ),
  );
  // Transient failures throw so BullMQ retries with backoff.
  if (!r.ok && !r.permanent) throw new Error(`JoFotara temporarily unavailable: ${r.body.slice(0, 200)}`);
  if (!r.ok) logger.warn({ invoiceId }, 'JoFotara rejected invoice');
});

on('invoice.issued', async ({ clinicId, invoiceId }) => {
  const queued = await runInTenant(clinicId, () => InvoiceModel.exists({ _id: invoiceId, 'einvoice.status': 'queued' }));
  if (queued) await enqueue('einvoice', 'jofotara.submit', { clinicId, invoiceId });
});

/** Manual resubmit after fixing data (the /einvoices list). */
export async function resubmit(clinicId: string, invoiceId: string) {
  await runInTenant(clinicId, () => InvoiceModel.updateOne({ _id: invoiceId }, { $set: { 'einvoice.status': 'queued' } }));
  await enqueue('einvoice', 'jofotara.submit', { clinicId, invoiceId });
}
