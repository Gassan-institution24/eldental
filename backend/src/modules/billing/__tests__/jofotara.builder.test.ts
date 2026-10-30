import { describe, expect, it } from 'vitest';
import { buildJoFotaraXml, type JoFotaraInvoice } from '../einvoice/jofotara.builder';

const base: JoFotaraInvoice = {
  kind: 'invoice',
  number: 'INV-2026-000001',
  uuid: 'a1b2',
  issueDate: '2026-10-30',
  paymentType: 'cash',
  currency: 'JOD',
  seller: { taxNumber: '12345678', name: 'Smile & Co <Dental>', activityNumber: '9' },
  buyer: { name: 'لينا حداد', nationalId: '9871-234-567', phone: '+962791110001' },
  counter: 7,
  lines: [
    { name: 'Composite filling', quantity: 1, unitPrice: 30_000, discount: 5_000, taxRate: 1600, taxAmount: 4_000, taxCategory: 'S' },
    { name: 'Exam', quantity: 2, unitPrice: 10_000, discount: 0, taxRate: 0, taxAmount: 0, taxCategory: 'O' },
  ],
  totals: { discount: 5_000, taxExclusive: 45_000, tax: 4_000, taxInclusive: 49_000 },
};

describe('JoFotara builder', () => {
  it('builds escaped UBL with one line per item and 3-decimal JOD amounts', () => {
    const xml = buildJoFotaraXml(base);
    expect(xml).toContain('<cbc:InvoiceTypeCode name="011">388</cbc:InvoiceTypeCode>');
    expect(xml).toContain('Smile &amp; Co &lt;Dental&gt;');
    expect(xml).toContain('<cbc:ID schemeID="NIN">9871234567</cbc:ID>');
    expect(xml.match(/<cac:InvoiceLine>/g)).toHaveLength(2);
    expect(xml).toContain('<cbc:PayableAmount currencyID="JOD">49.000</cbc:PayableAmount>');
    expect(xml).toContain('<cbc:Percent>16.00</cbc:Percent>');
    expect(xml).not.toContain('BillingReference');
  });

  it('credit notes use 381 and reference the original; receivables use 021', () => {
    const xml = buildJoFotaraXml({ ...base, kind: 'credit_note', paymentType: 'receivable', original: { number: 'INV-2026-000001', uuid: 'orig-uuid', total: 49_000 } });
    expect(xml).toContain('<cbc:InvoiceTypeCode name="021">381</cbc:InvoiceTypeCode>');
    expect(xml).toContain('<cbc:UUID>orig-uuid</cbc:UUID>');
  });
});
