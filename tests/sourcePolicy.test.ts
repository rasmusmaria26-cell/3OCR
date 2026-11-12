import { describe, it, expect } from 'vitest';
import { validateSourcePolicy, compareSourceCompleteness } from '../src/core/policy/sourcePolicy.js';
import { StageADocument } from '../src/core/schema/stageA.schema.js';

describe('Source Policy Validator', () => {
  const createBaseDoc = (sourceType: 'EMAIL' | 'PDF' | 'JSON'): StageADocument => ({
    schemaVersion: '1.0',
    source: {
      documentId: `doc-${sourceType.toLowerCase()}`,
      sourceType,
      receivedAt: '2026-11-11T00:00:00Z',
      fileHash: null,
      messageId: null,
      contentHash: null,
      senderEmail: null,
      extractedTextId: null,
    },
    order: {
      poNumber: 'PO-1001',
      poDate: '2026-11-10',
      customerId: 'CUST-001',
      customerName: 'Acme',
      currency: 'USD',
    },
    lineItems: [
      {
        lineReference: '1',
        productCode: 'LAP-001',
        description: 'Laptop',
        quantity: '5',
        unitOfMeasure: 'EA',
        unitPrice: '500',
        discountAmount: null,
        taxableAmount: '2500',
        taxes: [],
        lineTotal: '2500',
      },
    ],
    amounts: {
      subtotal: '2500',
      discountTotal: null,
      taxTotal: null,
      freight: null,
      roundingAdjustment: null,
      grandTotal: '2500',
    },
    headerAdjustments: [],
    evidence: [],
  });

  it('validates a complete valid document across all source types', () => {
    ['EMAIL', 'PDF', 'JSON'].forEach((sourceType) => {
      const doc = createBaseDoc(sourceType as any);
      const result = validateSourcePolicy(doc);
      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  it('fails if PO number is missing on any source', () => {
    const doc = createBaseDoc('EMAIL');
    doc.order.poNumber = null;
    const result = validateSourcePolicy(doc);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.field === 'order.poNumber')).toBe(true);
  });

  it('fails if no line items exist on any source', () => {
    const doc = createBaseDoc('PDF');
    doc.lineItems = [];
    const result = validateSourcePolicy(doc);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.code === 'NO_LINE_ITEMS')).toBe(true);
  });

  it('requires unitPrice and grandTotal for PDF and JSON only, optional for EMAIL', () => {
    // Email missing unitPrice and grandTotal -> VALID
    const emailDoc = createBaseDoc('EMAIL');
    emailDoc.lineItems[0].unitPrice = null;
    emailDoc.amounts.grandTotal = null;
    const emailResult = validateSourcePolicy(emailDoc);
    expect(emailResult.isValid).toBe(true);

    // PDF missing unitPrice -> INVALID
    const pdfDoc = createBaseDoc('PDF');
    pdfDoc.lineItems[0].unitPrice = null;
    const pdfResult = validateSourcePolicy(pdfDoc);
    expect(pdfResult.isValid).toBe(false);
    expect(pdfResult.issues.some((i) => i.field === 'lineItems[0].unitPrice')).toBe(true);

    // JSON missing grandTotal -> INVALID
    const jsonDoc = createBaseDoc('JSON');
    jsonDoc.amounts.grandTotal = null;
    const jsonResult = validateSourcePolicy(jsonDoc);
    expect(jsonResult.isValid).toBe(false);
    expect(jsonResult.issues.some((i) => i.field === 'amounts.grandTotal')).toBe(true);
  });

  describe('Source Completeness Policies', () => {
    it('allows item in PDF to be missing from partial EMAIL (fine)', () => {
      const emailSkus = ['LAP-001'];
      const pdfSkus = ['LAP-001', 'MOU-001']; // PDF has additional item not in email
      const result = compareSourceCompleteness({
        emailSkus,
        pdfSkus,
      });

      expect(result.mismatches).toHaveLength(0);
    });

    it('flags item in EMAIL missing from complete PDF as MISMATCH', () => {
      const emailSkus = ['LAP-001', 'KEY-001']; // email claims KEY-001
      const pdfSkus = ['LAP-001']; // complete PDF does not have KEY-001
      const result = compareSourceCompleteness({
        emailSkus,
        pdfSkus,
      });

      expect(result.mismatches).toHaveLength(1);
      expect(result.mismatches[0].sku).toBe('KEY-001');
      expect(result.mismatches[0].reason).toBe('ITEM_IN_EMAIL_MISSING_FROM_COMPLETE_PDF');
    });

    it('flags item in PDF missing from complete JSON (or reverse) as MISMATCH', () => {
      const pdfSkus = ['LAP-001', 'MOU-001'];
      const jsonSkus = ['LAP-001']; // JSON missing MOU-001
      const result = compareSourceCompleteness({
        pdfSkus,
        jsonSkus,
      });

      expect(result.mismatches).toHaveLength(1);
      expect(result.mismatches[0].sku).toBe('MOU-001');
      expect(result.mismatches[0].reason).toBe('PDF_AND_JSON_ITEM_COUNT_MISMATCH');
    });
  });
});

