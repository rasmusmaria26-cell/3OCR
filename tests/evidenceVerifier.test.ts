import { describe, it, expect } from 'vitest';
import {
  findTokenBoundaryOccurrences,
  verifyEvidence,
  getPageForOffset,
} from '../src/core/verification/evidenceVerifier.js';

describe('Evidence Verifier & Token Boundary (Fix 1 & Fix 6)', () => {
  describe('Token Boundary Rules (don\'t use \\b)', () => {
    it('fails to match "10" inside "10.50"', () => {
      const occurrences = findTokenBoundaryOccurrences('Total: 10.50 USD', '10', true);
      expect(occurrences).toHaveLength(0);
    });

    it('fails to match "10" inside "100"', () => {
      const occurrences = findTokenBoundaryOccurrences('Quantity: 100 items', '10', true);
      expect(occurrences).toHaveLength(0);
    });

    it('fails to match "10" inside "1,10,000"', () => {
      const occurrences = findTokenBoundaryOccurrences('Amount is ₹1,10,000', '10', true);
      expect(occurrences).toHaveLength(0);
    });

    it('fails to match "10" inside ".10"', () => {
      const occurrences = findTokenBoundaryOccurrences('Amount is .10 USD', '10', true);
      expect(occurrences).toHaveLength(0);
    });

    it('fails to match "10" inside ",10"', () => {
      const occurrences = findTokenBoundaryOccurrences('Amount is ,10 USD', '10', true);
      expect(occurrences).toHaveLength(0);
    });

    it('successfully matches "10" when followed by punctuation not attached to a digit', () => {
      const occurrences = findTokenBoundaryOccurrences('We need 10, please deliver soon.', '10', true);
      expect(occurrences).toHaveLength(1);
      expect(occurrences[0].start).toBe(8);
      expect(occurrences[0].end).toBe(10);
    });

    it('successfully matches "10" at sentence boundary', () => {
      const occurrences = findTokenBoundaryOccurrences('Order count is 10.', '10', true);
      expect(occurrences).toHaveLength(1);
      expect(occurrences[0].start).toBe(15);
      expect(occurrences[0].end).toBe(17);
    });

    it('successfully matches "10" prefixed by currency symbol', () => {
      const occurrences = findTokenBoundaryOccurrences('Price is $10 per unit', '10', true);
      expect(occurrences).toHaveLength(1);
      expect(occurrences[0].start).toBe(10);
      expect(occurrences[0].end).toBe(12);
    });
  });

  describe('Page Mapping from Page Break Offsets (Fix 6)', () => {
    const pageBreakOffsets = [0, 500, 1200]; // Page 1: 0..499, Page 2: 500..1199, Page 3: 1200+

    it('returns correct page for offsets', () => {
      expect(getPageForOffset(50, pageBreakOffsets)).toBe(1);
      expect(getPageForOffset(500, pageBreakOffsets)).toBe(2);
      expect(getPageForOffset(850, pageBreakOffsets)).toBe(2);
      expect(getPageForOffset(1200, pageBreakOffsets)).toBe(3);
      expect(getPageForOffset(1500, pageBreakOffsets)).toBe(3);
    });

    it('defaults to page 1 if no offsets are given', () => {
      expect(getPageForOffset(500, null)).toBe(1);
      expect(getPageForOffset(500, [])).toBe(1);
    });
  });

  describe('Complete Evidence Verification', () => {
    const documentText = 'Purchase Order PO-9876\nCustomer: Acme Corp\nItem: LAP-001\nQty: 10\nUnit Price: $500\nTotal: $5000\n';

    it('passes when snippet is exact substring, rawValue bounded, and decimal matches', () => {
      const result = verifyEvidence({
        documentText,
        snippet: 'Qty: 10\n',
        rawValue: '10',
        expectedValue: '10',
        isNumeric: true,
        fieldPath: 'lineItems[0].quantity',
        isBlockingField: true,
      });

      expect(result.isValid).toBe(true);
      expect(result.charStart).toBe( documentText.indexOf('10') );
      expect(result.charEnd).toBe( documentText.indexOf('10') + 2 );
      expect(result.issue).toBeNull();
    });

    it('fails when snippet does not exist in document text', () => {
      const result = verifyEvidence({
        documentText,
        snippet: 'Non-existent snippet in document',
        rawValue: '10',
        expectedValue: '10',
        isNumeric: true,
        fieldPath: 'lineItems[0].quantity',
        isBlockingField: true,
      });

      expect(result.isValid).toBe(false);
      expect(result.issue).toBeDefined();
      expect(result.issue?.code).toBe('SNIPPET_NOT_FOUND');
      expect(result.issue?.isBlocking).toBe(true);
    });

    it('fails when rawValue is inside 100 and expected is 10 (token boundary block)', () => {
      const docWith100 = 'Qty: 100 units\n';
      const result = verifyEvidence({
        documentText: docWith100,
        snippet: 'Qty: 100 units\n',
        rawValue: '10',
        expectedValue: '10',
        isNumeric: true,
        fieldPath: 'lineItems[0].quantity',
        isBlockingField: true,
      });

      expect(result.isValid).toBe(false);
      expect(result.issue?.code).toBe('TOKEN_BOUNDARY_VIOLATION');
      expect(result.issue?.isBlocking).toBe(true);
    });

    it('fails when extractor snippet is "10" but in documentText it is inside 1000 (Fix 1 verification attack)', () => {
      const result = verifyEvidence({
        documentText: 'Total: 1000 USD',
        snippet: '10',
        rawValue: '10',
        expectedValue: '10',
        isNumeric: true,
        fieldPath: 'lineItems[0].quantity',
        isBlockingField: true,
      });

      expect(result.isValid).toBe(false);
      expect(result.issue?.code).toBe('TOKEN_BOUNDARY_VIOLATION');
      expect(result.issue?.isBlocking).toBe(true);
    });

    it('fails when extractor snippet is "10" but in documentText it is inside 10.50 (Fix 1 verification attack)', () => {
      const result = verifyEvidence({
        documentText: 'Total: 10.50 USD',
        snippet: '10',
        rawValue: '10',
        expectedValue: '10',
        isNumeric: true,
        fieldPath: 'lineItems[0].quantity',
        isBlockingField: true,
      });

      expect(result.isValid).toBe(false);
      expect(result.issue?.code).toBe('TOKEN_BOUNDARY_VIOLATION');
      expect(result.issue?.isBlocking).toBe(true);
    });

    it('fails when extractor snippet is "10" but in documentText it is inside 1,10,000 (Fix 1 verification attack)', () => {
      const result = verifyEvidence({
        documentText: 'Total: 1,10,000 USD',
        snippet: '10',
        rawValue: '10',
        expectedValue: '10',
        isNumeric: true,
        fieldPath: 'lineItems[0].quantity',
        isBlockingField: true,
      });

      expect(result.isValid).toBe(false);
      expect(result.issue?.code).toBe('TOKEN_BOUNDARY_VIOLATION');
      expect(result.issue?.isBlocking).toBe(true);
    });

    it('fails when decimal parsed value does not match expected value (extracted 120 vs evidence 10)', () => {
      const result = verifyEvidence({
        documentText,
        snippet: 'Qty: 10\n',
        rawValue: '10',
        expectedValue: '120', // LLM hallucinated 120 while text has 10
        isNumeric: true,
        fieldPath: 'lineItems[0].quantity',
        isBlockingField: true,
      });

      expect(result.isValid).toBe(false);
      expect(result.issue?.code).toBe('VALUE_MISMATCH');
      expect(result.issue?.candidateValue).toBe('120');
      expect(result.issue?.rawValue).toBe('10');
      expect(result.issue?.isBlocking).toBe(true);
    });
  });
});

