import { Database as DatabaseType } from 'better-sqlite3';
export { senderMappingRepo, SenderMappingRecord, SenderMappingInput } from './senderMappingRepo.js';
export { queueRepo, QueueRecord, QueueInput } from './queueRepo.js';
export { headerAdjustmentRepo, HeaderAdjustmentRecord, HeaderAdjustmentInput, HeaderAdjustmentType } from './headerAdjustmentRepo.js';
export { taxRateRepo, TaxRateRecord, TaxRateInput, TaxType } from './taxRateRepo.js';

export const caseRepo = {
  findById(db: DatabaseType, id: string) {
    return db.prepare('SELECT * FROM processing_cases WHERE id = ?').get(id) as any;
  },

  findByCustomerAndPo(db: DatabaseType, customerId: string, poNumber: string) {
    return db.prepare('SELECT * FROM processing_cases WHERE customer_id = ? AND po_number = ?').get(customerId, poNumber) as any;
  },

  findAll(db: DatabaseType) {
    return db.prepare('SELECT * FROM processing_cases ORDER BY created_at DESC').all() as any[];
  },

  updateStatus(db: DatabaseType, id: string, status: string) {
    const now = new Date().toISOString();
    return db.prepare('UPDATE processing_cases SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  },
};

export const documentRepo = {
  insert(db: DatabaseType, doc: {
    id: string;
    caseId?: string | null;
    sourceType: 'EMAIL' | 'PDF' | 'JSON';
    status: 'RECEIVED' | 'VALID' | 'INVALID' | 'DUPLICATE_FILE';
    storagePath?: string | null;
    fileHash?: string | null;
    messageId?: string | null;
    contentHash?: string | null;
    senderEmail?: string | null;
    spfStatus?: 'PASS' | 'FAIL' | 'SOFTFAIL' | 'NONE' | null;
    dkimStatus?: 'PASS' | 'FAIL' | 'NONE' | null;
    versionNumber?: number;
    isCurrentVersion?: boolean | number;
    duplicateOfId?: string | null;
    receivedAt: string;
  }) {
    const now = new Date().toISOString();
    const versionNumber = doc.versionNumber !== undefined ? doc.versionNumber : 1;
    const isCurrentVersion = doc.isCurrentVersion === undefined ? 1 : (doc.isCurrentVersion ? 1 : 0);

    return db.prepare(`
      INSERT INTO documents (
        id, case_id, source_type, status, storage_path, file_hash, message_id,
        content_hash, sender_email, spf_status, dkim_status, version_number,
        is_current_version, duplicate_of_id, received_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      doc.id,
      doc.caseId || null,
      doc.sourceType,
      doc.status,
      doc.storagePath || null,
      doc.fileHash || null,
      doc.messageId || null,
      doc.contentHash || null,
      doc.senderEmail || null,
      doc.spfStatus || null,
      doc.dkimStatus || null,
      versionNumber,
      isCurrentVersion,
      doc.duplicateOfId || null,
      doc.receivedAt,
      now
    );
  },

  findById(db: DatabaseType, id: string) {
    return db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
  },

  findForCase(db: DatabaseType, caseId: string) {
    return db.prepare('SELECT * FROM documents WHERE case_id = ? ORDER BY version_number ASC, received_at ASC').all(caseId) as any[];
  },

  findCurrentForCase(db: DatabaseType, caseId: string) {
    return db.prepare('SELECT * FROM documents WHERE case_id = ? AND is_current_version = 1').all(caseId) as any[];
  },

  findVersionsForCaseAndSource(db: DatabaseType, caseId: string, sourceType: string) {
    return db.prepare('SELECT * FROM documents WHERE case_id = ? AND source_type = ? ORDER BY version_number DESC').all(caseId, sourceType) as any[];
  },

  findByFileHash(db: DatabaseType, fileHash: string) {
    return db.prepare('SELECT * FROM documents WHERE file_hash = ? AND status != ? ORDER BY received_at ASC LIMIT 1').get(fileHash, 'DUPLICATE_FILE') as any;
  },

  findByMessageId(db: DatabaseType, messageId: string) {
    return db.prepare('SELECT * FROM documents WHERE message_id = ? AND status != ? ORDER BY received_at ASC LIMIT 1').get(messageId, 'DUPLICATE_FILE') as any;
  },

  findByContentHash(db: DatabaseType, contentHash: string) {
    return db.prepare('SELECT * FROM documents WHERE content_hash = ? AND status != ? ORDER BY received_at ASC LIMIT 1').get(contentHash, 'DUPLICATE_FILE') as any;
  },

  updateCurrentVersion(db: DatabaseType, id: string, isCurrent: boolean | number) {
    const val = isCurrent ? 1 : 0;
    return db.prepare('UPDATE documents SET is_current_version = ? WHERE id = ?').run(val, id);
  },

  updateCaseId(db: DatabaseType, id: string, caseId: string | null) {
    return db.prepare('UPDATE documents SET case_id = ? WHERE id = ?').run(caseId, id);
  },

  updateStatus(db: DatabaseType, id: string, status: string) {
    return db.prepare('UPDATE documents SET status = ? WHERE id = ?').run(status, id);
  },
};

export const extractedTextRepo = {
  insert(db: DatabaseType, data: {
    id: string;
    documentId: string;
    rawText: string;
    cleanedText: string;
    pageBreakOffsets?: number[] | null;
    quoteStripMetadata?: any;
  }) {
    const now = new Date().toISOString();
    return db.prepare(`
      INSERT INTO extracted_text (id, document_id, raw_text, cleaned_text, page_break_offsets, quote_strip_metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id,
      data.documentId,
      data.rawText,
      data.cleanedText,
      data.pageBreakOffsets ? JSON.stringify(data.pageBreakOffsets) : null,
      data.quoteStripMetadata ? JSON.stringify(data.quoteStripMetadata) : null,
      now
    );
  },

  findByDocId(db: DatabaseType, documentId: string) {
    return db.prepare('SELECT * FROM extracted_text WHERE document_id = ?').get(documentId) as any;
  },
};

export const extractedFieldsRepo = {
  insert(db: DatabaseType, data: {
    id: string;
    documentId: string;
    stage: 'STAGE_A' | 'STAGE_B';
    payload: any;
  }) {
    const now = new Date().toISOString();
    return db.prepare(`
      INSERT INTO extracted_fields (id, document_id, stage, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(data.id, data.documentId, data.stage, JSON.stringify(data.payload), now);
  },

  findByDocId(db: DatabaseType, documentId: string, stage: 'STAGE_A' | 'STAGE_B') {
    return db.prepare('SELECT * FROM extracted_fields WHERE document_id = ? AND stage = ?').get(documentId, stage) as any;
  },
};

export const runRepo = {
  insert(db: DatabaseType, run: {
    id: string;
    caseId: string;
    status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    documentVersionIds: string[];
    initiatedBy: string;
    startedAt: string;
    completedAt?: string | null;
    errorMessage?: string | null;
  }) {
    return db.prepare(`
      INSERT INTO reconciliation_runs (id, case_id, status, document_version_ids, initiated_by, started_at, completed_at, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id,
      run.caseId,
      run.status,
      JSON.stringify(run.documentVersionIds),
      run.initiatedBy,
      run.startedAt,
      run.completedAt || null,
      run.errorMessage || null
    );
  },
};

export const resultRepo = {
  insert(db: DatabaseType, res: {
    id: string;
    runId: string;
    caseId: string;
    status: string;
    issues: any[];
    summary: any;
  }) {
    const now = new Date().toISOString();
    return db.prepare(`
      INSERT INTO reconciliation_results (id, run_id, case_id, status, issues_json, summary_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      res.id,
      res.runId,
      res.caseId,
      res.status,
      JSON.stringify(res.issues),
      JSON.stringify(res.summary),
      now
    );
  },

  findByCaseId(db: DatabaseType, caseId: string) {
    return db.prepare('SELECT * FROM reconciliation_results WHERE case_id = ? ORDER BY created_at DESC LIMIT 1').get(caseId) as any;
  },
};

export const extractionIssueRepo = {
  insert(db: DatabaseType, issue: {
    id: string;
    documentId: string;
    fieldPath: string;
    code: string;
    candidateValue?: string | null;
    rawValue?: string | null;
    snippet?: string | null;
    isBlocking: boolean;
  }) {
    const now = new Date().toISOString();
    return db.prepare(`
      INSERT INTO extraction_issues (id, document_id, field_path, code, candidate_value, raw_value, snippet, is_blocking, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      issue.id,
      issue.documentId,
      issue.fieldPath,
      issue.code,
      issue.candidateValue || null,
      issue.rawValue || null,
      issue.snippet || null,
      issue.isBlocking ? 1 : 0,
      now
    );
  },

  findByDocumentId(db: DatabaseType, documentId: string) {
    return db.prepare('SELECT * FROM extraction_issues WHERE document_id = ?').all(documentId) as any[];
  },

  findByDocumentIds(db: DatabaseType, documentIds: string[]) {
    if (!documentIds.length) return [];
    const placeholders = documentIds.map(() => '?').join(',');
    return db.prepare(`SELECT * FROM extraction_issues WHERE document_id IN (${placeholders})`).all(...documentIds) as any[];
  },
};

export const lineItemRepo = {
  insert(db: DatabaseType, item: {
    id: string;
    sourceDocumentId: string;
    lineReference?: string | null;
    productCode?: string | null;
    normalizedProductCode?: string | null;
    description?: string | null;
    quantity?: string | null;
    unitOfMeasure?: string | null;
    normalizedUom?: string | null;
    unitPrice?: string | null;
    discountAmount?: string | null;
    taxableAmount?: string | null;
    lineTotal?: string | null;
    taxesJson?: string | null;
  }) {
    const now = new Date().toISOString();
    return db.prepare(`
      INSERT INTO line_items (
        id, source_document_id, line_reference, product_code, normalized_product_code,
        description, quantity, unit_of_measure, normalized_uom, unit_price,
        discount_amount, taxable_amount, line_total, taxes_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id,
      item.sourceDocumentId,
      item.lineReference || null,
      item.productCode || null,
      item.normalizedProductCode || null,
      item.description || null,
      item.quantity || null,
      item.unitOfMeasure || null,
      item.normalizedUom || null,
      item.unitPrice || null,
      item.discountAmount || null,
      item.taxableAmount || null,
      item.lineTotal || null,
      item.taxesJson || null,
      now
    );
  },

  findByDocId(db: DatabaseType, documentId: string) {
    return db.prepare('SELECT * FROM line_items WHERE source_document_id = ?').all(documentId) as any[];
  },
};

export const reviewRepo = {
  insertDecision(db: DatabaseType, decision: {
    id: string;
    caseId: string;
    issueFingerprint: string;
    field: string;
    lineReference?: string | null;
    previousValue?: string | null;
    selectedValue: string;
    reason: string;
    reviewer: string;
    documentVersionIds: string[];
    supersedesId?: string | null;
  }): { decisionId: string; supersededId: string | null } {
    const now = new Date().toISOString();
    return db.transaction(() => {
      // Find existing active decision to supersede before inserting
      let prevId = decision.supersedesId || null;
      if (!prevId) {
        const existing = db.prepare(
          'SELECT id FROM review_decisions WHERE case_id = ? AND issue_fingerprint = ? AND superseded_by IS NULL'
        ).get(decision.caseId, decision.issueFingerprint) as { id: string } | undefined;
        if (existing) {
          prevId = existing.id;
        }
      }

      // 1. Insert new decision first so it exists for foreign key references
      db.prepare(`
        INSERT INTO review_decisions (id, case_id, issue_fingerprint, field, line_reference, previous_value, selected_value, reason, reviewer, document_version_ids, superseded_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      `).run(
        decision.id,
        decision.caseId,
        decision.issueFingerprint,
        decision.field,
        decision.lineReference || null,
        decision.previousValue || null,
        decision.selectedValue,
        decision.reason,
        decision.reviewer,
        JSON.stringify(decision.documentVersionIds),
        now
      );

      // 2. Now update the previous decision's superseded_by pointer
      if (prevId) {
        db.prepare('UPDATE review_decisions SET superseded_by = ? WHERE id = ?').run(
          decision.id,
          prevId
        );
      }

      return { decisionId: decision.id, supersededId: prevId };
    })();
  },

  findActiveForCase(db: DatabaseType, caseId: string) {
    return db.prepare('SELECT * FROM review_decisions WHERE case_id = ? AND superseded_by IS NULL').all(caseId) as any[];
  },

  findAllForCase(db: DatabaseType, caseId: string) {
    return db.prepare('SELECT * FROM review_decisions WHERE case_id = ? ORDER BY created_at ASC').all(caseId) as any[];
  },
};

export const auditRepo = {
  findByCaseAndDocIds(db: DatabaseType, caseId: string, docIds: string[] = []) {
    if (docIds.length === 0) {
      return db.prepare('SELECT * FROM audit_logs WHERE (entity_type = ? AND entity_id = ?) ORDER BY created_at ASC')
        .all('CASE', caseId) as any[];
    }
    const placeholders = docIds.map(() => '?').join(',');
    return db.prepare(`
      SELECT * FROM audit_logs
      WHERE (entity_type = 'CASE' AND entity_id = ?)
         OR (entity_type = 'DOCUMENT' AND entity_id IN (${placeholders}))
      ORDER BY created_at ASC
    `).all(caseId, ...docIds) as any[];
  },

  insert(db: DatabaseType, log: {
    id?: string;
    entityType: string;
    entityId: string;
    action: string;
    details: any;
    performedBy: string;
    createdAt?: string;
  }) {
    const now = log.createdAt || new Date().toISOString();
    const id = log.id || crypto.randomUUID();
    return db.prepare(`
      INSERT INTO audit_logs (id, entity_type, entity_id, action, details_json, performed_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      log.entityType,
      log.entityId,
      log.action,
      typeof log.details === 'string' ? log.details : JSON.stringify(log.details),
      log.performedBy,
      now
    );
  },
};

