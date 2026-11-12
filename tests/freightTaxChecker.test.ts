import { describe, it, expect } from 'vitest';
import { checkHeaderChargesAndTaxes } from '../src/core/tax/freightTaxChecker.js';
import { StageADocument } from '../src/core/schema/stageA.schema.js';

describe('Header Charges & Tax on Freight Checker (Phase 3)', () => {
  const createBaseDoc = (): StageADocument => ({
    schemaVersion: '1.0',
    source: {
      documentId: 'doc-freight-1',
      sourceType: 'PDF',
      receivedAt: '2026-11-11T00:00:00Z',
      fileHash: null,
      messageId: null,
      contentHash: null,
      senderEmail: null,
      extractedTextId: null,
    },
    order: {
      poNumber: 'PO-FR-1',
      poDate: '2026-11-10',
      customerId: 'CUST-001',
      customerName: 'Acme',
      currency: 'INR',
    },
    lineItems: [
      {
        lineReference: '1',
        productCode: 'PROD-A',
        description: 'Product A',
        quantity: '5',
        unitOfMeasure: 'EA',
        unitPrice: '1000.00',
        discountAmount: '100.00', // line discount
        taxableAmount: '4900.00',
        taxes: [
          { type: 'IGST', rate: '18.00', amount: '882.00' },
        ],
        lineTotal: '5782.00',
      },
    ],
    amounts: {
      subtotal: '4900.00',
      discountTotal: '100.00',
      taxTotal: '882.00',
      freight: null,
      roundingAdjustment: '0.00',
      grandTotal: '5782.00',
    },
    headerAdjustments: [],
    evidence: [],
  });

  it('validates freight charge with 18% GST (tax on freight)', () => {
    const doc = createBaseDoc();
    // Add Freight adjustment of 500.00 with 18% IGST (90.00)
    doc.headerAdjustments = [
      {
        type: 'FREIGHT',
        description: 'Road Freight',
        amount: '500.00',
        taxes: [
          { type: 'IGST', rate: '18.00', amount: '90.00' },
        ],
      },
    ];
    doc.amounts.freight = '500.00';
    // Printed taxTotal is line tax (882.00) + freight tax (90.00) = 972.00
    doc.amounts.taxTotal = '972.00';

    const result = checkHeaderChargesAndTaxes(doc);
    expect(result.isValid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.computedFreight).toBe('500.00');
    expect(result.computedFreightTax).toBe('90.00');
  });

  it('validates header discount reducing taxable basis and tax', () => {
    const doc = createBaseDoc();
    // Add header discount of 200.00 with 18% tax reduction (36.00)
    doc.headerAdjustments = [
      {
        type: 'DISCOUNT',
        description: 'Prompt payment discount',
        amount: '200.00',
        taxes: [
          { type: 'IGST', rate: '18.00', amount: '36.00' },
        ],
      },
    ];
    // Total discount = line discount (100.00) + header discount (200.00) = 300.00
    doc.amounts.discountTotal = '300.00';
    // Total tax = line tax (882.00) - discount tax reduction (36.00) = 846.00
    doc.amounts.taxTotal = '846.00';

    const result = checkHeaderChargesAndTaxes(doc);
    expect(result.isValid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.computedHeaderDiscounts).toBe('200.00');
    expect(result.computedHeaderDiscountTaxes).toBe('36.00');
  });

  it('flags FREIGHT_AMOUNT_MISMATCH when printed freight does not match extracted header adjustment', () => {
    const doc = createBaseDoc();
    doc.headerAdjustments = [
      {
        type: 'FREIGHT',
        description: 'Standard Freight',
        amount: '500.00',
        taxes: [
          { type: 'IGST', rate: '18.00', amount: '90.00' },
        ],
      },
    ];
    // Document printed freight is 750.00, but extracted adjustment is 500.00
    doc.amounts.freight = '750.00';

    const result = checkHeaderChargesAndTaxes(doc);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.code === 'FREIGHT_AMOUNT_MISMATCH')).toBe(true);
    const issue = result.issues.find((i) => i.code === 'FREIGHT_AMOUNT_MISMATCH');
    expect(issue?.expected).toBe('500.00');
    expect(issue?.actual).toBe('750.00');
  });

  it('flags DISCOUNT_TOTAL_MISMATCH when printed discountTotal does not match lines + header discounts', () => {
    const doc = createBaseDoc();
    // Line discount is 100.00
    // Header discount is 200.00 -> total expected is 300.00
    doc.headerAdjustments = [
      {
        type: 'DISCOUNT',
        description: 'Special rebate',
        amount: '200.00',
        taxes: [],
      },
    ];
    doc.amounts.discountTotal = '150.00'; // Mismatch

    const result = checkHeaderChargesAndTaxes(doc);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.code === 'DISCOUNT_TOTAL_MISMATCH')).toBe(true);
  });

  it('flags TAX_TOTAL_MISMATCH when printed taxTotal does not match lines + header adjustment taxes', () => {
    const doc = createBaseDoc();
    // Line tax is 882.00
    // Header freight tax is 90.00 -> total expected is 972.00
    doc.headerAdjustments = [
      {
        type: 'FREIGHT',
        description: 'Express',
        amount: '500.00',
        taxes: [{ type: 'IGST', rate: '18.00', amount: '90.00' }],
      },
    ];
    doc.amounts.taxTotal = '1000.00'; // Stated tax is wrong

    const result = checkHeaderChargesAndTaxes(doc);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.code === 'TAX_TOTAL_MISMATCH')).toBe(true);
  });
});

