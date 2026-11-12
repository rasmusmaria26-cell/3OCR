import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from '../src/db/database.js';
import { Database as DatabaseType } from 'better-sqlite3';
import { senderMappingRepo } from '../src/db/repositories/senderMappingRepo.js';
import { queueRepo } from '../src/db/repositories/queueRepo.js';
import { headerAdjustmentRepo } from '../src/db/repositories/headerAdjustmentRepo.js';
import { taxRateRepo } from '../src/db/repositories/taxRateRepo.js';

describe('Database Schema & Immutability Triggers', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = createDatabase(':memory:');
  });

  it('enforces RESTRICT on foreign key delete', () => {
    // Insert a case
    db.prepare(`
      INSERT INTO processing_cases (id, customer_id, po_number, status, expected_sources, created_at, updated_at)
      VALUES ('case-1', 'CUST-001', 'PO-1001', 'OPEN', '["PDF","JSON"]', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    // Insert a document linked to case-1
    db.prepare(`
      INSERT INTO documents (id, case_id, source_type, status, storage_path, received_at, created_at)
      VALUES ('doc-1', 'case-1', 'PDF', 'VALID', '/storage/doc1.pdf', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    // Trying to delete case-1 should throw due to ON DELETE RESTRICT
    expect(() => {
      db.prepare('DELETE FROM processing_cases WHERE id = ?').run('case-1');
    }).toThrow();
  });

  it('blocks UPDATE and DELETE on audit_logs', () => {
    db.prepare(`
      INSERT INTO audit_logs (id, entity_type, entity_id, action, details_json, performed_by, created_at)
      VALUES ('audit-1', 'DOCUMENT', 'doc-1', 'CREATE', '{}', 'USER', '2026-11-11T00:00:00Z')
    `).run();

    // UPDATE should throw
    expect(() => {
      db.prepare("UPDATE audit_logs SET action = 'UPDATE' WHERE id = 'audit-1'").run();
    }).toThrow(/audit_logs is append-only and immutable/);

    // DELETE should throw
    expect(() => {
      db.prepare("DELETE FROM audit_logs WHERE id = 'audit-1'").run();
    }).toThrow(/audit_logs is append-only and immutable/);
  });

  it('blocks UPDATE and DELETE on extracted_text', () => {
    db.prepare(`
      INSERT INTO documents (id, source_type, status, received_at, created_at)
      VALUES ('doc-2', 'EMAIL', 'VALID', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    db.prepare(`
      INSERT INTO extracted_text (id, document_id, raw_text, cleaned_text, created_at)
      VALUES ('txt-1', 'doc-2', 'raw', 'cleaned', '2026-11-11T00:00:00Z')
    `).run();

    expect(() => {
      db.prepare("UPDATE extracted_text SET cleaned_text = 'changed' WHERE id = 'txt-1'").run();
    }).toThrow(/extracted_text is immutable/);

    expect(() => {
      db.prepare("DELETE FROM extracted_text WHERE id = 'txt-1'").run();
    }).toThrow(/extracted_text is immutable/);
  });

  it('blocks UPDATE and DELETE on extraction_issues', () => {
    db.prepare(`
      INSERT INTO documents (id, source_type, status, received_at, created_at)
      VALUES ('doc-3', 'EMAIL', 'VALID', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    db.prepare(`
      INSERT INTO extraction_issues (id, document_id, field_path, code, is_blocking, created_at)
      VALUES ('iss-1', 'doc-3', 'order.poNumber', 'MISSING', 1, '2026-11-11T00:00:00Z')
    `).run();

    expect(() => {
      db.prepare("UPDATE extraction_issues SET is_blocking = 0 WHERE id = 'iss-1'").run();
    }).toThrow(/extraction_issues is immutable/);

    expect(() => {
      db.prepare("DELETE FROM extraction_issues WHERE id = 'iss-1'").run();
    }).toThrow(/extraction_issues is immutable/);
  });

  it('blocks UPDATE and DELETE on reconciliation_runs', () => {
    db.prepare(`
      INSERT INTO processing_cases (id, customer_id, po_number, status, expected_sources, created_at, updated_at)
      VALUES ('case-rr', 'CUST-001', 'PO-RR', 'OPEN', '["PDF"]', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    db.prepare(`
      INSERT INTO reconciliation_runs (id, case_id, status, document_version_ids, initiated_by, started_at)
      VALUES ('run-1', 'case-rr', 'COMPLETED', '["doc-1"]', 'SYSTEM', '2026-11-11T00:00:00Z')
    `).run();

    expect(() => {
      db.prepare("UPDATE reconciliation_runs SET status = 'FAILED' WHERE id = 'run-1'").run();
    }).toThrow(/reconciliation_runs is immutable/);

    expect(() => {
      db.prepare("DELETE FROM reconciliation_runs WHERE id = 'run-1'").run();
    }).toThrow(/reconciliation_runs is append-only/);
  });

  it('blocks UPDATE and DELETE on reconciliation_results', () => {
    db.prepare(`
      INSERT INTO processing_cases (id, customer_id, po_number, status, expected_sources, created_at, updated_at)
      VALUES ('case-res', 'CUST-001', 'PO-RES', 'OPEN', '["PDF"]', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    db.prepare(`
      INSERT INTO reconciliation_runs (id, case_id, status, document_version_ids, initiated_by, started_at)
      VALUES ('run-res', 'case-res', 'COMPLETED', '["doc-1"]', 'SYSTEM', '2026-11-11T00:00:00Z')
    `).run();

    db.prepare(`
      INSERT INTO reconciliation_results (id, run_id, case_id, status, issues_json, summary_json, created_at)
      VALUES ('res-1', 'run-res', 'case-res', 'MATCHED', '[]', '{}', '2026-11-11T00:00:00Z')
    `).run();

    expect(() => {
      db.prepare("UPDATE reconciliation_results SET status = 'MISMATCH' WHERE id = 'res-1'").run();
    }).toThrow(/reconciliation_results is immutable/);

    expect(() => {
      db.prepare("DELETE FROM reconciliation_results WHERE id = 'res-1'").run();
    }).toThrow(/reconciliation_results is immutable/);
  });

  it('automatically logs case linking to audit_logs via UPDATE trigger', () => {
    db.prepare(`
      INSERT INTO processing_cases (id, customer_id, po_number, status, expected_sources, created_at, updated_at)
      VALUES ('case-2', 'CUST-002', 'PO-2002', 'OPEN', '["PDF"]', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    db.prepare(`
      INSERT INTO documents (id, source_type, status, received_at, created_at)
      VALUES ('doc-4', 'PDF', 'VALID', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    // Link document to case
    db.prepare("UPDATE documents SET case_id = 'case-2' WHERE id = 'doc-4'").run();

    const auditEntry = db.prepare("SELECT * FROM audit_logs WHERE entity_id = 'doc-4' AND action = 'LINK_CASE'").get() as any;
    expect(auditEntry).toBeDefined();
    expect(auditEntry.entity_type).toBe('DOCUMENT');
    const details = JSON.parse(auditEntry.details_json);
    expect(details.new_case_id).toBe('case-2');
  });

  it('automatically logs case linking to audit_logs via INSERT trigger when case_id is directly provided', () => {
    db.prepare(`
      INSERT INTO processing_cases (id, customer_id, po_number, status, expected_sources, created_at, updated_at)
      VALUES ('case-3', 'CUST-003', 'PO-3003', 'OPEN', '["PDF"]', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    // Ingest doc directly with case_id
    db.prepare(`
      INSERT INTO documents (id, case_id, source_type, status, received_at, created_at)
      VALUES ('doc-5', 'case-3', 'PDF', 'VALID', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    const auditEntry = db.prepare("SELECT * FROM audit_logs WHERE entity_id = 'doc-5' AND action = 'LINK_CASE'").get() as any;
    expect(auditEntry).toBeDefined();
    expect(auditEntry.entity_type).toBe('DOCUMENT');
    const details = JSON.parse(auditEntry.details_json);
    expect(details.new_case_id).toBe('case-3');
    expect(details.previous_case_id).toBeNull();
  });

  it('enforces check constraints and foreign keys on enhanced documents table', () => {
    // Valid insert with new columns
    db.prepare(`
      INSERT INTO documents (id, source_type, status, spf_status, dkim_status, version_number, is_current_version, received_at, created_at)
      VALUES ('doc-base', 'EMAIL', 'VALID', 'PASS', 'PASS', 1, 1, '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    // Invalid spf_status should throw
    expect(() => {
      db.prepare(`
        INSERT INTO documents (id, source_type, status, spf_status, received_at, created_at)
        VALUES ('doc-invalid-spf', 'EMAIL', 'VALID', 'UNKNOWN', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
      `).run();
    }).toThrow();

    // Invalid dkim_status should throw
    expect(() => {
      db.prepare(`
        INSERT INTO documents (id, source_type, status, dkim_status, received_at, created_at)
        VALUES ('doc-invalid-dkim', 'EMAIL', 'VALID', 'UNKNOWN', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
      `).run();
    }).toThrow();

    // duplicate_of_id foreign key restriction
    db.prepare(`
      INSERT INTO documents (id, source_type, status, duplicate_of_id, received_at, created_at)
      VALUES ('doc-dup', 'EMAIL', 'DUPLICATE_FILE', 'doc-base', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    // Trying to delete doc-base should fail because doc-dup references it ON DELETE RESTRICT
    expect(() => {
      db.prepare('DELETE FROM documents WHERE id = ?').run('doc-base');
    }).toThrow();
  });

  it('enforces constraints and foreign keys on sender_mappings table', () => {
    // Create customer_config entry first
    db.prepare(`
      INSERT INTO customer_config (customer_id, default_currency, default_uom, separators_insignificant, config_version, created_at, updated_at)
      VALUES ('CUST-ACME', 'USD', 'EA', 1, '1.0', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    // Valid insert
    db.prepare(`
      INSERT INTO sender_mappings (id, sender_pattern, customer_id, is_domain, config_version, created_at)
      VALUES ('map-1', 'orders@acme.com', 'CUST-ACME', 0, '1.0', '2026-11-11T00:00:00Z')
    `).run();

    // Duplicate sender_pattern should throw
    expect(() => {
      db.prepare(`
        INSERT INTO sender_mappings (id, sender_pattern, customer_id, is_domain, config_version, created_at)
        VALUES ('map-2', 'orders@acme.com', 'CUST-ACME', 0, '1.0', '2026-11-11T00:00:00Z')
      `).run();
    }).toThrow();

    // Foreign key RESTRICT: trying to delete customer_config should throw
    expect(() => {
      db.prepare('DELETE FROM customer_config WHERE customer_id = ?').run('CUST-ACME');
    }).toThrow();
  });

  it('provides typed senderMappingRepo operations', () => {
    db.prepare(`
      INSERT INTO customer_config (customer_id, default_currency, default_uom, separators_insignificant, config_version, created_at, updated_at)
      VALUES ('CUST-100', 'USD', 'EA', 1, '1.0', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    senderMappingRepo.insert(db, {
      id: 'sm-1',
      senderPattern: 'orders@acme.com',
      customerId: 'CUST-100',
      isDomain: false,
    });

    senderMappingRepo.insert(db, {
      id: 'sm-2',
      senderPattern: '@acme.com',
      customerId: 'CUST-100',
      isDomain: true,
    });

    const exact = senderMappingRepo.findMatch(db, 'orders@acme.com');
    expect(exact).toBeDefined();
    expect(exact?.customerId).toBe('CUST-100');
    expect(exact?.isDomain).toBe(0);

    const domainMatch = senderMappingRepo.findMatch(db, 'billing@acme.com');
    expect(domainMatch).toBeDefined();
    expect(domainMatch?.customerId).toBe('CUST-100');
    expect(domainMatch?.isDomain).toBe(1);

    const noMatch = senderMappingRepo.findMatch(db, 'user@unknown.com');
    expect(noMatch).toBeNull();
  });

  it('provides typed queueRepo operations', () => {
    db.prepare(`
      INSERT INTO documents (id, source_type, status, received_at, created_at)
      VALUES ('doc-q1', 'EMAIL', 'VALID', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    queueRepo.insert(db, {
      id: 'q-1',
      queueType: 'UNLINKED',
      documentId: 'doc-q1',
      reason: 'PO number missing',
    });

    const unresolved = queueRepo.findUnresolved(db);
    expect(unresolved.length).toBe(1);
    expect(unresolved[0].queue_type).toBe('UNLINKED');
    expect(unresolved[0].resolved).toBe(0);

    queueRepo.resolve(db, 'q-1');
    const unresolvedAfter = queueRepo.findUnresolved(db);
    expect(unresolvedAfter.length).toBe(0);

    const resolvedItem = queueRepo.findById(db, 'q-1');
    expect(resolvedItem?.resolved).toBe(1);
    expect(resolvedItem?.resolved_at).toBeDefined();
  });

  it('enforces check constraints and immutability on header_adjustments', () => {
    db.prepare(`
      INSERT INTO documents (id, source_type, status, received_at, created_at)
      VALUES ('doc-adj1', 'PDF', 'VALID', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    // Valid insert
    headerAdjustmentRepo.insert(db, {
      id: 'adj-1',
      documentId: 'doc-adj1',
      type: 'FREIGHT',
      description: 'Standard Freight',
      amount: '500.00',
      taxesJson: JSON.stringify([{ type: 'IGST', rate: '18.00', amount: '90.00' }]),
    });

    const items = headerAdjustmentRepo.findByDocumentId(db, 'doc-adj1');
    expect(items.length).toBe(1);
    expect(items[0].type).toBe('FREIGHT');
    expect(items[0].amount).toBe('500.00');

    // Invalid type should throw CHECK constraint failure
    expect(() => {
      db.prepare(`
        INSERT INTO header_adjustments (id, document_id, type, amount, created_at)
        VALUES ('adj-invalid', 'doc-adj1', 'INVALID_TYPE', '100.00', '2026-11-11T00:00:00Z')
      `).run();
    }).toThrow();

    // Immutability trigger: UPDATE should throw
    expect(() => {
      db.prepare("UPDATE header_adjustments SET amount = '600.00' WHERE id = 'adj-1'").run();
    }).toThrow(/header_adjustments is immutable/);

    // Immutability trigger: DELETE should throw
    expect(() => {
      db.prepare("DELETE FROM header_adjustments WHERE id = 'adj-1'").run();
    }).toThrow(/header_adjustments is immutable/);
  });

  it('enforces check constraints and operations on tax_rates', () => {
    // Valid insert
    taxRateRepo.insert(db, {
      id: 'tax-1',
      taxType: 'CGST',
      rate: '9.00',
      description: 'Central GST 9%',
    });

    taxRateRepo.insert(db, {
      id: 'tax-2',
      taxType: 'SGST',
      rate: '9.00',
      description: 'State GST 9%',
    });

    const cgstRates = taxRateRepo.findByType(db, 'CGST');
    expect(cgstRates.length).toBe(1);
    expect(cgstRates[0].rate).toBe('9.00');

    const all = taxRateRepo.findAll(db);
    expect(all.length).toBe(2);

    // Invalid tax_type should throw
    expect(() => {
      db.prepare(`
        INSERT INTO tax_rates (id, tax_type, rate, created_at)
        VALUES ('tax-invalid', 'INVALID_TAX', '10.00', '2026-11-11T00:00:00Z')
      `).run();
    }).toThrow();
  });
});

