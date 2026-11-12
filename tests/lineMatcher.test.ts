import { describe, it, expect } from 'vitest';
import { matchDocumentLines } from '../src/core/engine/lineMatcher.js';

describe('Deterministic Line Matcher', () => {
  it('matches lines correctly even when row positions are swapped', () => {
    const docALines = [
      { sku: 'LAP-001', qty: '10', unitPrice: '500', uom: 'EA', taxes: [] },
      { sku: 'MOU-001', qty: '20', unitPrice: '25', uom: 'EA', taxes: [] },
    ];

    const docBLines = [
      { sku: 'MOU-001', qty: '20', unitPrice: '25', uom: 'EA', taxes: [] },
      { sku: 'LAP-001', qty: '10', unitPrice: '500', uom: 'EA', taxes: [] },
    ];

    const result = matchDocumentLines(docALines, docBLines);
    expect(result.matchedPairs).toHaveLength(2);
    expect(result.unmatchedA).toHaveLength(0);
    expect(result.unmatchedB).toHaveLength(0);
    expect(result.reviewIssues).toHaveLength(0);

    const lapPair = result.matchedPairs.find((p) => p.sku === 'LAP-001');
    expect(lapPair?.lineA.qty).toBe('10');
    expect(lapPair?.lineB.qty).toBe('10');
  });

  it('aggregates duplicate SKUs when price, UOM, and taxes are compatible', () => {
    // Doc A has 2 entries for LAP-001 at same price and UOM (e.g. split shipment)
    const docALines = [
      { sku: 'LAP-001', qty: '4', unitPrice: '500', uom: 'EA', taxes: [] },
      { sku: 'LAP-001', qty: '6', unitPrice: '500', uom: 'EA', taxes: [] },
    ];

    const docBLines = [
      { sku: 'LAP-001', qty: '10', unitPrice: '500', uom: 'EA', taxes: [] },
    ];

    const result = matchDocumentLines(docALines, docBLines);
    expect(result.matchedPairs).toHaveLength(1);
    expect(result.matchedPairs[0].aggregatedA?.totalQty).toBe('10');
    expect(result.matchedPairs[0].lineB.qty).toBe('10');
    expect(result.reviewIssues).toHaveLength(0);
  });

  it('flags REVIEW_REQUIRED when duplicate SKUs have incompatible unit prices', () => {
    const docALines = [
      { sku: 'LAP-001', qty: '4', unitPrice: '500', uom: 'EA', taxes: [] },
      { sku: 'LAP-001', qty: '6', unitPrice: '450', uom: 'EA', taxes: [] }, // different price basis
    ];

    const docBLines = [
      { sku: 'LAP-001', qty: '10', unitPrice: '500', uom: 'EA', taxes: [] },
    ];

    const result = matchDocumentLines(docALines, docBLines);
    expect(result.reviewIssues).toHaveLength(1);
    expect(result.reviewIssues[0].code).toBe('DUPLICATE_SKU_INCOMPATIBLE');
  });

  it('flags unmatched lines cleanly when one document has missing or extra items', () => {
    const docALines = [
      { sku: 'LAP-001', qty: '10', unitPrice: '500', uom: 'EA', taxes: [] },
      { sku: 'ACC-001', qty: '2', unitPrice: '50', uom: 'EA', taxes: [] },
    ];

    const docBLines = [
      { sku: 'LAP-001', qty: '10', unitPrice: '500', uom: 'EA', taxes: [] },
    ];

    const result = matchDocumentLines(docALines, docBLines);
    expect(result.matchedPairs).toHaveLength(1);
    expect(result.unmatchedA).toHaveLength(1);
    expect(result.unmatchedA[0].sku).toBe('ACC-001');
    expect(result.unmatchedB).toHaveLength(0);
  });
});

