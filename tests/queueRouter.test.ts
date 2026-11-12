import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from '../src/db/database.js';
import { Database as DatabaseType } from 'better-sqlite3';
import { routeDocument, resolveQueueItem, getQueuedItems } from '../src/core/linking/queueRouter.js';
import { documentRepo, caseRepo } from '../src/db/repositories/index.js';

describe('Queues & Routing (queueRouter)', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = createDatabase(':memory:');

    // Seed customer_config
    db.prepare(`
      INSERT INTO customer_config (customer_id, default_currency, default_uom, separators_insignificant, config_version, created_at, updated_at)
      VALUES 
        ('CUST-ALPHA', 'USD', 'EA', 1, '1.0', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z'),
        ('CUST-BETA', 'USD', 'EA', 1, '1.0', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();
  });

  it('routes to UNLINKED queue if PO number is missing or empty', () => {
    documentRepo.insert(db, {
      id: 'doc-no-po',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T10:00:00Z',
    });

    const route = routeDocument(db, {
      documentId: 'doc-no-po',
      customerId: 'CUST-ALPHA',
      poNumber: null,
    });

    expect(route.routedToQueue).toBe('UNLINKED');
    expect(route.caseId).toBeNull();

    const queued = getQueuedItems(db, { queueType: 'UNLINKED' });
    expect(queued.length).toBe(1);
    expect(queued[0].document_id).toBe('doc-no-po');
    expect(queued[0].reason).toContain('PO number');
  });

  it('routes to UNLINKED queue if Customer ID is missing or unresolved', () => {
    documentRepo.insert(db, {
      id: 'doc-no-cust',
      sourceType: 'EMAIL',
      status: 'VALID',
      receivedAt: '2026-11-11T10:00:00Z',
    });

    const route = routeDocument(db, {
      documentId: 'doc-no-cust',
      customerId: null,
      poNumber: 'PO-9000',
    });

    expect(route.routedToQueue).toBe('UNLINKED');
    expect(route.caseId).toBeNull();
  });

  it('routes to POSSIBLE_MATCH when same PO number exists for a different customer ID', () => {
    // Existing case for CUST-ALPHA with PO-1234
    db.prepare(`
      INSERT INTO processing_cases (id, customer_id, po_number, status, expected_sources, created_at, updated_at)
      VALUES ('case-alpha', 'CUST-ALPHA', 'PO-1234', 'OPEN', '["PDF"]', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    // New doc arrives claiming CUST-BETA with same PO-1234
    documentRepo.insert(db, {
      id: 'doc-beta-collision',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T11:00:00Z',
    });

    const route = routeDocument(db, {
      documentId: 'doc-beta-collision',
      customerId: 'CUST-BETA',
      poNumber: 'PO-1234',
    });

    expect(route.routedToQueue).toBe('POSSIBLE_MATCH');
    expect(route.caseId).toBeNull();
    expect(route.candidateCaseId).toBe('case-alpha');

    const queued = getQueuedItems(db, { queueType: 'POSSIBLE_MATCH' });
    expect(queued.length).toBe(1);
    expect(queued[0].document_id).toBe('doc-beta-collision');
    expect(queued[0].candidate_case_id).toBe('case-alpha');
  });

  it('routes to IDENTITY_CONFLICT when sender conflict is present', () => {
    documentRepo.insert(db, {
      id: 'doc-id-conflict',
      sourceType: 'EMAIL',
      status: 'VALID',
      receivedAt: '2026-11-11T12:00:00Z',
    });

    const route = routeDocument(db, {
      documentId: 'doc-id-conflict',
      customerId: 'CUST-BETA',
      poNumber: 'PO-7777',
      identityConflict: {
        hasConflict: true,
        reason: "Payload customer 'CUST-BETA' contradicts sender domain mapping 'CUST-ALPHA'",
      },
    });

    expect(route.routedToQueue).toBe('IDENTITY_CONFLICT');
    expect(route.caseId).toBeNull();

    const queued = getQueuedItems(db, { queueType: 'IDENTITY_CONFLICT' });
    expect(queued.length).toBe(1);
    expect(queued[0].document_id).toBe('doc-id-conflict');
  });

  it('links document directly when both PO and Customer are resolved without conflict', () => {
    documentRepo.insert(db, {
      id: 'doc-clean',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T10:00:00Z',
    });

    const route = routeDocument(db, {
      documentId: 'doc-clean',
      customerId: 'CUST-ALPHA',
      poNumber: 'PO-5555',
    });

    expect(route.routedToQueue).toBeNull();
    expect(route.caseId).toBeDefined();

    const doc = documentRepo.findById(db, 'doc-clean');
    expect(doc.case_id).toBe(route.caseId);
  });

  it('resolves a queued item with LINK_CASE action', () => {
    db.prepare(`
      INSERT INTO processing_cases (id, customer_id, po_number, status, expected_sources, created_at, updated_at)
      VALUES ('case-target', 'CUST-ALPHA', 'PO-999', 'OPEN', '["PDF"]', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    documentRepo.insert(db, {
      id: 'doc-queued-1',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T10:00:00Z',
    });

    const route = routeDocument(db, {
      documentId: 'doc-queued-1',
      customerId: null,
      poNumber: 'PO-999',
    });

    const queueItems = getQueuedItems(db, { queueType: 'UNLINKED' });
    const queueId = queueItems[0].id;

    const res = resolveQueueItem(db, {
      queueId,
      action: 'LINK_CASE',
      targetCaseId: 'case-target',
      resolvedBy: 'operator1',
    });

    expect(res.success).toBe(true);

    const doc = documentRepo.findById(db, 'doc-queued-1');
    expect(doc.case_id).toBe('case-target');

    const unresolved = getQueuedItems(db, { resolved: false });
    expect(unresolved.length).toBe(0);
  });

  it('resolves a queued item with REASSIGN action', () => {
    documentRepo.insert(db, {
      id: 'doc-queued-2',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T10:00:00Z',
    });

    routeDocument(db, {
      documentId: 'doc-queued-2',
      customerId: null,
      poNumber: null,
    });

    const queueItems = getQueuedItems(db, { queueType: 'UNLINKED' });
    const queueId = queueItems[0].id;

    const res = resolveQueueItem(db, {
      queueId,
      action: 'REASSIGN',
      targetCustomerId: 'CUST-ALPHA',
      targetPoNumber: 'PO-NEW-RESOLVED',
      resolvedBy: 'operator1',
    });

    expect(res.success).toBe(true);

    const doc = documentRepo.findById(db, 'doc-queued-2');
    expect(doc.case_id).toBeDefined();

    const createdCase = caseRepo.findById(db, doc.case_id);
    expect(createdCase.customer_id).toBe('CUST-ALPHA');
    expect(createdCase.po_number).toBe('PO-NEW-RESOLVED');
  });

  it('resolves a queued item with DISMISS action', () => {
    documentRepo.insert(db, {
      id: 'doc-queued-3',
      sourceType: 'PDF',
      status: 'VALID',
      receivedAt: '2026-11-11T10:00:00Z',
    });

    routeDocument(db, {
      documentId: 'doc-queued-3',
      customerId: null,
      poNumber: null,
    });

    const queueItems = getQueuedItems(db, { queueType: 'UNLINKED' });
    const queueId = queueItems[0].id;

    const res = resolveQueueItem(db, {
      queueId,
      action: 'DISMISS',
      resolvedBy: 'operator1',
    });

    expect(res.success).toBe(true);

    const doc = documentRepo.findById(db, 'doc-queued-3');
    expect(doc.status).toBe('INVALID');
  });
});
