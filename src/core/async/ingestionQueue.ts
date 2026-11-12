import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'node:crypto';
import { documentRepo, extractedTextRepo, extractedFieldsRepo, extractionIssueRepo, lineItemRepo, headerAdjustmentRepo, runRepo, resultRepo, caseRepo } from '../../db/repositories/index.js';
import { detectDuplicates } from '../linking/duplicateDetector.js';
import { resolveSenderIdentity } from '../linking/senderResolver.js';
import { routeDocument } from '../linking/queueRouter.js';
import { extractEmailToStageA } from '../../extractors/emailExtractor.js';
import { extractPdfBufferToStageA, extractPdfTextToStageA } from '../../extractors/pdfExtractor.js';
import { extractJsonToStageA } from '../../extractors/jsonExtractor.js';
import { reconcileCase } from '../engine/reconciler.js';
import { StageADocument } from '../schema/stageA.schema.js';

export interface IngestionJobInput {
  documentId?: string;
  sourceType: 'EMAIL' | 'PDF' | 'JSON';
  rawText?: string;
  fileBuffer?: Buffer;
  pdfBase64?: string;
  jsonData?: any;
  storagePath?: string;
  messageId?: string;
  senderEmail?: string;
  spfStatus?: 'PASS' | 'FAIL' | 'SOFTFAIL' | 'NONE' | null;
  dkimStatus?: 'PASS' | 'FAIL' | 'NONE' | null;
  customerId?: string;
  poNumber?: string;
  expectedSources?: string[];
  reconcileOnComplete?: boolean;
}

export interface IngestionJob {
  id: string;
  documentId: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  caseId: string | null;
  routedToQueue: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  isDuplicate: boolean;
  duplicateOfId: string | null;
  isContentCandidate?: boolean;
  candidateOfId?: string | null;
}

export class IngestionQueue {
  private db: DatabaseType;
  private jobs: Map<string, IngestionJob> = new Map();

  constructor(db: DatabaseType) {
    this.db = db;
  }

  async enqueue(input: IngestionJobInput): Promise<IngestionJob> {
    const jobId = crypto.randomUUID();
    const documentId = input.documentId || crypto.randomUUID();
    const now = new Date().toISOString();

    // Decode base64 buffer if fileBuffer is not provided
    let candidateFileBuffer = input.fileBuffer;
    if (!candidateFileBuffer && input.pdfBase64) {
      try {
        candidateFileBuffer = Buffer.from(input.pdfBase64, 'base64');
      } catch {
        // ignore
      }
    }

    // Check duplicate detection first
    const dupCheck = detectDuplicates(this.db, {
      fileBuffer: candidateFileBuffer,
      messageId: input.messageId,
      rawText: input.rawText || (input.jsonData ? JSON.stringify(input.jsonData) : undefined),
    });

    if (dupCheck.isDuplicate) {
      // Store arrival event as DUPLICATE_FILE without overwriting or extracting
      documentRepo.insert(this.db, {
        id: documentId,
        sourceType: input.sourceType,
        status: 'DUPLICATE_FILE',
        storagePath: input.storagePath || null,
        fileHash: dupCheck.computedFileHash,
        messageId: input.messageId || null,
        contentHash: dupCheck.computedContentHash,
        senderEmail: input.senderEmail || null,
        spfStatus: input.spfStatus || null,
        dkimStatus: input.dkimStatus || null,
        duplicateOfId: dupCheck.duplicateOfId,
        receivedAt: now,
      });

      const job: IngestionJob = {
        id: jobId,
        documentId,
        status: 'COMPLETED',
        caseId: null,
        routedToQueue: null,
        errorMessage: null,
        createdAt: now,
        startedAt: now,
        completedAt: now,
        isDuplicate: true,
        duplicateOfId: dupCheck.duplicateOfId,
        isContentCandidate: false,
        candidateOfId: null,
      };
      this.jobs.set(jobId, job);
      return job;
    }

    // Insert document arrival event in RECEIVED status
    documentRepo.insert(this.db, {
      id: documentId,
      sourceType: input.sourceType,
      status: 'RECEIVED',
      storagePath: input.storagePath || null,
      fileHash: dupCheck.computedFileHash,
      messageId: input.messageId || null,
      contentHash: dupCheck.computedContentHash,
      senderEmail: input.senderEmail || null,
      spfStatus: input.spfStatus || null,
      dkimStatus: input.dkimStatus || null,
      receivedAt: now,
    });

    if (dupCheck.isContentCandidate) {
      this.db.prepare(`
        INSERT INTO audit_logs (id, entity_type, entity_id, action, details_json, performed_by, created_at)
        VALUES (?, 'DOCUMENT', ?, 'DUPLICATE_CONTENT_CANDIDATE', ?, 'SYSTEM', ?)
      `).run(
        crypto.randomUUID(),
        documentId,
        JSON.stringify({ candidateOfId: dupCheck.candidateOfId, contentHash: dupCheck.computedContentHash }),
        now
      );
    }

    const job: IngestionJob = {
      id: jobId,
      documentId,
      status: 'QUEUED',
      caseId: null,
      routedToQueue: null,
      errorMessage: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      isDuplicate: false,
      duplicateOfId: null,
      isContentCandidate: dupCheck.isContentCandidate,
      candidateOfId: dupCheck.candidateOfId,
    };
    this.jobs.set(jobId, job);

    // Schedule background processing
    setImmediate(() => {
      this.processJob(jobId, input).catch((err) => {
        const j = this.jobs.get(jobId);
        if (j) {
          j.status = 'FAILED';
          j.errorMessage = err.message || 'Unknown processing error';
          j.completedAt = new Date().toISOString();
        }
      });
    });

    return job;
  }

  async processJob(jobId: string, input: IngestionJobInput): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'PROCESSING';
    job.startedAt = new Date().toISOString();

    try {
      const documentId = job.documentId;
      const receivedAt = job.startedAt;
      const sourceType = input.sourceType;

      let stageA: StageADocument;
      let rawTextToStore = '';
      let cleanedTextToStore = '';
      let pageBreakOffsets: number[] = [0];
      let quoteStripMetadata: any = null;
      let extractionIssues: any[] = [];

      if (sourceType === 'EMAIL') {
        rawTextToStore = input.fileBuffer ? input.fileBuffer.toString('utf8') : input.rawText || '';
        const extraction = await extractEmailToStageA({
          rawText: rawTextToStore,
          documentId,
          receivedAt,
          senderEmail: input.senderEmail,
        });
        stageA = extraction.stageA;
        cleanedTextToStore = extraction.quoteStripResult.cleanedText;
        quoteStripMetadata = extraction.quoteStripResult.metadata;
        extractionIssues = extraction.issues;
      } else if (sourceType === 'PDF') {
        if (input.fileBuffer) {
          const extraction = await extractPdfBufferToStageA({
            buffer: input.fileBuffer,
            documentId,
            receivedAt,
            storagePath: input.storagePath,
          });
          stageA = extraction.stageA;
          rawTextToStore = extraction.rawText;
          cleanedTextToStore = extraction.rawText;
          pageBreakOffsets = extraction.pageBreakOffsets;
          extractionIssues = extraction.issues;
        } else if (input.pdfBase64) {
          const buf = Buffer.from(input.pdfBase64, 'base64');
          const extraction = await extractPdfBufferToStageA({
            buffer: buf,
            documentId,
            receivedAt,
            storagePath: input.storagePath,
          });
          stageA = extraction.stageA;
          rawTextToStore = extraction.rawText;
          cleanedTextToStore = extraction.rawText;
          pageBreakOffsets = extraction.pageBreakOffsets;
          extractionIssues = extraction.issues;
        } else {
          rawTextToStore = input.rawText || '';
          cleanedTextToStore = rawTextToStore;
          const extraction = extractPdfTextToStageA({
            rawText: rawTextToStore,
            documentId,
            receivedAt,
            storagePath: input.storagePath,
          });
          stageA = extraction.stageA;
          pageBreakOffsets = extraction.pageBreakOffsets;
          extractionIssues = extraction.issues;
        }
      } else {
        // JSON
        let jsonData = input.jsonData;
        if (input.fileBuffer) {
          jsonData = JSON.parse(input.fileBuffer.toString('utf8'));
        } else if (typeof jsonData === 'string') {
          jsonData = JSON.parse(jsonData);
        } else if (!jsonData && input.rawText) {
          jsonData = JSON.parse(input.rawText);
        }

        rawTextToStore = JSON.stringify(jsonData, null, 2);
        cleanedTextToStore = rawTextToStore;
        stageA = extractJsonToStageA({
          payload: jsonData,
          documentId,
          receivedAt,
        });
      }

      // Sender resolution
      const senderRes = resolveSenderIdentity({
        db: this.db,
        senderEmail: input.senderEmail || stageA.source.senderEmail,
        spfStatus: input.spfStatus,
        dkimStatus: input.dkimStatus,
        payloadCustomerId: input.customerId || stageA.order.customerId,
      });

      const effectiveCustomerId = input.customerId || senderRes.mappedCustomerId || stageA.order.customerId;
      const effectivePoNumber = input.poNumber || stageA.order.poNumber;

      // Queue routing
      const routeResult = routeDocument(this.db, {
        documentId,
        customerId: effectiveCustomerId,
        poNumber: effectivePoNumber,
        identityConflict: senderRes.hasIdentityConflict
          ? { hasConflict: true, reason: senderRes.identityConflictReason || 'Identity conflict detected' }
          : null,
        expectedSources: input.expectedSources,
      });

      // Update document status from RECEIVED to VALID
      documentRepo.updateStatus(this.db, documentId, 'VALID');

      // Persist extracted text
      extractedTextRepo.insert(this.db, {
        id: crypto.randomUUID(),
        documentId,
        rawText: rawTextToStore,
        cleanedText: cleanedTextToStore,
        pageBreakOffsets,
        quoteStripMetadata,
      });

      // Persist Stage A fields
      extractedFieldsRepo.insert(this.db, {
        id: crypto.randomUUID(),
        documentId,
        stage: 'STAGE_A',
        payload: stageA,
      });

      // Persist extraction issues
      for (const iss of extractionIssues) {
        extractionIssueRepo.insert(this.db, {
          id: crypto.randomUUID(),
          documentId,
          fieldPath: iss.fieldPath,
          code: iss.code,
          candidateValue: iss.candidateValue || null,
          rawValue: iss.rawValue || null,
          snippet: iss.snippet || null,
          isBlocking: iss.isBlocking,
        });
      }

      // Persist line items
      for (const item of stageA.lineItems) {
        lineItemRepo.insert(this.db, {
          id: crypto.randomUUID(),
          sourceDocumentId: documentId,
          lineReference: item.lineReference,
          productCode: item.productCode,
          normalizedProductCode: item.productCode ? item.productCode.trim().toUpperCase() : null,
          description: item.description,
          quantity: item.quantity,
          unitOfMeasure: item.unitOfMeasure,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount,
          taxableAmount: item.taxableAmount,
          lineTotal: item.lineTotal,
          taxesJson: item.taxes ? JSON.stringify(item.taxes) : null,
        });
      }

      // Persist header adjustments (Phase 3)
      if (stageA.headerAdjustments && stageA.headerAdjustments.length > 0) {
        for (const adj of stageA.headerAdjustments) {
          headerAdjustmentRepo.insert(this.db, {
            id: crypto.randomUUID(),
            documentId,
            type: adj.type,
            description: adj.description,
            amount: adj.amount || '0',
            taxesJson: adj.taxes ? JSON.stringify(adj.taxes) : null,
          });
        }
      }

      // Reconcile case if linked and requested
      if (routeResult.caseId && input.reconcileOnComplete) {
        const caseRow = caseRepo.findById(this.db, routeResult.caseId);
        if (caseRow) {
          const docRows = documentRepo.findCurrentForCase(this.db, routeResult.caseId)
            .filter((d: any) => d.status === 'VALID');
          const stageADocs: StageADocument[] = [];
          for (const d of docRows) {
            const fieldRow = extractedFieldsRepo.findByDocId(this.db, d.id, 'STAGE_A');
            if (fieldRow) {
              stageADocs.push(JSON.parse(fieldRow.payload_json));
            }
          }

          const expectedSources = JSON.parse(caseRow.expected_sources || '["EMAIL","PDF","JSON"]');
          const runId = crypto.randomUUID();
          const started = new Date().toISOString();

          const result = reconcileCase({
            db: this.db,
            caseId: routeResult.caseId,
            customerId: caseRow.customer_id,
            poNumber: caseRow.po_number,
            documents: stageADocs,
            expectedSources,
          });

          runRepo.insert(this.db, {
            id: runId,
            caseId: routeResult.caseId,
            status: 'COMPLETED',
            documentVersionIds: stageADocs.map((d) => d.source.documentId),
            initiatedBy: 'ASYNC_INGESTION',
            startedAt: started,
            completedAt: new Date().toISOString(),
          });

          resultRepo.insert(this.db, {
            id: crypto.randomUUID(),
            runId,
            caseId: routeResult.caseId,
            status: result.status,
            issues: result.issues,
            summary: result.summary,
          });

          caseRepo.updateStatus(this.db, routeResult.caseId, result.status);
        }
      }

      job.status = 'COMPLETED';
      job.caseId = routeResult.caseId;
      job.routedToQueue = routeResult.routedToQueue;
      job.completedAt = new Date().toISOString();
    } catch (err: any) {
      job.status = 'FAILED';
      job.errorMessage = err.message || 'Processing failed';
      job.completedAt = new Date().toISOString();
    }
  }

  getJob(jobId: string): IngestionJob | null {
    return this.jobs.get(jobId) || null;
  }

  listJobs(): IngestionJob[] {
    return Array.from(this.jobs.values());
  }

  async waitForJob(jobId: string, timeoutMs = 5000): Promise<IngestionJob> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const interval = setInterval(() => {
        const job = this.getJob(jobId);
        if (!job) {
          clearInterval(interval);
          reject(new Error(`Job ${jobId} not found`));
          return;
        }

        if (job.status === 'COMPLETED' || job.status === 'FAILED') {
          clearInterval(interval);
          resolve(job);
          return;
        }

        if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          reject(new Error(`Timeout waiting for job ${jobId}`));
        }
      }, 50);
    });
  }
}
