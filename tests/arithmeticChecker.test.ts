import { describe, it, expect } from 'vitest';
import { checkDocumentArithmetic, detectSharedWrongTotal } from '../src/core/engine/arithmeticChecker.js';
import { StageADocument } from '../src/core/schema/stageA.schema.js';

describe('Arithmetic Checker (Fix 10)', () => {
  const createBaseDoc = (): StageADocument => ({
    schemaVersion: '1.0',
    source: {
      documentId: 'doc-1',
      sourceType: 'PDF',
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
      customerName: 'Acme Corp',
      currency: 'INR',
    },
    lineItems: [
      {
        lineReference: '1',
        productCode: 'LAP-001',
        description: 'Laptop',
        quantity: '10',
        unitOfMeasure: 'EA',
        unitPrice: '50000',
        discountAmount: '0',
        taxableAmount: '500000',
        taxes: [],
        lineTotal: '500000',
      },
      {
        lineReference: '2',
        productCode: 'MOU-001',
        description: 'Mouse',
        quantity: '5',
        unitOfMeasure: 'EA',
        unitPrice: '12000',
        discountAmount: '0',
        taxableAmount: '60000',
        taxes: [],
        lineTotal: '60000',
      },
      {
        lineReference: '3',
        productCode: 'KEY-001',
        description: 'Keyboard',
        quantity: '10',
        unitOfMeasure: 'EA',
        unitPrice: '2000',
        discountAmount: '0',
        taxableAmount: '20000',
        taxes: [],
        lineTotal: '20000',
      },
    ],
    amounts: {
      subtotal: '580000',
      discountTotal: '0',
      taxTotal: '0',
      freight: '0',
      roundingAdjustment: '0',
      grandTotal: '580000',
    },
    headerAdjustments: [],
    evidence: [],
  });

  it('validates correct document arithmetic', () => {
    const doc = createBaseDoc();
    const result = checkDocumentArithmetic(doc);
    expect(result.isValid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.computedGrandTotal).toBe('580000');
  });

  it('detects line taxable mismatch (taxable != qty * unitPrice - discount)', () => {
    const doc = createBaseDoc();
    doc.lineItems[0].taxableAmount = '490000'; // wrong taxable
    const result = checkDocumentArithmetic(doc);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.code === 'LINE_TAXABLE_MISMATCH')).toBe(true);
  });

  it('skips / minimally handles grand total check when doc has headerAdjustments (Fix 10)', () => {
    const doc = createBaseDoc();
    // Doc has grandTotal 600000 due to header adjustment of 20000
    doc.amounts.grandTotal = '600000';
    doc.headerAdjustments = [
      {
        type: 'FREIGHT',
        description: 'Air freight express',
        amount: '20000',
        taxes: [],
      },
    ];

    const result = checkDocumentArithmetic(doc);
    // Should NOT flag a false grand total mismatch
    expect(result.skippedHeaderAdjustments).toBe(true);
    expect(result.issues.filter((i) => i.code === 'GRAND_TOTAL_ARITHMETIC_MISMATCH')).toHaveLength(0);
  });

  it('detects shared wrong total when docs agree on an incorrect total', () => {
    // Both docs print grandTotal: 6,30,000, but line items actually sum to 5,80,000
    const doc1 = createBaseDoc();
    doc1.amounts.grandTotal = '630000';

    const doc2 = createBaseDoc();
    doc2.amounts.grandTotal = '630000';

    const sharedWrong = detectSharedWrongTotal([doc1, doc2]);
    expect(sharedWrong.isSharedWrongTotal).toBe(true);
    expect(sharedWrong.printedTotal).toBe('630000');
    expect(sharedWrong.computedTotal).toBe('580000');
    expect(sharedWrong.code).toBe('SHARED_WRONG_TOTAL');
  });
});

