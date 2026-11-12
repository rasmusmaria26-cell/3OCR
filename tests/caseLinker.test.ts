import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from '../src/db/database.js';
import { resolveOrCreateCase, linkDocumentToCase } from '../src/core/linking/caseLinker.js';
import { Database as DatabaseType } from 'better-sqlite3';

describe('Case Linker & Simultaneous Arrivals (Fix 4 & Fix 11)', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = createDatabase(':memory:');
  });

  it('rejects case creation with null or empty customer ID', () => {
    expect(() => {
      resolveOrCreateCase(db, { customerId: null as any, poNumber: 'PO-1001' });
    }).toThrow(/Customer ID is required/i);

    expect(() => {
      resolveOrCreateCase(db, { customerId: '', poNumber: 'PO-1001' });
    }).toThrow(/Customer ID is required/i);
  });

  it('rejects case creation with null or empty PO number', () => {
    expect(() => {
      resolveOrCreateCase(db, { customerId: 'CUST-001', poNumber: '' });
    }).toThrow(/PO number is required/i);
  });

  it('creates a new case when no case exists', () => {
    const pc = resolveOrCreateCase(db, {
      customerId: 'CUST-001',
      poNumber: 'PO-1001',
      expectedSources: ['EMAIL', 'PDF', 'JSON'],
    });

    expect(pc).toBeDefined();
    expect(pc.id).toBeDefined();
    expect(pc.customerId).toBe('CUST-001');
    expect(pc.poNumber).toBe('PO-1001');
    expect(pc.status).toBe('OPEN');
  });

  it('resolves two simultaneous arrivals to the exact same case (Fix 11)', () => {
    // Simulate two concurrent or sequential arrival operations with the same customer and PO
    const case1 = resolveOrCreateCase(db, {
      customerId: 'CUST-001',
      poNumber: 'PO-1001',
      expectedSources: ['EMAIL', 'PDF'],
    });

    const case2 = resolveOrCreateCase(db, {
      customerId: 'CUST-001',
      poNumber: 'PO-1001',
      expectedSources: ['JSON'],
    });

    expect(case1.id).toBe(case2.id);

    // Verify exactly 1 case exists in processing_cases
    const cases = db.prepare('SELECT COUNT(*) as count FROM processing_cases WHERE customer_id = ? AND po_number = ?')
      .get('CUST-001', 'PO-1001') as { count: number };
    expect(cases.count).toBe(1);
  });

  it('links document to case and creates audit log entry', () => {
    const pc = resolveOrCreateCase(db, {
      customerId: 'CUST-001',
      poNumber: 'PO-1001',
    });

    // Insert doc
    db.prepare(`
      INSERT INTO documents (id, source_type, status, received_at, created_at)
      VALUES ('doc-arrival-1', 'PDF', 'VALID', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    linkDocumentToCase(db, 'doc-arrival-1', pc.id);

    const doc = db.prepare('SELECT case_id FROM documents WHERE id = ?').get('doc-arrival-1') as { case_id: string };
    expect(doc.case_id).toBe(pc.id);

    // Verify audit log has LINK_CASE
    const audit = db.prepare('SELECT * FROM audit_logs WHERE entity_id = ? AND action = ?').get('doc-arrival-1', 'LINK_CASE') as any;
    expect(audit).toBeDefined();
    const details = JSON.parse(audit.details_json);
    expect(details.new_case_id).toBe(pc.id);
  });
});

