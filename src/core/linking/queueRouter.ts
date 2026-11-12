import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'node:crypto';
import { queueRepo, documentRepo, caseRepo } from '../../db/repositories/index.js';
import { resolveOrCreateCase, linkDocumentToCase } from './caseLinker.js';
import { assignDocumentVersion } from './versionManager.js';

export interface RouteDocumentInput {
  documentId: string;
  customerId?: string | null;
  poNumber?: string | null;
  identityConflict?: {
    hasConflict: boolean;
    reason: string;
  } | null;
  expectedSources?: string[];
}

export interface RouteDocumentResult {
  caseId: string | null;
  routedToQueue: 'UNLINKED' | 'POSSIBLE_MATCH' | 'IDENTITY_CONFLICT' | null;
  queueId: string | null;
  candidateCaseId: string | null;
  reason: string | null;
}

export interface EnrichedQueueRecord {
  id: string;
  queue_type: 'UNLINKED' | 'POSSIBLE_MATCH' | 'IDENTITY_CONFLICT';
  document_id: string;
  candidate_case_id: string | null;
  reason: string;
  resolved: number;
  created_at: string;
  resolved_at: string | null;
  source_type?: string;
  received_at?: string;
  status?: string;
  sender_email?: string | null;
  file_hash?: string | null;
  candidate_customer_id?: string | null;
  candidate_po_number?: string | null;
}

export function routeDocument(db: DatabaseType, input: RouteDocumentInput): RouteDocumentResult {
  const { documentId, expectedSources } = input;
  const customerId = input.customerId?.trim() || null;
  const poNumber = input.poNumber?.trim().toUpperCase() || null;
  const doc = documentRepo.findById(db, documentId);

  // 1. Identity conflict check
  if (input.identityConflict && input.identityConflict.hasConflict) {
    const queueId = crypto.randomUUID();
    queueRepo.insert(db, {
      id: queueId,
      queueType: 'IDENTITY_CONFLICT',
      documentId,
      reason: input.identityConflict.reason,
    });
    return {
      caseId: null,
      routedToQueue: 'IDENTITY_CONFLICT',
      queueId,
      candidateCaseId: null,
      reason: input.identityConflict.reason,
    };
  }

  // 2. Unlinked check (missing PO or missing Customer ID)
  if (!poNumber || !customerId) {
    const queueId = crypto.randomUUID();
    const missing: string[] = [];
    if (!poNumber) missing.push('PO number is missing');
    if (!customerId) missing.push('Customer ID could not be resolved');
    const reason = missing.join('; ');

    queueRepo.insert(db, {
      id: queueId,
      queueType: 'UNLINKED',
      documentId,
      reason,
    });

    return {
      caseId: null,
      routedToQueue: 'UNLINKED',
      queueId,
      candidateCaseId: null,
      reason,
    };
  }

  // 3. Possible Match check: same PO number exists for a different customer ID
  const collisionCase = db.prepare(`
    SELECT id, customer_id, po_number
    FROM processing_cases
    WHERE po_number = ? AND customer_id != ?
    LIMIT 1
  `).get(poNumber, customerId) as { id: string; customer_id: string; po_number: string } | undefined;

  if (collisionCase) {
    const queueId = crypto.randomUUID();
    const reason = `Collision: PO number '${poNumber}' already exists for customer '${collisionCase.customer_id}' (candidate case ${collisionCase.id})`;

    queueRepo.insert(db, {
      id: queueId,
      queueType: 'POSSIBLE_MATCH',
      documentId,
      candidateCaseId: collisionCase.id,
      reason,
    });

    return {
      caseId: null,
      routedToQueue: 'POSSIBLE_MATCH',
      queueId,
      candidateCaseId: collisionCase.id,
      reason,
    };
  }

  // 4. Normal linking / creation
  const resolvedCase = resolveOrCreateCase(db, {
    customerId,
    poNumber,
    expectedSources,
  });

  linkDocumentToCase(db, documentId, resolvedCase.id);

  if (doc) {
    assignDocumentVersion(db, {
      caseId: resolvedCase.id,
      sourceType: doc.source_type,
      documentId,
      receivedAt: doc.received_at,
    });
  }

  return {
    caseId: resolvedCase.id,
    routedToQueue: null,
    queueId: null,
    candidateCaseId: null,
    reason: null,
  };
}

export function getQueuedItems(
  db: DatabaseType,
  options?: {
    queueType?: 'UNLINKED' | 'POSSIBLE_MATCH' | 'IDENTITY_CONFLICT';
    resolved?: boolean;
  }
): EnrichedQueueRecord[] {
  let query = `
    SELECT 
      q.id,
      q.queue_type,
      q.document_id,
      q.candidate_case_id,
      q.reason,
      q.resolved,
      q.created_at,
      q.resolved_at,
      d.source_type,
      d.received_at,
      d.status,
      d.sender_email,
      d.file_hash,
      c.customer_id AS candidate_customer_id,
      c.po_number AS candidate_po_number
    FROM queues q
    JOIN documents d ON q.document_id = d.id
    LEFT JOIN processing_cases c ON q.candidate_case_id = c.id
    WHERE 1=1
  `;

  const params: any[] = [];

  if (options?.queueType) {
    query += ' AND q.queue_type = ?';
    params.push(options.queueType);
  }

  if (options?.resolved !== undefined) {
    query += ' AND q.resolved = ?';
    params.push(options.resolved ? 1 : 0);
  }

  query += ' ORDER BY q.created_at DESC';

  return db.prepare(query).all(...params) as EnrichedQueueRecord[];
}

export interface ResolveQueueInput {
  queueId: string;
  action: 'LINK_CASE' | 'REASSIGN' | 'DISMISS';
  targetCaseId?: string;
  targetCustomerId?: string;
  targetPoNumber?: string;
  resolvedBy?: string;
}

export function resolveQueueItem(db: DatabaseType, input: ResolveQueueInput): { success: boolean; caseId?: string; message: string } {
  const { queueId, action, targetCaseId, targetCustomerId, targetPoNumber, resolvedBy = 'OPERATOR' } = input;

  return db.transaction(() => {
    const queueRecord = queueRepo.findById(db, queueId);
    if (!queueRecord) {
      throw new Error(`Queue item ${queueId} not found`);
    }

    const doc = documentRepo.findById(db, queueRecord.document_id);
    if (!doc) {
      throw new Error(`Document ${queueRecord.document_id} not found`);
    }

    let finalCaseId: string | undefined = undefined;

    if (action === 'LINK_CASE') {
      if (!targetCaseId) {
        throw new Error('targetCaseId is required for LINK_CASE action');
      }
      const targetCase = caseRepo.findById(db, targetCaseId);
      if (!targetCase) {
        throw new Error(`Target case ${targetCaseId} not found`);
      }

      linkDocumentToCase(db, doc.id, targetCaseId);
      assignDocumentVersion(db, {
        caseId: targetCaseId,
        sourceType: doc.source_type,
        documentId: doc.id,
        receivedAt: doc.received_at,
      });
      finalCaseId = targetCaseId;
    } else if (action === 'REASSIGN') {
      if (!targetCustomerId || !targetPoNumber) {
        throw new Error('targetCustomerId and targetPoNumber are required for REASSIGN action');
      }

      const reassignedCase = resolveOrCreateCase(db, {
        customerId: targetCustomerId,
        poNumber: targetPoNumber,
      });

      linkDocumentToCase(db, doc.id, reassignedCase.id);
      assignDocumentVersion(db, {
        caseId: reassignedCase.id,
        sourceType: doc.source_type,
        documentId: doc.id,
        receivedAt: doc.received_at,
      });
      finalCaseId = reassignedCase.id;
    } else if (action === 'DISMISS') {
      documentRepo.updateStatus(db, doc.id, 'INVALID');
    } else {
      throw new Error(`Unknown action: ${action}`);
    }

    queueRepo.resolve(db, queueId);

    // Audit log
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO audit_logs (id, entity_type, entity_id, action, details_json, performed_by, created_at)
      VALUES (?, 'QUEUE', ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      queueId,
      `RESOLVE_${action}`,
      JSON.stringify({ action, targetCaseId, targetCustomerId, targetPoNumber }),
      resolvedBy,
      now
    );

    return {
      success: true,
      caseId: finalCaseId,
      message: `Queue item resolved with action ${action}`,
    };
  })();
}
