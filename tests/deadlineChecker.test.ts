import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from '../src/db/database.js';
import { Database as DatabaseType } from 'better-sqlite3';
import { evaluateCaseDeadlines } from '../src/core/scheduler/deadlineChecker.js';
import { documentRepo, caseRepo } from '../src/db/repositories/index.js';

describe('Case Deadlines & Scheduled Evaluation (deadlineChecker)', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = createDatabase(':memory:');
  });

  it('flips status to INCOMPLETE and logs audit event when now > deadline and expected sources are missing', () => {
    // Case with deadline at 2026-11-11T12:00:00Z and expected ["PDF", "JSON"]
    db.prepare(`
      INSERT INTO processing_cases (id, customer_id, po_number, status, expected_sources, deadline, created_at, updated_at)
      VALUES ('case-overdue', 'CUST-001', 'PO-100', 'OPEN', '["PDF","JSON"]', '2026-11-11T12:00:00Z', '2026-11-11T10:00:00Z', '2026-11-11T10:00:00Z')
    `).run();

    // Only PDF arrived
    documentRepo.insert(db, {
      id: 'doc-pdf-only',
      caseId: 'case-overdue',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T10:30:00Z',
    });

    // Evaluate at 2026-11-11T12:05:00Z (after deadline)
    const summary = evaluateCaseDeadlines(db, '2026-11-11T12:05:00Z');

    expect(summary.evaluatedCount).toBe(1);
    expect(summary.expiredIncompleteCount).toBe(1);
    expect(summary.incompleteCaseIds).toContain('case-overdue');

    // Verify case status in DB
    const updated = caseRepo.findById(db, 'case-overdue');
    expect(updated.status).toBe('INCOMPLETE');

    // Verify audit log entry
    const audit = db.prepare("SELECT * FROM audit_logs WHERE entity_id = 'case-overdue' AND action = 'DEADLINE_EXPIRED'").get() as any;
    expect(audit).toBeDefined();
    expect(audit.entity_type).toBe('CASE');
    const details = JSON.parse(audit.details_json);
    expect(details.missingSources).toEqual(['JSON']);
  });

  it('does NOT mark case INCOMPLETE if deadline has not yet arrived (now < deadline)', () => {
    db.prepare(`
      INSERT INTO processing_cases (id, customer_id, po_number, status, expected_sources, deadline, created_at, updated_at)
      VALUES ('case-future', 'CUST-001', 'PO-200', 'OPEN', '["PDF","JSON"]', '2026-11-11T15:00:00Z', '2026-11-11T10:00:00Z', '2026-11-11T10:00:00Z')
    `).run();

    // Evaluate before deadline
    const summary = evaluateCaseDeadlines(db, '2026-11-11T12:00:00Z');

    expect(summary.expiredIncompleteCount).toBe(0);
    const updated = caseRepo.findById(db, 'case-future');
    expect(updated.status).toBe('OPEN');
  });

  it('keeps case status intact if all expected sources arrived before deadline', () => {
    db.prepare(`
      INSERT INTO processing_cases (id, customer_id, po_number, status, expected_sources, deadline, created_at, updated_at)
      VALUES ('case-complete', 'CUST-001', 'PO-300', 'OPEN', '["PDF","JSON"]', '2026-11-11T12:00:00Z', '2026-11-11T10:00:00Z', '2026-11-11T10:00:00Z')
    `).run();

    // Both PDF and JSON arrived
    documentRepo.insert(db, {
      id: 'doc-pdf-ok',
      caseId: 'case-complete',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T10:30:00Z',
    });
    documentRepo.insert(db, {
      id: 'doc-json-ok',
      caseId: 'case-complete',
      sourceType: 'JSON',
      status: 'VALID',
      receivedAt: '2026-11-11T11:00:00Z',
    });

    const summary = evaluateCaseDeadlines(db, '2026-11-11T12:05:00Z');

    expect(summary.expiredIncompleteCount).toBe(0);
    const updated = caseRepo.findById(db, 'case-complete');
    expect(updated.status).toBe('OPEN'); // not flipped to INCOMPLETE
  });

  it('ignores non-OPEN cases (e.g. RESOLVED, MATCHED)', () => {
    db.prepare(`
      INSERT INTO processing_cases (id, customer_id, po_number, status, expected_sources, deadline, created_at, updated_at)
      VALUES ('case-matched', 'CUST-001', 'PO-400', 'MATCHED', '["PDF","JSON"]', '2026-11-11T12:00:00Z', '2026-11-11T10:00:00Z', '2026-11-11T10:00:00Z')
    `).run();

    const summary = evaluateCaseDeadlines(db, '2026-11-11T13:00:00Z');
    expect(summary.evaluatedCount).toBe(0);

    const check = caseRepo.findById(db, 'case-matched');
    expect(check.status).toBe('MATCHED');
  });
});
