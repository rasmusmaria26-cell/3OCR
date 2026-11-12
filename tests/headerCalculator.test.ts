import { describe, it, expect } from 'vitest';
import { calculateDocumentGrandTotal } from '../src/core/engine/headerCalculator.js';
import { StageADocument } from '../src/core/schema/stageA.schema.js';

describe('Header Calculator & Grand Total Arithmetic (Phase 3)', () => {
  const createBaseDoc = (): StageADocument => ({
    schemaVersion: '1.0',
    source: {
      documentId: 'doc-hc-1',
      sourceType: 'PDF',
      receivedAt: '2026-11-11T00:00:00Z',
      fileHash: null,
      messageId: null,
      contentHash: null,
      senderEmail: null,
      extractedTextId: null,
    },
    order: {
      poNumber: 'PO-HC-1',
      poDate: '2026-11-10',
      customerId: 'CUST-001',
      customerName: 'Acme',
      currency: 'INR',
    },
    lineItems: [
      {
        lineReference: '1',
        productCode: 'PROD-1',
        description: 'Product 1',
        quantity: '2',
        unitOfMeasure: 'EA',
        unitPrice: '1000.00',
        discountAmount: '0.00',
        taxableAmount: '2000.00',
        taxes: [{ type: 'IGST', rate: '18.00', amount: '360.00' }],
        lineTotal: '2360.00',
      },
    ],
    amounts: {
      subtotal: '2000.00',
      discountTotal: '0.00',
      taxTotal: '360.00',
      freight: null,
      roundingAdjustment: '0.00',
      grandTotal: '2360.00',
    },
    headerAdjustments: [],
    evidence: [],
  });

  it('calculates grand total with line items + freight + packing + taxes - discounts + rounding adjustment', () => {
    // lineTotal: 2360.00
    // freight: 500.00 + 18% tax (90.00) = 590.00
    // packing: 200.00 + 18% tax (36.00) = 236.00
    // discount: 100.00 + 18% tax reduction (18.00) = 118.00
    // roundingAdjustment: -0.20
    // Expected Grand Total = 2360.00 + 500.00 + 90.00 + 200.00 + 36.00 - 100.00 - 18.00 - 0.20
    // = 3067.80
    const doc = createBaseDoc();
    doc.headerAdjustments = [
      {
        type: 'FREIGHT',
        description: 'Express shipping',
        amount: '500.00',
        taxes: [{ type: 'IGST', rate: '18.00', amount: '90.00' }],
      },
      {
        type: 'PACKING',
        description: 'Special crating',
        amount: '200.00',
        taxes: [{ type: 'IGST', rate: '18.00', amount: '36.00' }],
      },
      {
        type: 'DISCOUNT',
        description: 'Promotional header discount',
        amount: '100.00',
        taxes: [{ type: 'IGST', rate: '18.00', amount: '18.00' }],
      },
    ];
    doc.amounts.roundingAdjustment = '-0.20';
    doc.amounts.discountTotal = '100.00';
    doc.amounts.taxTotal = '468.00';
    doc.amounts.grandTotal = '3067.80';

    const result = calculateDocumentGrandTotal(doc);
    expect(result.isValid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.computedGrandTotal).toBe('3067.80');
  });

  it('flags GRAND_TOTAL_ARITHMETIC_MISMATCH when discrepancy exceeds tolerance of 1.00', () => {
    const doc = createBaseDoc();
    doc.headerAdjustments = [
      {
        type: 'FREIGHT',
        description: 'Freight',
        amount: '500.00',
        taxes: [{ type: 'IGST', rate: '18.00', amount: '90.00' }],
      },
    ];
    // Expected grand total = 2360 + 500 + 90 = 2950.00
    // Printed grand total is 2990.00 (diff 40.00 > 1.00)
    doc.amounts.grandTotal = '2990.00';

    const result = calculateDocumentGrandTotal(doc);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.code === 'GRAND_TOTAL_ARITHMETIC_MISMATCH')).toBe(true);
    const issue = result.issues.find((i) => i.code === 'GRAND_TOTAL_ARITHMETIC_MISMATCH');
    expect(issue?.expected).toBe('2950.00');
    expect(issue?.actual).toBe('2990.00');
  });

  it('tolerates small rounding differences within tolerance 1.00', () => {
    const doc = createBaseDoc();
    // Expected grand total: 2360.00
    // Printed grand total: 2360.40 (diff 0.40 <= 1.00)
    doc.amounts.grandTotal = '2360.40';

    const result = calculateDocumentGrandTotal(doc);
    if (!result.isValid) console.log('DEBUG ISSUES:', result.issues);
    expect(result.isValid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});
