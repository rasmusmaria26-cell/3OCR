import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from '../src/db/database.js';
import { Database as DatabaseType } from 'better-sqlite3';
import { assignDocumentVersion, getCurrentDocumentVersionIds } from '../src/core/linking/versionManager.js';
import { documentRepo } from '../src/db/repositories/index.js';

describe('Document Versioning (versionManager)', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = createDatabase(':memory:');

    // Create a processing case
    db.prepare(`
      INSERT INTO processing_cases (id, customer_id, po_number, status, expected_sources, created_at, updated_at)
      VALUES ('case-v1', 'CUST-001', 'PO-100', 'OPEN', '["PDF","JSON"]', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();
  });

  it('assigns version_number = 1 and is_current_version = 1 for the first document of a source type', () => {
    documentRepo.insert(db, {
      id: 'doc-pdf-1',
      caseId: 'case-v1',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T10:00:00Z',
    });

    const result = assignDocumentVersion(db, {
      caseId: 'case-v1',
      sourceType: 'PDF',
      documentId: 'doc-pdf-1',
      receivedAt: '2026-11-11T10:00:00Z',
    });

    expect(result.versionNumber).toBe(1);
    expect(result.isCurrentVersion).toBe(true);
    expect(result.hasAmbiguity).toBe(false);

    const doc = documentRepo.findById(db, 'doc-pdf-1');
    expect(doc.version_number).toBe(1);
    expect(doc.is_current_version).toBe(1);
  });

  it('increments version_number for same case and same source type, making newer receivedAt current', () => {
    documentRepo.insert(db, {
      id: 'doc-pdf-1',
      caseId: 'case-v1',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T10:00:00Z',
      versionNumber: 1,
      isCurrentVersion: 1,
    });

    documentRepo.insert(db, {
      id: 'doc-pdf-2',
      caseId: 'case-v1',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T11:00:00Z',
    });

    const result = assignDocumentVersion(db, {
      caseId: 'case-v1',
      sourceType: 'PDF',
      documentId: 'doc-pdf-2',
      receivedAt: '2026-11-11T11:00:00Z',
    });

    expect(result.versionNumber).toBe(2);
    expect(result.isCurrentVersion).toBe(true);
    expect(result.previousVersionId).toBe('doc-pdf-1');

    const doc1 = documentRepo.findById(db, 'doc-pdf-1');
    const doc2 = documentRepo.findById(db, 'doc-pdf-2');
    expect(doc1.is_current_version).toBe(0);
    expect(doc2.is_current_version).toBe(1);
    expect(doc2.version_number).toBe(2);
  });

  it('keeps existing version current if new document has older receivedAt (out of order arrival)', () => {
    documentRepo.insert(db, {
      id: 'doc-pdf-newer',
      caseId: 'case-v1',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T12:00:00Z',
      versionNumber: 1,
      isCurrentVersion: 1,
    });

    documentRepo.insert(db, {
      id: 'doc-pdf-older',
      caseId: 'case-v1',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T09:00:00Z',
    });

    const result = assignDocumentVersion(db, {
      caseId: 'case-v1',
      sourceType: 'PDF',
      documentId: 'doc-pdf-older',
      receivedAt: '2026-11-11T09:00:00Z',
    });

    expect(result.versionNumber).toBe(2);
    expect(result.isCurrentVersion).toBe(false);

    const docNewer = documentRepo.findById(db, 'doc-pdf-newer');
    const docOlder = documentRepo.findById(db, 'doc-pdf-older');
    expect(docNewer.is_current_version).toBe(1);
    expect(docOlder.is_current_version).toBe(0);
  });

  it('flags timestamp ties as ambiguous for review', () => {
    documentRepo.insert(db, {
      id: 'doc-pdf-tie1',
      caseId: 'case-v1',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T10:00:00Z',
      versionNumber: 1,
      isCurrentVersion: 1,
    });

    documentRepo.insert(db, {
      id: 'doc-pdf-tie2',
      caseId: 'case-v1',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T10:00:00Z', // Exact same receivedAt
    });

    const result = assignDocumentVersion(db, {
      caseId: 'case-v1',
      sourceType: 'PDF',
      documentId: 'doc-pdf-tie2',
      receivedAt: '2026-11-11T10:00:00Z',
    });

    expect(result.versionNumber).toBe(2);
    expect(result.hasAmbiguity).toBe(true);
    expect(result.ambiguityReason).toContain('Timestamp tie');
  });

  it('retrieves current document version IDs across multiple sources for reconciliation', () => {
    // Add current PDF
    documentRepo.insert(db, {
      id: 'doc-pdf-active',
      caseId: 'case-v1',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T10:00:00Z',
      versionNumber: 2,
      isCurrentVersion: 1,
    });
    // Add superseded PDF
    documentRepo.insert(db, {
      id: 'doc-pdf-old',
      caseId: 'case-v1',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T09:00:00Z',
      versionNumber: 1,
      isCurrentVersion: 0,
    });
    // Add current JSON
    documentRepo.insert(db, {
      id: 'doc-json-active',
      caseId: 'case-v1',
      sourceType: 'JSON',
      status: 'VALID',
      receivedAt: '2026-11-11T10:30:00Z',
      versionNumber: 1,
      isCurrentVersion: 1,
    });

    const activeIds = getCurrentDocumentVersionIds(db, 'case-v1');
    expect(activeIds).toHaveLength(2);
    expect(activeIds).toContain('doc-pdf-active');
    expect(activeIds).toContain('doc-json-active');
    expect(activeIds).not.toContain('doc-pdf-old');
  });

  it('handles 3+ out-of-order document revisions and ensures only one is_current_version is 1', () => {
    // Rev 1 at 12:00
    documentRepo.insert(db, {
      id: 'doc-rev-1',
      caseId: 'case-v1',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T12:00:00Z',
    });
    assignDocumentVersion(db, {
      caseId: 'case-v1',
      sourceType: 'PDF',
      documentId: 'doc-rev-1',
      receivedAt: '2026-11-11T12:00:00Z',
    });

    // Rev 2 at 10:00 (older arrival)
    documentRepo.insert(db, {
      id: 'doc-rev-2',
      caseId: 'case-v1',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T10:00:00Z',
    });
    const res2 = assignDocumentVersion(db, {
      caseId: 'case-v1',
      sourceType: 'PDF',
      documentId: 'doc-rev-2',
      receivedAt: '2026-11-11T10:00:00Z',
    });
    expect(res2.isCurrentVersion).toBe(false);

    // Rev 3 at 14:00 (newest arrival)
    documentRepo.insert(db, {
      id: 'doc-rev-3',
      caseId: 'case-v1',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T14:00:00Z',
    });
    const res3 = assignDocumentVersion(db, {
      caseId: 'case-v1',
      sourceType: 'PDF',
      documentId: 'doc-rev-3',
      receivedAt: '2026-11-11T14:00:00Z',
    });
    expect(res3.isCurrentVersion).toBe(true);

    const currentCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM documents WHERE case_id = 'case-v1' AND source_type = 'PDF' AND is_current_version = 1
    `).get() as { cnt: number };
    expect(currentCount.cnt).toBe(1);

    const docRev3 = documentRepo.findById(db, 'doc-rev-3');
    expect(docRev3.is_current_version).toBe(1);
    expect(docRev3.version_number).toBe(3);
  });

  it('updates case status to REVIEW_REQUIRED and logs audit event on timestamp tie', () => {
    documentRepo.insert(db, {
      id: 'doc-pdf-tie-a',
      caseId: 'case-v1',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T10:00:00Z',
      versionNumber: 1,
      isCurrentVersion: 1,
    });

    documentRepo.insert(db, {
      id: 'doc-pdf-tie-b',
      caseId: 'case-v1',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T10:00:00Z',
    });

    const result = assignDocumentVersion(db, {
      caseId: 'case-v1',
      sourceType: 'PDF',
      documentId: 'doc-pdf-tie-b',
      receivedAt: '2026-11-11T10:00:00Z',
    });

    expect(result.hasAmbiguity).toBe(true);

    const updatedCase = db.prepare('SELECT status FROM processing_cases WHERE id = ?').get('case-v1') as any;
    expect(updatedCase.status).toBe('REVIEW_REQUIRED');

    const audit = db.prepare("SELECT * FROM audit_logs WHERE entity_id = 'case-v1' AND action = 'AMBIGUITY_DETECTED'").get() as any;
    expect(audit).toBeDefined();
    expect(audit.action).toBe('AMBIGUITY_DETECTED');
  });

  it('reopens previously MATCHED or RESOLVED case to OPEN when a new document version arrives', () => {
    db.prepare("UPDATE processing_cases SET status = 'MATCHED' WHERE id = 'case-v1'").run();

    documentRepo.insert(db, {
      id: 'doc-pdf-reopen',
      caseId: 'case-v1',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T15:00:00Z',
    });

    assignDocumentVersion(db, {
      caseId: 'case-v1',
      sourceType: 'PDF',
      documentId: 'doc-pdf-reopen',
      receivedAt: '2026-11-11T15:00:00Z',
    });

    const reopenedCase = db.prepare('SELECT status FROM processing_cases WHERE id = ?').get('case-v1') as any;
    expect(reopenedCase.status).toBe('OPEN');

    const audit = db.prepare("SELECT * FROM audit_logs WHERE entity_id = 'case-v1' AND action = 'STATUS_REOPENED_ON_NEW_DOCUMENT'").get() as any;
    expect(audit).toBeDefined();
  });
});
