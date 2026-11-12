import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'node:crypto';

export interface CaseRecord {
  id: string;
  customerId: string;
  poNumber: string;
  status: string;
  expectedSources: string[];
  deadline?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResolveCaseInput {
  customerId: string;
  poNumber: string;
  expectedSources?: string[];
  deadline?: string;
}

export function resolveOrCreateCase(db: DatabaseType, input: ResolveCaseInput): CaseRecord {
  const customerId = input.customerId?.trim();
  const poNumber = input.poNumber?.trim().toUpperCase();

  if (!customerId) {
    throw new Error('Customer ID is required to link or create a case');
  }
  if (!poNumber) {
    throw new Error('PO number is required to link or create a case');
  }

  const expectedSources = JSON.stringify(input.expectedSources || ['EMAIL', 'PDF', 'JSON']);
  const now = new Date().toISOString();
  const newId = crypto.randomUUID();

  // Atomic upsert via SQLite transaction
  const upsertTx = db.transaction(() => {
    // Attempt insert
    db.prepare(`
      INSERT OR IGNORE INTO processing_cases (id, customer_id, po_number, status, expected_sources, deadline, created_at, updated_at)
      VALUES (?, ?, ?, 'OPEN', ?, ?, ?, ?)
    `).run(newId, customerId, poNumber, expectedSources, input.deadline || null, now, now);

    // Retrieve existing or newly inserted
    const row = db.prepare(`
      SELECT id, customer_id, po_number, status, expected_sources, deadline, created_at, updated_at
      FROM processing_cases
      WHERE customer_id = ? AND po_number = ?
    `).get(customerId, poNumber) as any;

    return {
      id: row.id,
      customerId: row.customer_id,
      poNumber: row.po_number,
      status: row.status,
      expectedSources: JSON.parse(row.expected_sources),
      deadline: row.deadline,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  return upsertTx();
}

export function linkDocumentToCase(db: DatabaseType, documentId: string, caseId: string): void {
  const updateStmt = db.prepare('UPDATE documents SET case_id = ? WHERE id = ?');
  updateStmt.run(caseId, documentId);
}

