import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from '../src/db/database.js';
import { reconcileCase, ReconcilerIssue } from '../src/core/engine/reconciler.js';
import { StageADocument } from '../src/core/schema/stageA.schema.js';
import { Database as DatabaseType } from 'better-sqlite3';

describe('Deterministic Reconciliation Engine (Comprehensive Suite)', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = createDatabase(':memory:');

    // Customer config
    db.prepare(`
      INSERT INTO customer_config (customer_id, default_currency, default_uom, separators_insignificant, config_version, created_at, updated_at)
      VALUES ('CUST-101', 'USD', 'EA', 0, '1.0', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    // Product alias: "laptop standard" -> "LAP-001"
    db.prepare(`
      INSERT INTO product_aliases (id, customer_id, alias_text, normalized_sku, config_version, created_at)
      VALUES ('pa-1', 'CUST-101', 'laptop standard', 'LAP-001', '1.0', '2026-11-11T00:00:00Z')
    `).run();
  });

  const createDoc = (opts: {
    id: string;
    type: 'EMAIL' | 'PDF' | 'JSON';
    po?: string;
    currency?: string;
    lines: Array<{ sku?: string | null; desc?: string | null; qty: string; price?: string; uom?: string }>;
    grandTotal?: string | null;
    hasBlockingIssue?: boolean;
    headerAdjustments?: any[];
  }): StageADocument => {
    const computedTotal = opts.lines
      .reduce((acc, l) => acc + parseFloat(l.qty) * parseFloat(l.price || '500'), 0)
      .toFixed();

    const grandTotal =
      opts.grandTotal !== undefined
        ? opts.grandTotal
        : opts.type === 'EMAIL'
        ? null
        : computedTotal;

    return {
      schemaVersion: '1.0',
      source: {
        documentId: opts.id,
        sourceType: opts.type,
        receivedAt: '2026-11-11T00:00:00Z',
        fileHash: null,
        messageId: null,
        contentHash: null,
        senderEmail: null,
        extractedTextId: null,
      },
      order: {
        poNumber: opts.po || 'PO-1001',
        poDate: '2026-11-10',
        customerId: 'CUST-101',
        customerName: 'Acme',
        currency: opts.currency || 'USD',
      },
      lineItems: opts.lines.map((l, i) => ({
        lineReference: `${i + 1}`,
        productCode: l.sku !== undefined ? l.sku : 'LAP-001',
        description: l.desc !== undefined ? l.desc : 'Laptop',
        quantity: l.qty,
        unitOfMeasure: l.uom || 'EA',
        unitPrice: l.price || '500',
        discountAmount: '0',
        taxableAmount: (parseFloat(l.qty) * parseFloat(l.price || '500')).toFixed(),
        taxes: [],
        lineTotal: (parseFloat(l.qty) * parseFloat(l.price || '500')).toFixed(),
      })),
      amounts: {
        subtotal: grandTotal,
        discountTotal: '0',
        taxTotal: '0',
        freight: '0',
        roundingAdjustment: '0',
        grandTotal,
      },
      headerAdjustments: opts.headerAdjustments || [],
      evidence: [],
    };
  };

  it('1. Reconciles exact match across Email, PDF, and JSON to MATCHED', () => {
    const email = createDoc({ id: 'email-1', type: 'EMAIL', lines: [{ sku: 'LAP-001', qty: '10', price: '500' }] });
    const pdf = createDoc({ id: 'pdf-1', type: 'PDF', lines: [{ sku: 'LAP-001', qty: '10', price: '500' }] });
    const json = createDoc({ id: 'json-1', type: 'JSON', lines: [{ sku: 'LAP-001', qty: '10', price: '500' }] });

    const result = reconcileCase({
      db,
      customerId: 'CUST-101',
      poNumber: 'PO-1001',
      documents: [email, pdf, json],
      expectedSources: ['EMAIL', 'PDF', 'JSON'],
    });

    expect(result.status).toBe('MATCHED');
    expect(result.issues).toHaveLength(0);
    expect(result.summary.unresolvedIssuesCount).toBe(0);
  });

  it('2. Matches swapped row order deterministically', () => {
    const pdf = createDoc({
      id: 'pdf-2',
      type: 'PDF',
      lines: [
        { sku: 'LAP-001', qty: '10', price: '500' },
        { sku: 'MOU-001', qty: '20', price: '25' },
      ],
      grandTotal: '5500',
    });

    const json = createDoc({
      id: 'json-2',
      type: 'JSON',
      lines: [
        { sku: 'MOU-001', qty: '20', price: '25' }, // Swapped position
        { sku: 'LAP-001', qty: '10', price: '500' },
      ],
      grandTotal: '5500',
    });

    const result = reconcileCase({
      db,
      customerId: 'CUST-101',
      poNumber: 'PO-1001',
      documents: [pdf, json],
      expectedSources: ['PDF', 'JSON'],
    });

    expect(result.status).toBe('MATCHED');
    expect(result.issues).toHaveLength(0);
  });

  it('3. Flags quantity mismatch between documents as MISMATCH', () => {
    const pdf = createDoc({ id: 'pdf-3', type: 'PDF', lines: [{ sku: 'LAP-001', qty: '10', price: '500' }] });
    const json = createDoc({ id: 'json-3', type: 'JSON', lines: [{ sku: 'LAP-001', qty: '12', price: '500' }] });

    const result = reconcileCase({
      db,
      customerId: 'CUST-101',
      poNumber: 'PO-1001',
      documents: [pdf, json],
      expectedSources: ['PDF', 'JSON'],
    });

    expect(result.status).toBe('MISMATCH');
    expect(result.issues.some((i) => i.issueType === 'QUANTITY_MISMATCH')).toBe(true);
  });

  it('4. Completeness: Partial email item list vs complete PDF is valid (MATCHED)', () => {
    // Email mentions only 1 item, PDF has 2 items -> valid because email is partial
    const email = createDoc({ id: 'email-4', type: 'EMAIL', lines: [{ sku: 'LAP-001', qty: '10', price: '500' }] });
    const pdf = createDoc({
      id: 'pdf-4',
      type: 'PDF',
      lines: [
        { sku: 'LAP-001', qty: '10', price: '500' },
        { sku: 'MOU-001', qty: '5', price: '25' },
      ],
      grandTotal: '5125',
    });

    const result = reconcileCase({
      db,
      customerId: 'CUST-101',
      poNumber: 'PO-1001',
      documents: [email, pdf],
      expectedSources: ['EMAIL', 'PDF'],
    });

    expect(result.status).toBe('MATCHED');
    expect(result.issues).toHaveLength(0);
  });

  it('5. Completeness: PDF 3 items vs JSON 2 items flags MISMATCH', () => {
    const pdf = createDoc({
      id: 'pdf-5',
      type: 'PDF',
      lines: [
        { sku: 'LAP-001', qty: '10', price: '500' },
        { sku: 'MOU-001', qty: '5', price: '25' },
        { sku: 'KEY-001', qty: '5', price: '50' },
      ],
      grandTotal: '5375',
    });

    const json = createDoc({
      id: 'json-5',
      type: 'JSON',
      lines: [
        { sku: 'LAP-001', qty: '10', price: '500' },
        { sku: 'MOU-001', qty: '5', price: '25' },
      ],
      grandTotal: '5125',
    });

    const result = reconcileCase({
      db,
      customerId: 'CUST-101',
      poNumber: 'PO-1001',
      documents: [pdf, json],
      expectedSources: ['PDF', 'JSON'],
    });

    expect(result.status).toBe('MISMATCH');
    expect(result.issues.some((i) => i.issueType === 'MISSING_LINE_ITEM')).toBe(true);
  });

  it('6. Resolves null product code via approved customer alias', () => {
    // Email has no product code, but description is "laptop standard", which resolves to LAP-001
    const email = createDoc({
      id: 'email-6',
      type: 'EMAIL',
      lines: [{ sku: null, desc: 'laptop standard', qty: '10', price: '500' }],
    });

    const pdf = createDoc({
      id: 'pdf-6',
      type: 'PDF',
      lines: [{ sku: 'LAP-001', desc: 'LAP-001 Laptop', qty: '10', price: '500' }],
    });

    const result = reconcileCase({
      db,
      customerId: 'CUST-101',
      poNumber: 'PO-1001',
      documents: [email, pdf],
      expectedSources: ['EMAIL', 'PDF'],
    });

    expect(result.status).toBe('MATCHED');
    expect(result.issues).toHaveLength(0);
  });

  it('7. Currency mismatch ($500 vs ₹500) flags REVIEW_REQUIRED', () => {
    const pdf = createDoc({ id: 'pdf-7', type: 'PDF', currency: 'USD', lines: [{ sku: 'LAP-001', qty: '10', price: '500' }] });
    const json = createDoc({ id: 'json-7', type: 'JSON', currency: 'INR', lines: [{ sku: 'LAP-001', qty: '10', price: '500' }] });

    const result = reconcileCase({
      db,
      customerId: 'CUST-101',
      poNumber: 'PO-1001',
      documents: [pdf, json],
      expectedSources: ['PDF', 'JSON'],
    });

    // Per spec: Different currencies = review
    expect(result.status).toBe('REVIEW_REQUIRED');
    expect(result.issues.some((i) => i.issueType === 'CURRENCY_MISMATCH')).toBe(true);
  });

  it('8. Shows MISMATCH while JSON is pending (with waiting for JSON indicator)', () => {
    // Only email and PDF arrived, with a quantity mismatch; JSON is expected
    const email = createDoc({ id: 'email-8', type: 'EMAIL', lines: [{ sku: 'LAP-001', qty: '8', price: '500' }] });
    const pdf = createDoc({ id: 'pdf-8', type: 'PDF', lines: [{ sku: 'LAP-001', qty: '10', price: '500' }] });

    const result = reconcileCase({
      db,
      customerId: 'CUST-101',
      poNumber: 'PO-1001',
      documents: [email, pdf],
      expectedSources: ['EMAIL', 'PDF', 'JSON'],
    });

    expect(result.status).toBe('MISMATCH');
    expect(result.isWaitingForJson).toBe(true);
  });

  it('9. Supports human review decision keying on issue fingerprint and reopens case on new mismatch (Fix 3 & Fix 5)', () => {
    // Step 1: Ingest PDF and JSON with quantity mismatch
    const pdf = createDoc({ id: 'pdf-9', type: 'PDF', lines: [{ sku: 'LAP-001', qty: '10', price: '500' }] });
    const json = createDoc({ id: 'json-9', type: 'JSON', lines: [{ sku: 'LAP-001', qty: '12', price: '500' }] });

    const result1 = reconcileCase({
      db,
      customerId: 'CUST-101',
      poNumber: 'PO-1001',
      documents: [pdf, json],
      expectedSources: ['PDF', 'JSON'],
    });

    expect(result1.status).toBe('MISMATCH');
    expect(result1.issues.length).toBeGreaterThan(0);

    // Step 2: Insert review decisions for all generated issues keyed by their deterministic fingerprints
    db.prepare(`
      INSERT INTO processing_cases (id, customer_id, po_number, status, expected_sources, created_at, updated_at)
      VALUES ('case-9', 'CUST-101', 'PO-1001', 'MISMATCH', '["PDF","JSON"]', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    const insertDecisionStmt = db.prepare(`
      INSERT INTO review_decisions (id, case_id, issue_fingerprint, field, line_reference, previous_value, selected_value, reason, reviewer, document_version_ids, created_at)
      VALUES (?, 'case-9', ?, ?, '1', 'prev', 'selected', 'Reviewed and approved by human', 'alice', '["pdf-9","json-9"]', '2026-11-11T00:00:00Z')
    `);

    result1.issues.forEach((issue, idx) => {
      insertDecisionStmt.run(`rev-${idx + 1}`, issue.fingerprint, issue.field);
    });

    // Step 3: Re-reconcile with active review decisions
    const result2 = reconcileCase({
      db,
      caseId: 'case-9',
      customerId: 'CUST-101',
      poNumber: 'PO-1001',
      documents: [pdf, json],
      expectedSources: ['PDF', 'JSON'],
    });

    // All issues are now resolved by the human review decisions!
    expect(result2.status).toBe('RESOLVED');
    expect(result2.issues.every((i) => i.isResolvedByReview)).toBe(true);
    expect(result2.summary.unresolvedIssuesCount).toBe(0);

    // Save the resolved status to the case in the DB
    db.prepare("UPDATE processing_cases SET status = 'RESOLVED' WHERE id = 'case-9'").run();

    // Step 4: A NEW document arrives (email claiming qty 15) introducing a NEW mismatch
    const emailLate = createDoc({ id: 'email-late', type: 'EMAIL', lines: [{ sku: 'LAP-001', qty: '15', price: '500' }] });
    const result3 = reconcileCase({
      db,
      caseId: 'case-9',
      customerId: 'CUST-101',
      poNumber: 'PO-1001',
      documents: [pdf, json, emailLate],
      expectedSources: ['EMAIL', 'PDF', 'JSON'],
    });

    // The case is reopened to MISMATCH without erasing past review decisions!
    expect(result3.status).toBe('MISMATCH');
    expect(result3.wasReopened).toBe(true);
  });

  it('10. Reconciles Email vs complete JSON when PDF is pending (Fix for partial email vs complete JSON)', () => {
    // Email has LAP-001 (qty 10) and an extra item KEY-001 (qty 2)
    const email = createDoc({
      id: 'email-10',
      type: 'EMAIL',
      lines: [
        { sku: 'LAP-001', qty: '10', price: '500' },
        { sku: 'KEY-001', qty: '2', price: '50' },
      ],
    });

    // Complete JSON order has LAP-001 but missing KEY-001
    const json = createDoc({
      id: 'json-10',
      type: 'JSON',
      lines: [
        { sku: 'LAP-001', qty: '10', price: '500' },
      ],
      grandTotal: '5000',
    });

    const result = reconcileCase({
      db,
      customerId: 'CUST-101',
      poNumber: 'PO-1001',
      documents: [email, json],
      expectedSources: ['EMAIL', 'JSON'],
    });

    expect(result.status).toBe('MISMATCH');
    expect(result.issues.some((i) => i.issueType === 'ITEM_IN_EMAIL_MISSING_FROM_COMPLETE_JSON')).toBe(true);
  });

  it('11. Forces REVIEW_REQUIRED when DB contains a blocking extraction issue', () => {
    const pdf = createDoc({ id: 'pdf-11', type: 'PDF', lines: [{ sku: 'LAP-001', qty: '10', price: '500' }] });
    const json = createDoc({ id: 'json-11', type: 'JSON', lines: [{ sku: 'LAP-001', qty: '10', price: '500' }] });

    // Insert document row & blocking extraction issue into DB
    db.prepare(`
      INSERT INTO documents (id, source_type, status, received_at, created_at)
      VALUES ('pdf-11', 'PDF', 'VALID', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    db.prepare(`
      INSERT INTO extraction_issues (id, document_id, field_path, code, is_blocking, created_at)
      VALUES ('ext-iss-1', 'pdf-11', 'lineItems[0].quantity', 'TOKEN_BOUNDARY_VIOLATION', 1, '2026-11-11T00:00:00Z')
    `).run();

    const result = reconcileCase({
      db,
      customerId: 'CUST-101',
      poNumber: 'PO-1001',
      documents: [pdf, json],
      expectedSources: ['PDF', 'JSON'],
    });

    expect(result.status).toBe('REVIEW_REQUIRED');
    expect(result.issues.some((i) => i.issueType === 'TOKEN_BOUNDARY_VIOLATION')).toBe(true);
  });

  it('12. Resolves alias when productCode itself contains the alias text', () => {
    // PDF has productCode: "laptop standard" which is seeded to resolve to LAP-001
    const pdf = createDoc({
      id: 'pdf-12',
      type: 'PDF',
      lines: [{ sku: 'laptop standard', desc: 'Laptop', qty: '10', price: '500' }],
    });

    const json = createDoc({
      id: 'json-12',
      type: 'JSON',
      lines: [{ sku: 'LAP-001', desc: 'LAP-001 Laptop', qty: '10', price: '500' }],
    });

    const result = reconcileCase({
      db,
      customerId: 'CUST-101',
      poNumber: 'PO-1001',
      documents: [pdf, json],
      expectedSources: ['PDF', 'JSON'],
    });

    expect(result.status).toBe('MATCHED');
    expect(result.issues).toHaveLength(0);
  });

  it('13. Reconciles documents with Phase 3 header adjustments and taxes matching grand total', () => {
    const pdf = createDoc({
      id: 'pdf-13',
      type: 'PDF',
      lines: [{ sku: 'LAP-001', desc: 'LAP-001 Laptop', qty: '10', price: '500' }],
      headerAdjustments: [
        {
          type: 'FREIGHT',
          description: 'Express Delivery',
          amount: '500.00',
          taxes: [{ type: 'IGST', rate: '18.00', amount: '90.00' }],
        },
      ],
      grandTotal: '5590.00', // 5000 lines + 500 freight + 90 freight tax = 5590.00
    });
    pdf.amounts.subtotal = '5000.00';
    pdf.amounts.freight = '500.00';
    pdf.amounts.taxTotal = '90.00';

    const json = createDoc({
      id: 'json-13',
      type: 'JSON',
      lines: [{ sku: 'LAP-001', desc: 'LAP-001 Laptop', qty: '10', price: '500' }],
      headerAdjustments: [
        {
          type: 'FREIGHT',
          description: 'Express Delivery',
          amount: '500.00',
          taxes: [{ type: 'IGST', rate: '18.00', amount: '90.00' }],
        },
      ],
      grandTotal: '5590.00',
    });
    json.amounts.subtotal = '5000.00';
    json.amounts.freight = '500.00';
    json.amounts.taxTotal = '90.00';

    const result = reconcileCase({
      db,
      customerId: 'CUST-101',
      poNumber: 'PO-1001',
      documents: [pdf, json],
      expectedSources: ['PDF', 'JSON'],
    });

    expect(result.status).toBe('MATCHED');
    expect(result.issues).toHaveLength(0);
  });

  it('14. Flags MISMATCH when Phase 3 header calculation detects grand total discrepancy', () => {
    const pdf = createDoc({
      id: 'pdf-14',
      type: 'PDF',
      lines: [{ sku: 'LAP-001', desc: 'LAP-001 Laptop', qty: '10', price: '500' }],
      headerAdjustments: [
        {
          type: 'FREIGHT',
          description: 'Express Delivery',
          amount: '500.00',
          taxes: [{ type: 'IGST', rate: '18.00', amount: '90.00' }],
        },
      ],
      grandTotal: '5999.00', // Out of tolerance from 5590.00
    });
    pdf.amounts.subtotal = '5000.00';
    pdf.amounts.freight = '500.00';
    pdf.amounts.taxTotal = '90.00';

    const json = createDoc({
      id: 'json-14',
      type: 'JSON',
      lines: [{ sku: 'LAP-001', desc: 'LAP-001 Laptop', qty: '10', price: '500' }],
      headerAdjustments: [
        {
          type: 'FREIGHT',
          description: 'Express Delivery',
          amount: '500.00',
          taxes: [{ type: 'IGST', rate: '18.00', amount: '90.00' }],
        },
      ],
      grandTotal: '5590.00',
    });
    json.amounts.subtotal = '5000.00';
    json.amounts.freight = '500.00';
    json.amounts.taxTotal = '90.00';

    const result = reconcileCase({
      db,
      customerId: 'CUST-101',
      poNumber: 'PO-1001',
      documents: [pdf, json],
      expectedSources: ['PDF', 'JSON'],
    });

    expect(result.status).toBe('MISMATCH');
    expect(result.issues.some((i) => i.issueType === 'GRAND_TOTAL_ARITHMETIC_MISMATCH')).toBe(true);
  });
});
