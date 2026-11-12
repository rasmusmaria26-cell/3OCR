import { Database as DatabaseType } from 'better-sqlite3';

export type HeaderAdjustmentType = 'FREIGHT' | 'PACKING' | 'DISCOUNT' | 'OTHER';

export interface HeaderAdjustmentRecord {
  id: string;
  document_id: string;
  type: HeaderAdjustmentType;
  description: string | null;
  amount: string;
  taxes_json: string | null;
  created_at: string;
}

export interface HeaderAdjustmentInput {
  id: string;
  documentId: string;
  type: HeaderAdjustmentType;
  description?: string | null;
  amount: string;
  taxesJson?: string | null;
  createdAt?: string;
}

export const headerAdjustmentRepo = {
  insert(db: DatabaseType, item: HeaderAdjustmentInput) {
    const now = item.createdAt || new Date().toISOString();
    return db.prepare(`
      INSERT INTO header_adjustments (id, document_id, type, description, amount, taxes_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id,
      item.documentId,
      item.type,
      item.description || null,
      item.amount,
      item.taxesJson || null,
      now
    );
  },

  findById(db: DatabaseType, id: string): HeaderAdjustmentRecord | null {
    const row = db.prepare('SELECT * FROM header_adjustments WHERE id = ?').get(id) as HeaderAdjustmentRecord | undefined;
    return row || null;
  },

  findByDocumentId(db: DatabaseType, documentId: string): HeaderAdjustmentRecord[] {
    return db.prepare('SELECT * FROM header_adjustments WHERE document_id = ? ORDER BY created_at ASC').all(documentId) as HeaderAdjustmentRecord[];
  },

  findByDocumentIds(db: DatabaseType, documentIds: string[]): HeaderAdjustmentRecord[] {
    if (!documentIds.length) return [];
    const placeholders = documentIds.map(() => '?').join(',');
    return db.prepare(`SELECT * FROM header_adjustments WHERE document_id IN (${placeholders}) ORDER BY created_at ASC`).all(...documentIds) as HeaderAdjustmentRecord[];
  },
};

