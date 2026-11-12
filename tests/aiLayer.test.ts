import { describe, it, expect } from 'vitest';
import { GeminiClient } from '../src/core/ai/geminiClient.js';
import { explainDiscrepancy } from '../src/core/ai/discrepancyExplainer.js';
import { extractDocumentWithAi } from '../src/core/ai/aiExtractor.js';
import { ReconcilerIssue } from '../src/core/engine/reconciler.js';

describe('AI Layer & Discrepancy Explainer', () => {
  it('correctly reports availability based on API key configuration', () => {
    const unconfiguredClient = new GeminiClient('');
    expect(unconfiguredClient.isAvailable()).toBe(false);

    const configuredClient = new GeminiClient('test-key-123');
    expect(configuredClient.isAvailable()).toBe(true);
  });

  it('generates deterministic explanation for ITEM_IN_EMAIL_MISSING_FROM_COMPLETE_PDF', async () => {
    const unconfiguredClient = new GeminiClient('');
    const issue: ReconcilerIssue = {
      fingerprint: 'fp-1',
      issueType: 'ITEM_IN_EMAIL_MISSING_FROM_COMPLETE_PDF',
      field: 'lineItems',
      lineReference: '2',
      normalizedSku: 'MOU-001',
      docVersionIds: ['doc-email', 'doc-pdf'],
      message: 'SKU MOU-001 ordered in email is missing from complete PDF',
      isBlocking: false,
      isResolvedByReview: false,
    };

    const explanation = await explainDiscrepancy(
      {
        poNumber: 'PO-9307',
        customerId: 'CUST-101',
        issue,
      },
      unconfiguredClient
    );

    expect(explanation.issueFingerprint).toBe('fp-1');
    expect(explanation.summary).toContain('SKU MOU-001 was requested in the email correspondence but is completely absent from the official PDF');
    expect(explanation.recommendation).toContain('Verify if the customer added SKU MOU-001 in an email modification');
    expect(explanation.isAiGenerated).toBe(false);
  });

  it('generates deterministic explanation for GRAND_TOTAL_ARITHMETIC_MISMATCH', async () => {
    const unconfiguredClient = new GeminiClient('');
    const issue: ReconcilerIssue = {
      fingerprint: 'fp-2',
      issueType: 'GRAND_TOTAL_ARITHMETIC_MISMATCH',
      field: 'amounts.grandTotal',
      candidateValues: { expected: '1600.00', actual: '1700.00' },
      docVersionIds: ['doc-pdf'],
      message: 'Document printed grand total (1700.00) does not match sum of lines (1600.00)',
      isBlocking: false,
      isResolvedByReview: false,
    };

    const explanation = await explainDiscrepancy(
      {
        poNumber: 'PO-9307',
        customerId: 'CUST-101',
        issue,
      },
      unconfiguredClient
    );

    expect(explanation.issueFingerprint).toBe('fp-2');
    expect(explanation.summary).toContain('printed grand total on the document does not equal the arithmetic sum');
    expect(explanation.recommendation).toContain('Check for unlisted charges, freight, or discounts');
  });

  it('handles aiExtractor gracefully when API key is missing', async () => {
    const unconfiguredClient = new GeminiClient('');
    const res = await extractDocumentWithAi(
      {
        documentId: 'doc-123',
        sourceType: 'PDF',
        rawText: 'Purchase Order PO-100',
      },
      unconfiguredClient
    );

    expect(res.isAiSuccess).toBe(false);
    expect(res.error).toBe('GEMINI_API_KEY is not configured');
  });
});
