import { Database as DatabaseType } from 'better-sqlite3';

export interface QueueRecord {
  id: string;
  queue_type: 'UNLINKED' | 'POSSIBLE_MATCH' | 'IDENTITY_CONFLICT';
  document_id: string;
  candidate_case_id: string | null;
  reason: string;
  resolved: number;
  created_at: string;
  resolved_at: string | null;
}

export interface QueueInput {
  id: string;
  queueType: 'UNLINKED' | 'POSSIBLE_MATCH' | 'IDENTITY_CONFLICT';
  documentId: string;
  candidateCaseId?: string | null;
  reason: string;
  resolved?: boolean | number;
  createdAt?: string;
  resolvedAt?: string | null;
}

export const queueRepo = {
  insert(db: DatabaseType, item: QueueInput) {
    const now = item.createdAt || new Date().toISOString();
    const resolvedVal = item.resolved ? 1 : 0;

    return db.prepare(`
      INSERT INTO queues (id, queue_type, document_id, candidate_case_id, reason, resolved, created_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id,
      item.queueType,
      item.documentId,
      item.candidateCaseId || null,
      item.reason,
      resolvedVal,
      now,
      item.resolvedAt || null
    );
  },

  findById(db: DatabaseType, id: string): QueueRecord | null {
    const row = db.prepare('SELECT * FROM queues WHERE id = ?').get(id) as QueueRecord | undefined;
    return row || null;
  },

  findByDocumentId(db: DatabaseType, documentId: string): QueueRecord[] {
    return db.prepare('SELECT * FROM queues WHERE document_id = ? ORDER BY created_at DESC').all(documentId) as QueueRecord[];
  },

  findUnresolved(db: DatabaseType, queueType?: 'UNLINKED' | 'POSSIBLE_MATCH' | 'IDENTITY_CONFLICT'): QueueRecord[] {
    if (queueType) {
      return db.prepare('SELECT * FROM queues WHERE resolved = 0 AND queue_type = ? ORDER BY created_at DESC').all(queueType) as QueueRecord[];
    }
    return db.prepare('SELECT * FROM queues WHERE resolved = 0 ORDER BY created_at DESC').all() as QueueRecord[];
  },

  findAll(db: DatabaseType, resolved?: boolean): QueueRecord[] {
    if (resolved !== undefined) {
      const resVal = resolved ? 1 : 0;
      return db.prepare('SELECT * FROM queues WHERE resolved = ? ORDER BY created_at DESC').all(resVal) as QueueRecord[];
    }
    return db.prepare('SELECT * FROM queues ORDER BY created_at DESC').all() as QueueRecord[];
  },

  resolve(db: DatabaseType, id: string, resolvedAt?: string) {
    const now = resolvedAt || new Date().toISOString();
    return db.prepare('UPDATE queues SET resolved = 1, resolved_at = ? WHERE id = ?').run(now, id);
  },
};
