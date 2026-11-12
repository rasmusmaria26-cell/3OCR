import { describe, it, expect } from 'vitest';
import { extractEmailToStageA } from '../src/extractors/emailExtractor.js';
import { MockLlmClient } from '../tests/mocks/mockLlm.js';

describe('Email Extractor with Evidence Verification & Offline Mock (Fix 9)', () => {
  it('extracts via regex fallback and runs full evidence verification', async () => {
    const emailBody = `
Hello Support,
Please process our purchase order PO-8877.
Customer ID: CUST-101
Customer: Acme Industries

Line items requested:
Item: LAP-001
Qty: 10
Price: ₹50,000

Total: ₹5,00,000

Thanks,
Procurement
`;

    const result = await extractEmailToStageA({
      rawText: emailBody,
      documentId: 'doc-email-1',
      receivedAt: '2026-11-11T00:00:00Z',
    });

    expect(result.stageA.order.poNumber).toBe('PO-8877');
    expect(result.stageA.order.customerId).toBe('CUST-101');
    expect(result.stageA.order.currency).toBe('INR');
    expect(result.stageA.lineItems).toHaveLength(1);
    expect(result.stageA.lineItems[0].productCode).toBe('LAP-001');
    expect(result.stageA.lineItems[0].quantity).toBe('10');
    expect(result.stageA.lineItems[0].unitPrice).toBe('50000');

    // Evidence checks
    expect(result.stageA.evidence.length).toBeGreaterThan(0);
    const qtyEvidence = result.stageA.evidence.find((e) => e.fieldPath === 'lineItems[0].quantity');
    expect(qtyEvidence).toBeDefined();
    expect(qtyEvidence?.rawValue).toBe('10');
    expect(qtyEvidence?.extractionMethod).toBe('REGEX');
    expect(result.issues).toHaveLength(0);
  });

  it('runs evidence verification on LLM output and rejects hallucinated values (Fix 9)', async () => {
    const emailBody = 'PO-9999. Please send 10 units of LAP-001.';

    // Mock LLM hallucinates quantity 120 instead of 10
    const mockLlm = new MockLlmClient({
      poNumber: 'PO-9999',
      lineItems: [
        {
          productCode: 'LAP-001',
          quantity: '120', // Hallucinated!
          snippet: 'Please send 10 units of LAP-001.',
          rawValue: '10',
        },
      ],
    });

    const result = await extractEmailToStageA({
      rawText: emailBody,
      documentId: 'doc-email-2',
      receivedAt: '2026-11-11T00:00:00Z',
      llmClient: mockLlm,
    });

    // Since quantity 120 failed decimal equivalence with rawValue 10, it must be null and flagged blocking!
    expect(result.stageA.lineItems[0].quantity).toBeNull();
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].code).toBe('VALUE_MISMATCH');
    expect(result.issues[0].isBlocking).toBe(true);
  });

  it('verifies regex fallback rejects token boundary violations (e.g. 10 in 100)', async () => {
    const emailBody = 'PO: PO-1234. We need 100 items of LAP-001.';
    // If an extractor tried to match '10' from '100 items', token boundary rule blocks it
    const mockLlm = new MockLlmClient({
      poNumber: 'PO-1234',
      lineItems: [
        {
          productCode: 'LAP-001',
          quantity: '10',
          snippet: 'We need 100 items of LAP-001.',
          rawValue: '10',
        },
      ],
    });

    const result = await extractEmailToStageA({
      rawText: emailBody,
      documentId: 'doc-email-3',
      receivedAt: '2026-11-11T00:00:00Z',
      llmClient: mockLlm,
    });

    expect(result.stageA.lineItems[0].quantity).toBeNull();
    expect(result.issues[0].code).toBe('TOKEN_BOUNDARY_VIOLATION');
  });

  it('extracts currency, prices, dates, and grandTotal via LLM and attaches LLM evidence', async () => {
    const emailBody = `
PO-5555
Date: 2026-11-10
Customer ID: CUST-777
Customer: Global Tech
Please send 5 units of LAP-001 at $500 each.
Total: $2500
`;

    const mockLlm = new MockLlmClient({
      poNumber: 'PO-5555',
      poDate: '2026-11-10',
      customerId: 'CUST-777',
      customerName: 'Global Tech',
      currency: 'USD',
      lineItems: [
        {
          productCode: 'LAP-001',
          quantity: '5',
          unitPrice: '$500',
          snippet: 'Please send 5 units of LAP-001 at $500 each.',
          rawValue: '5',
        },
      ],
      amounts: {
        grandTotal: '$2500',
        snippet: 'Total: $2500',
        rawValue: '$2500',
      },
    });

    const result = await extractEmailToStageA({
      rawText: emailBody,
      documentId: 'doc-email-4',
      receivedAt: '2026-11-11T00:00:00Z',
      llmClient: mockLlm,
    });

    expect(result.stageA.order.poNumber).toBe('PO-5555');
    expect(result.stageA.order.currency).toBe('USD');
    expect(result.stageA.order.customerName).toBe('Global Tech');
    expect(result.stageA.lineItems[0].quantity).toBe('5');
    expect(result.stageA.amounts.grandTotal).toBe('2500');

    // Evidence extractionMethod must be LLM
    const currEv = result.stageA.evidence.find((e) => e.fieldPath === 'order.currency');
    expect(currEv).toBeDefined();
    expect(currEv?.extractionMethod).toBe('LLM');
  });
});

