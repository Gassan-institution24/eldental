import { toDecimalString } from '@/shared/money';

/**
 * JoFotara UBL 2.1 invoice XML (09 §7). Pure: no I/O. Ported from Hakeemna's invoicing
 * controller and extended to many lines, VAT per line and credit notes.
 *
 * - Invoice type code 388 = invoice, 381 = credit note (return).
 * - Payment method name: 011 = cash invoice, 021 = receivable (credit) invoice.
 */
export type JoFotaraInvoice = {
  kind: 'invoice' | 'credit_note';
  number: string;
  uuid: string;
  issueDate: string;
  paymentType: 'cash' | 'receivable';
  note?: string;
  currency: string;
  seller: { taxNumber: string; name: string; activityNumber: string; countryCode?: string };
  buyer: { name: string; nationalId?: string; phone?: string; countryCode?: string };
  /** Sequential invoice counter (ICV). */
  counter: number;
  original?: { number: string; uuid: string; total: number };
  lines: { name: string; quantity: number; unitPrice: number; discount: number; taxRate: number; taxAmount: number; taxCategory: 'S' | 'Z' | 'O' }[];
  totals: { discount: number; taxExclusive: number; tax: number; taxInclusive: number };
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function buildJoFotaraXml(inv: JoFotaraInvoice): string {
  const cur = inv.currency;
  const m = (n: number) => toDecimalString(n, cur);
  const amt = (tag: string, n: number) => `<cbc:${tag} currencyID="${esc(cur)}">${m(n)}</cbc:${tag}>`;
  const typeCode = inv.kind === 'credit_note' ? '381' : '388';
  const methodName = inv.paymentType === 'receivable' ? '021' : '011';
  const country = esc(inv.seller.countryCode ?? 'JO');

  const lines = inv.lines
    .map((l, i) => {
      const net = l.unitPrice * l.quantity - l.discount;
      const percent = (l.taxRate / 100).toFixed(2);
      return `
  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="PCE">${l.quantity.toFixed(2)}</cbc:InvoicedQuantity>
    ${amt('LineExtensionAmount', net)}
    <cac:TaxTotal>
      ${amt('TaxAmount', l.taxAmount)}
      ${amt('RoundingAmount', net + l.taxAmount)}
      <cac:TaxSubtotal>
        ${amt('TaxableAmount', net)}
        ${amt('TaxAmount', l.taxAmount)}
        <cac:TaxCategory>
          <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">${l.taxCategory}</cbc:ID>
          <cbc:Percent>${percent}</cbc:Percent>
          <cac:TaxScheme><cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID></cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item><cbc:Name>${esc(l.name)}</cbc:Name></cac:Item>
    <cac:Price>
      ${amt('PriceAmount', l.unitPrice)}
      <cac:AllowanceCharge>
        <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
        <cbc:AllowanceChargeReason>DISCOUNT</cbc:AllowanceChargeReason>
        ${amt('Amount', l.discount)}
      </cac:AllowanceCharge>
    </cac:Price>
  </cac:InvoiceLine>`;
    })
    .join('');

  const billingRef = inv.original
    ? `
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${esc(inv.original.number)}</cbc:ID>
      <cbc:UUID>${esc(inv.original.uuid)}</cbc:UUID>
      <cbc:DocumentDescription>${m(inv.original.total)}</cbc:DocumentDescription>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>`
    : '';

  const buyerId = (inv.buyer.nationalId ?? '').replace(/\D/g, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${esc(inv.number)}</cbc:ID>
  <cbc:UUID>${esc(inv.uuid)}</cbc:UUID>
  <cbc:IssueDate>${esc(inv.issueDate)}</cbc:IssueDate>
  <cbc:InvoiceTypeCode name="${methodName}">${typeCode}</cbc:InvoiceTypeCode>
  ${inv.note ? `<cbc:Note>${esc(inv.note)}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>${esc(cur)}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>${esc(cur)}</cbc:TaxCurrencyCode>${billingRef}
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>${inv.counter}</cbc:UUID>
  </cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PostalAddress><cac:Country><cbc:IdentificationCode>${country}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(inv.seller.taxNumber)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(inv.seller.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      ${buyerId ? `<cac:PartyIdentification><cbc:ID schemeID="NIN">${buyerId}</cbc:ID></cac:PartyIdentification>` : ''}
      <cac:PostalAddress>
        <cbc:PostalZone>00000</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${esc(inv.buyer.countryCode ?? 'JO')}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(inv.buyer.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
    ${inv.buyer.phone ? `<cac:AccountingContact><cbc:Telephone>${esc(inv.buyer.phone)}</cbc:Telephone></cac:AccountingContact>` : ''}
  </cac:AccountingCustomerParty>
  <cac:SellerSupplierParty>
    <cac:Party><cac:PartyIdentification><cbc:ID>${esc(inv.seller.activityNumber)}</cbc:ID></cac:PartyIdentification></cac:Party>
  </cac:SellerSupplierParty>
  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>discount</cbc:AllowanceChargeReason>
    ${amt('Amount', inv.totals.discount)}
  </cac:AllowanceCharge>
  <cac:TaxTotal>
    ${amt('TaxAmount', inv.totals.tax)}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    ${amt('TaxExclusiveAmount', inv.totals.taxExclusive)}
    ${amt('TaxInclusiveAmount', inv.totals.taxInclusive)}
    ${amt('AllowanceTotalAmount', inv.totals.discount)}
    ${amt('PayableAmount', inv.totals.taxInclusive)}
  </cac:LegalMonetaryTotal>${lines}
</Invoice>`;
}
