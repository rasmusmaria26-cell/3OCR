import { describe, it, expect } from 'vitest';
import { computeIssueFingerprint } from '../src/core/engine/fingerprint.js';

describe('Deterministic Issue Fingerprint (Fix 3)', () => {
  it('generates the exact same fingerprint regardless of document version order', () => {
    const fp1 = computeIssueFingerprint({
      issueType: 'QUANTITY_MISMATCH',
      field: 'quantity',
      normalizedSku: 'LAP-001',
      docVersionIds: ['doc-pdf-1', 'doc-email-2'],
    });

    const fp2 = computeIssueFingerprint({
      issueType: 'QUANTITY_MISMATCH',
      field: 'quantity',
      normalizedSku: 'LAP-001',
      docVersionIds: ['doc-email-2', 'doc-pdf-1'], // reversed order
    });

    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(64); // 256-bit hex
  });

  it('differentiates by SKU', () => {
    const fp1 = computeIssueFingerprint({
      issueType: 'QUANTITY_MISMATCH',
      field: 'quantity',
      normalizedSku: 'LAP-001',
      docVersionIds: ['doc-1', 'doc-2'],
    });

    const fp2 = computeIssueFingerprint({
      issueType: 'QUANTITY_MISMATCH',
      field: 'quantity',
      normalizedSku: 'LAP-002',
      docVersionIds: ['doc-1', 'doc-2'],
    });

    expect(fp1).not.toBe(fp2);
  });

  it('handles issues without SKU (document-level issues like grand total)', () => {
    const fp = computeIssueFingerprint({
      issueType: 'GRAND_TOTAL_MISMATCH',
      field: 'amounts.grandTotal',
      normalizedSku: null,
      docVersionIds: ['doc-1', 'doc-2'],
    });

    expect(fp).toBeDefined();
    expect(fp).toHaveLength(64);
  });
});

