import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'node:crypto';
import { documentRepo, caseRepo } from '../../db/repositories/index.js';

export interface AssignVersionInput {
  caseId: string;
  sourceType: string;
  documentId: string;
  receivedAt: string;
}

export interface AssignVersionResult {
  versionNumber: number;
  isCurrentVersion: boolean;
  hasAmbiguity: boolean;
  ambiguityReason: string | null;
  previousVersionId: string | null;
}

export function assignDocumentVersion(db: DatabaseType, input: AssignVersionInput): AssignVersionResult {
  const { caseId, sourceType, documentId, receivedAt } = input;

  return db.transaction(() => {
    // 1. Fetch all existing documents for this case and source type
    const existingVersions = documentRepo.findVersionsForCaseAndSource(db, caseId, sourceType)
      .filter((d: any) => d.id !== documentId && d.status !== 'DUPLICATE_FILE');

    let versionNumber = 1;
    let isCurrentVersion = true;
    let hasAmbiguity = false;
    let ambiguityReason: string | null = null;
    let previousVersionId: string | null = null;

    if (existingVersions.length > 0) {
      // Version number is max existing version + 1
      const maxVersion = Math.max(...existingVersions.map((d: any) => d.version_number || 1));
      versionNumber = maxVersion + 1;

      // Find current active version
      const currentDoc = existingVersions.find((d: any) => d.is_current_version === 1);
      if (currentDoc) {
        previousVersionId = currentDoc.id;
        const currentReceived = new Date(currentDoc.received_at).getTime();
        const newReceived = new Date(receivedAt).getTime();

        if (newReceived > currentReceived) {
          isCurrentVersion = true;
          // Demote all prior versions
          db.prepare('UPDATE documents SET is_current_version = 0 WHERE case_id = ? AND source_type = ? AND id != ?')
            .run(caseId, sourceType, documentId);
        } else if (newReceived < currentReceived) {
          isCurrentVersion = false;
        } else {
          // Timestamp tie!
          hasAmbiguity = true;
          ambiguityReason = `Timestamp tie detected: multiple versions share identical receivedAt (${receivedAt})`;
          isCurrentVersion = true; // Still mark current but flag ambiguity
          db.prepare('UPDATE documents SET is_current_version = 0 WHERE case_id = ? AND source_type = ? AND id != ?')
            .run(caseId, sourceType, documentId);
        }
      }
    }

    if (isCurrentVersion) {
      db.prepare('UPDATE documents SET is_current_version = 0 WHERE case_id = ? AND source_type = ? AND id != ?')
        .run(caseId, sourceType, documentId);
    }

    // Update document record with assigned version_number and is_current_version
    db.prepare(`
      UPDATE documents
      SET version_number = ?, is_current_version = ?
      WHERE id = ?
    `).run(versionNumber, isCurrentVersion ? 1 : 0, documentId);

    // Check case status: flag ambiguity for review or reopen matched/resolved cases
    const targetCase = caseRepo.findById(db, caseId);
    if (targetCase) {
      const now = new Date().toISOString();
      if (hasAmbiguity) {
        caseRepo.updateStatus(db, caseId, 'REVIEW_REQUIRED');
        db.prepare(`
          INSERT INTO audit_logs (id, entity_type, entity_id, action, details_json, performed_by, created_at)
          VALUES (?, 'CASE', ?, 'AMBIGUITY_DETECTED', ?, 'SYSTEM', ?)
        `).run(
          crypto.randomUUID(),
          caseId,
          JSON.stringify({ reason: ambiguityReason, documentId, caseId, receivedAt }),
          now
        );
      } else if (targetCase.status === 'MATCHED' || targetCase.status === 'RESOLVED') {
        caseRepo.updateStatus(db, caseId, 'OPEN');
        db.prepare(`
          INSERT INTO audit_logs (id, entity_type, entity_id, action, details_json, performed_by, created_at)
          VALUES (?, 'CASE', ?, 'STATUS_REOPENED_ON_NEW_DOCUMENT', ?, 'SYSTEM', ?)
        `).run(
          crypto.randomUUID(),
          caseId,
          JSON.stringify({ previousStatus: targetCase.status, newStatus: 'OPEN', documentId, caseId }),
          now
        );
      }
    }

    return {
      versionNumber,
      isCurrentVersion,
      hasAmbiguity,
      ambiguityReason,
      previousVersionId,
    };
  })();
}

export function getCurrentDocumentVersionIds(db: DatabaseType, caseId: string): string[] {
  const docs = documentRepo.findCurrentForCase(db, caseId);
  return docs
    .filter((d: any) => d.status === 'VALID')
    .map((d: any) => d.id);
}
