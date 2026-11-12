import { describe, it, expect } from 'vitest';
import { validateGstLineItem, validateDocumentGst, GstValidationResult } from '../src/core/tax/gstValidator.js';
import { StageADocument, LineItem } from '../src/core/schema/stageA.schema.js';

describe('GST Rate Validator (Phase 3)', () => {
  const createBaseLine = (overrides?: Partial<LineItem>): LineItem => ({
    lineReference: '1',
    productCode: 'PROD-01',
    description: 'Test Item',
    quantity: '10',
    unitOfMeasure: 'EA',
    unitPrice: '100.00',
    discountAmount: '0.00',
    taxableAmount: '1000.00',
    taxes: [],
    lineTotal: '1180.00',
    ...overrides,
  });

  const createBaseDoc = (lineItems: LineItem[]): StageADocument => ({
    schemaVersion: '1.0',
    source: {
      documentId: 'doc-gst-1',
      sourceType: 'PDF',
      receivedAt: '2026-11-11T00:00:00Z',
      fileHash: null,
      messageId: null,
      contentHash: null,
      senderEmail: null,
      extractedTextId: null,
    },
    order: {
      poNumber: 'PO-GST-1',
      poDate: '2026-11-10',
      customerId: 'CUST-001',
      customerName: 'Acme',
      currency: 'INR',
    },
    lineItems,
    amounts: {
      subtotal: '1000.00',
      discountTotal: '0.00',
      taxTotal: '180.00',
      freight: '0.00',
      roundingAdjustment: '0.00',
      grandTotal: '1180.00',
    },
    headerAdjustments: [],
    evidence: [],
  });

  it('validates CGST/SGST 9%+9% matching 18% line taxable (intrastate)', () => {
    // 1000.00 * 9% = 90.00 CGST, 1000.00 * 9% = 90.00 SGST
    const line = createBaseLine({
      taxableAmount: '1000.00',
      taxes: [
        { type: 'CGST', rate: '9.00', amount: '90.00' },
        { type: 'SGST', rate: '9.00', amount: '90.00' },
      ],
      lineTotal: '1180.00',
    });

    const result = validateGstLineItem(line);
    expect(result.isValid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('validates IGST 18% on taxable line items (interstate)', () => {
    // 1000.00 * 18% = 180.00 IGST
    const line = createBaseLine({
      taxableAmount: '1000.00',
      taxes: [
        { type: 'IGST', rate: '18.00', amount: '180.00' },
      ],
      lineTotal: '1180.00',
    });

    const result = validateGstLineItem(line);
    expect(result.isValid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('flags TAX_RATE_CALCULATION_MISMATCH when tax math mismatch exceeds 0.01 tolerance', () => {
    // Taxable 1000.00 at 18% should be 180.00, stated amount is 185.00
    const line = createBaseLine({
      taxableAmount: '1000.00',
      taxes: [
        { type: 'IGST', rate: '18.00', amount: '185.00' },
      ],
    });

    const result = validateGstLineItem(line);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.code === 'TAX_RATE_CALCULATION_MISMATCH')).toBe(true);
    const issue = result.issues.find((i) => i.code === 'TAX_RATE_CALCULATION_MISMATCH');
    expect(issue?.expected).toBe('180.00');
    expect(issue?.actual).toBe('185.00');
  });

  it('allows tiny rounding differences within 0.01 tolerance', () => {
    // Taxable 333.33 at 18% = 59.9994 -> stated 60.00 (difference 0.0006 < 0.01)
    const line = createBaseLine({
      taxableAmount: '333.33',
      taxes: [
        { type: 'IGST', rate: '18.00', amount: '60.00' },
      ],
    });

    const result = validateGstLineItem(line);
    expect(result.isValid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('flags INVALID_TAX_RATE when rate is not a recognized GST rate', () => {
    // Rate 17.5% is not a recognized GST rate (standard: 0%, 5%, 12%, 18%, 28%)
    const line = createBaseLine({
      taxableAmount: '1000.00',
      taxes: [
        { type: 'IGST', rate: '17.50', amount: '175.00' },
      ],
    });

    const result = validateGstLineItem(line);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.code === 'INVALID_TAX_RATE')).toBe(true);
  });

  it('flags split mismatch when CGST and SGST rates are unequal', () => {
    // CGST 9% and SGST 6% is an invalid split
    const line = createBaseLine({
      taxableAmount: '1000.00',
      taxes: [
        { type: 'CGST', rate: '9.00', amount: '90.00' },
        { type: 'SGST', rate: '6.00', amount: '60.00' },
      ],
    });

    const result = validateGstLineItem(line);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.code === 'INVALID_TAX_RATE' || i.code === 'GST_SPLIT_MISMATCH')).toBe(true);
  });

  it('flags error if both IGST and CGST/SGST are simultaneously applied on the same line', () => {
    const line = createBaseLine({
      taxableAmount: '1000.00',
      taxes: [
        { type: 'IGST', rate: '18.00', amount: '180.00' },
        { type: 'CGST', rate: '9.00', amount: '90.00' },
      ],
    });

    const result = validateGstLineItem(line);
    expect(result.isValid).toBe(false);
  });

  it('validates an entire StageADocument with multiple line items', () => {
    const validDoc = createBaseDoc([
      createBaseLine({
        lineReference: '1',
        taxableAmount: '1000.00',
        taxes: [
          { type: 'CGST', rate: '9.00', amount: '90.00' },
          { type: 'SGST', rate: '9.00', amount: '90.00' },
        ],
      }),
      createBaseLine({
        lineReference: '2',
        taxableAmount: '500.00',
        taxes: [
          { type: 'CGST', rate: '9.00', amount: '45.00' },
          { type: 'SGST', rate: '9.00', amount: '45.00' },
        ],
      }),
    ]);

    const result = validateDocumentGst(validDoc);
    expect(result.isValid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

