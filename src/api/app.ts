import express, { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { Database as DatabaseType } from 'better-sqlite3';
import { caseRepo, documentRepo, extractedTextRepo, extractedFieldsRepo, runRepo, resultRepo, reviewRepo, extractionIssueRepo, lineItemRepo, headerAdjustmentRepo, taxRateRepo, auditRepo } from '../db/repositories/index.js';
import { resolveOrCreateCase, linkDocumentToCase } from '../core/linking/caseLinker.js';
import { extractEmailToStageA } from '../extractors/emailExtractor.js';
import { extractJsonToStageA } from '../extractors/jsonExtractor.js';
import { extractPdfTextToStageA, extractPdfBufferToStageA } from '../extractors/pdfExtractor.js';
import { reconcileCase } from '../core/engine/reconciler.js';
import { StageADocument } from '../core/schema/stageA.schema.js';
import { getDashboardHtml } from './dashboardHtml.js';
import { IngestionQueue } from '../core/async/ingestionQueue.js';
import { detectDuplicates } from '../core/linking/duplicateDetector.js';
import { resolveSenderIdentity } from '../core/linking/senderResolver.js';
import { routeDocument, getQueuedItems, resolveQueueItem } from '../core/linking/queueRouter.js';
import { assignDocumentVersion } from '../core/linking/versionManager.js';
import { evaluateCaseDeadlines } from '../core/scheduler/deadlineChecker.js';
import { explainDiscrepancy } from '../core/ai/discrepancyExplainer.js';
import { parseInboundWebhook } from '../extractors/inboundEmailParser.js';

export function createExpressApp(db: DatabaseType, customQueue?: IngestionQueue): Express {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const ingestionQueue = customQueue || new IngestionQueue(db);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  // Serve Operations Dashboard
  app.get('/', (req: Request, res: Response): void => {
    res.type('html').send(getDashboardHtml());
  });

  app.get('/dashboard', (req: Request, res: Response): void => {
    res.type('html').send(getDashboardHtml());
  });

  // Ingest Document (supports JSON body and multipart file upload)
  app.post('/api/documents', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
    try {
      let sourceType = req.body.sourceType;
      const explicitCaseId = req.body.caseId;
      const explicitCustId = req.body.customerId;
      const explicitPo = req.body.poNumber;
      const senderEmail = req.body.senderEmail;
      let storagePath = req.body.storagePath;

      if (!sourceType && req.file) {
        const mime = req.file.mimetype || '';
        const fname = req.file.originalname || '';
        if (mime === 'application/pdf' || fname.endsWith('.pdf')) {
          sourceType = 'PDF';
        } else if (mime === 'application/json' || fname.endsWith('.json')) {
          sourceType = 'JSON';
        } else if (mime.includes('text') || fname.endsWith('.eml') || fname.endsWith('.txt')) {
          sourceType = 'EMAIL';
        }
      }

      if (!sourceType || !['EMAIL', 'PDF', 'JSON'].includes(sourceType)) {
        res.status(400).json({ error: 'sourceType must be EMAIL, PDF, or JSON' });
        return;
      }

      const documentId = crypto.randomUUID();
      const receivedAt = new Date().toISOString();

      // Check async ingestion mode
      if (req.query.async === 'true' || req.body.async === true) {
        let expectedSources: string[] = ['EMAIL', 'PDF', 'JSON'];
        if (req.body.expectedSources) {
          if (Array.isArray(req.body.expectedSources)) {
            expectedSources = req.body.expectedSources;
          } else if (typeof req.body.expectedSources === 'string') {
            try {
              expectedSources = JSON.parse(req.body.expectedSources);
            } catch {
              // ignore
            }
          }
        }

        const job = await ingestionQueue.enqueue({
          documentId,
          sourceType,
          rawText: req.body.rawText,
          fileBuffer: req.file?.buffer,
          pdfBase64: req.body.pdfBase64,
          jsonData: req.body.jsonData,
          storagePath,
          messageId: req.body.messageId,
          senderEmail,
          spfStatus: req.body.spfStatus,
          dkimStatus: req.body.dkimStatus,
          customerId: explicitCustId,
          poNumber: explicitPo,
          expectedSources,
          reconcileOnComplete: req.body.reconcile === true,
        });

        res.status(202).json({
          jobId: job.id,
          status: job.status,
          documentId: job.documentId,
          isDuplicate: job.isDuplicate,
          duplicateOfId: job.duplicateOfId,
          isContentCandidate: job.isContentCandidate || false,
          candidateOfId: job.candidateOfId || null,
        });
        return;
      }

      // If a file was uploaded, save it to storage/uploads unless storagePath already provided
      if (req.file) {
        const uploadsDir = path.resolve(process.cwd(), 'storage', 'uploads');
        fs.mkdirSync(uploadsDir, { recursive: true });
        const safeFilename = `${documentId}-${path.basename(req.file.originalname)}`;
        const savedPath = path.join(uploadsDir, safeFilename);
        fs.writeFileSync(savedPath, req.file.buffer);
        if (!storagePath) {
          storagePath = savedPath;
        }
      }

      // Check duplicate detection before parsing/extraction
      let candidateRawForDup = req.body.rawText;
      if (!candidateRawForDup && req.body.jsonData) {
        candidateRawForDup = typeof req.body.jsonData === 'string' ? req.body.jsonData : JSON.stringify(req.body.jsonData);
      }
      let candidateFileBuffer = req.file?.buffer;
      if (!candidateFileBuffer && req.body.pdfBase64) {
        try {
          candidateFileBuffer = Buffer.from(req.body.pdfBase64, 'base64');
        } catch {
          // ignore
        }
      }
      const dup = detectDuplicates(db, {
        fileBuffer: candidateFileBuffer,
        messageId: req.body.messageId,
        rawText: candidateRawForDup,
      });

      if (dup.isDuplicate) {
        documentRepo.insert(db, {
          id: documentId,
          sourceType,
          status: 'DUPLICATE_FILE',
          storagePath: storagePath || null,
          fileHash: dup.computedFileHash,
          messageId: req.body.messageId || null,
          contentHash: dup.computedContentHash,
          senderEmail,
          spfStatus: req.body.spfStatus || null,
          dkimStatus: req.body.dkimStatus || null,
          duplicateOfId: dup.duplicateOfId,
          receivedAt,
        });

        res.status(200).json({
          documentId,
          status: 'DUPLICATE_FILE',
          duplicateOfId: dup.duplicateOfId,
          message: 'Duplicate document detected; arrival event recorded without re-extraction',
        });
        return;
      }

      let stageA: StageADocument;
      let rawTextToStore = '';
      let cleanedTextToStore = '';
      let pageBreakOffsets: number[] = [0];
      let quoteStripMetadata: any = null;
      let extractionIssues: any[] = [];

      if (sourceType === 'EMAIL') {
        if (req.file && req.file.buffer) {
          rawTextToStore = req.file.buffer.toString('utf8');
        } else {
          rawTextToStore = req.body.rawText || '';
        }

        const extraction = await extractEmailToStageA({
          rawText: rawTextToStore,
          documentId,
          receivedAt,
          senderEmail,
        });
        stageA = extraction.stageA;
        cleanedTextToStore = extraction.quoteStripResult.cleanedText;
        quoteStripMetadata = extraction.quoteStripResult.metadata;
        extractionIssues = extraction.issues;
      } else if (sourceType === 'PDF') {
        if (req.file && req.file.buffer) {
          const extraction = await extractPdfBufferToStageA({
            buffer: req.file.buffer,
            documentId,
            receivedAt,
            storagePath,
          });
          stageA = extraction.stageA;
          rawTextToStore = extraction.rawText;
          cleanedTextToStore = extraction.rawText;
          pageBreakOffsets = extraction.pageBreakOffsets;
          extractionIssues = extraction.issues;
        } else if (req.body.pdfBase64) {
          const buf = Buffer.from(req.body.pdfBase64, 'base64');
          const extraction = await extractPdfBufferToStageA({
            buffer: buf,
            documentId,
            receivedAt,
            storagePath,
          });
          stageA = extraction.stageA;
          rawTextToStore = extraction.rawText;
          cleanedTextToStore = extraction.rawText;
          pageBreakOffsets = extraction.pageBreakOffsets;
          extractionIssues = extraction.issues;
        } else if (storagePath && fs.existsSync(storagePath) && fs.statSync(storagePath).isFile() && storagePath.endsWith('.pdf')) {
          const buf = fs.readFileSync(storagePath);
          const extraction = await extractPdfBufferToStageA({
            buffer: buf,
            documentId,
            receivedAt,
            storagePath,
          });
          stageA = extraction.stageA;
          rawTextToStore = extraction.rawText;
          cleanedTextToStore = extraction.rawText;
          pageBreakOffsets = extraction.pageBreakOffsets;
          extractionIssues = extraction.issues;
        } else {
          rawTextToStore = req.body.rawText || '';
          cleanedTextToStore = rawTextToStore;
          const extraction = extractPdfTextToStageA({
            rawText: rawTextToStore,
            documentId,
            receivedAt,
            storagePath,
          });
          stageA = extraction.stageA;
          pageBreakOffsets = extraction.pageBreakOffsets;
          extractionIssues = extraction.issues;
        }
      } else {
        // JSON
        let jsonData = req.body.jsonData;
        if (req.file && req.file.buffer) {
          jsonData = JSON.parse(req.file.buffer.toString('utf8'));
        } else if (typeof jsonData === 'string') {
          jsonData = JSON.parse(jsonData);
        } else if (!jsonData && req.body.rawText) {
          jsonData = JSON.parse(req.body.rawText);
        }

        rawTextToStore = JSON.stringify(jsonData, null, 2);
        cleanedTextToStore = rawTextToStore;
        stageA = extractJsonToStageA({
          payload: jsonData,
          documentId,
          receivedAt,
        });
      }

      // Persist document arrival event in RECEIVED status
      documentRepo.insert(db, {
        id: documentId,
        sourceType,
        status: 'RECEIVED',
        storagePath: storagePath || null,
        fileHash: dup.computedFileHash,
        messageId: req.body.messageId || null,
        contentHash: dup.computedContentHash,
        senderEmail,
        spfStatus: req.body.spfStatus || null,
        dkimStatus: req.body.dkimStatus || null,
        receivedAt,
      });

      // Sender resolution
      const senderRes = resolveSenderIdentity({
        db,
        senderEmail: senderEmail || stageA.source.senderEmail,
        spfStatus: req.body.spfStatus,
        dkimStatus: req.body.dkimStatus,
        payloadCustomerId: explicitCustId || stageA.order.customerId,
      });

      const effectiveCustomerId = explicitCustId || senderRes.mappedCustomerId || stageA.order.customerId;
      const effectivePoNumber = explicitPo || stageA.order.poNumber;

      let expectedSources: string[] = ['EMAIL', 'PDF', 'JSON'];
      if (req.body.expectedSources) {
        if (Array.isArray(req.body.expectedSources)) {
          expectedSources = req.body.expectedSources;
        } else if (typeof req.body.expectedSources === 'string') {
          try {
            expectedSources = JSON.parse(req.body.expectedSources);
          } catch {
            // ignore
          }
        }
      }

      let finalCaseId = explicitCaseId || null;
      let routedToQueue: string | null = null;

      // If no explicitCaseId and customerId was missing from document, check if PO number matches an existing case
      if (!finalCaseId && !effectiveCustomerId && effectivePoNumber) {
        const existingCase = caseRepo.findByPoNumber(db, effectivePoNumber);
        if (existingCase && existingCase.id) {
          finalCaseId = existingCase.id;
        }
      }

      if (finalCaseId) {
        linkDocumentToCase(db, documentId, finalCaseId);
        assignDocumentVersion(db, {
          caseId: finalCaseId,
          sourceType,
          documentId,
          receivedAt,
        });
      } else {
        const routeResult = routeDocument(db, {
          documentId,
          customerId: effectiveCustomerId,
          poNumber: effectivePoNumber,
          identityConflict: senderRes.hasIdentityConflict
            ? { hasConflict: true, reason: senderRes.identityConflictReason || 'Identity conflict detected' }
            : null,
          expectedSources,
        });
        finalCaseId = routeResult.caseId;
        routedToQueue = routeResult.routedToQueue;
      }

      // Mark document as VALID
      documentRepo.updateStatus(db, documentId, 'VALID');

      if (dup.isContentCandidate) {
        db.prepare(`
          INSERT INTO audit_logs (id, entity_type, entity_id, action, details_json, performed_by, created_at)
          VALUES (?, 'DOCUMENT', ?, 'DUPLICATE_CONTENT_CANDIDATE', ?, 'SYSTEM', ?)
        `).run(
          crypto.randomUUID(),
          documentId,
          JSON.stringify({ candidateOfId: dup.candidateOfId, contentHash: dup.computedContentHash }),
          receivedAt
        );
      }

      // Persist extracted text (Fix 5, 6, 7 & 11)
      const extractedTextId = crypto.randomUUID();
      extractedTextRepo.insert(db, {
        id: extractedTextId,
        documentId,
        rawText: rawTextToStore,
        cleanedText: cleanedTextToStore,
        pageBreakOffsets,
        quoteStripMetadata,
      });

      // Persist Stage A fields
      extractedFieldsRepo.insert(db, {
        id: crypto.randomUUID(),
        documentId,
        stage: 'STAGE_A',
        payload: stageA,
      });

      // Persist extraction issues
      for (const iss of extractionIssues) {
        extractionIssueRepo.insert(db, {
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
        lineItemRepo.insert(db, {
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
          headerAdjustmentRepo.insert(db, {
            id: crypto.randomUUID(),
            documentId,
            type: adj.type,
            description: adj.description,
            amount: adj.amount || '0',
            taxesJson: adj.taxes ? JSON.stringify(adj.taxes) : null,
          });
        }
      }

      res.status(201).json({
        documentId,
        caseId: finalCaseId,
        routedToQueue,
        status: 'VALID',
        isContentCandidate: dup.isContentCandidate,
        candidateOfId: dup.candidateOfId,
        stageA,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Ingestion failed' });
    }
  });

  // Inbound Email Webhook (Atomic 2-in-1 Email + PDF ingestion with real-time reconciliation)
  app.post('/api/webhooks/inbound-email', upload.any(), async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = parseInboundWebhook({
        body: req.body,
        files: (req.files as any) || [],
      });

      if (!parsed.bodyText && parsed.pdfAttachments.length === 0) {
        res.status(400).json({ error: 'No email body or PDF attachments found in payload' });
        return;
      }

      const receivedAt = new Date().toISOString();
      const ingestedDocs: Array<{ id: string; sourceType: string; poNumber: string | null; customerId: string | null }> = [];
      let finalCaseId: string | null = null;
      let resolvedPoNumber: string | null = null;
      let resolvedCustomerId: string | null = null;

      // 1. Ingest Email Body
      const emailDocId = crypto.randomUUID();
      let emailStageA: StageADocument | null = null;

      if (parsed.bodyText) {
        const emailExtraction = await extractEmailToStageA({
          rawText: parsed.bodyText,
          documentId: emailDocId,
          receivedAt,
          senderEmail: parsed.senderEmail,
        });

        emailStageA = emailExtraction.stageA;
        resolvedPoNumber = emailStageA.order.poNumber;
        resolvedCustomerId = emailStageA.order.customerId;

        // Sender resolution
        const senderRes = resolveSenderIdentity({
          db,
          senderEmail: parsed.senderEmail || emailStageA.source.senderEmail,
          spfStatus: parsed.spfStatus,
          dkimStatus: parsed.dkimStatus,
          payloadCustomerId: resolvedCustomerId,
        });

        const effectiveCust = senderRes.mappedCustomerId || resolvedCustomerId;

        // Persist Email document
        documentRepo.insert(db, {
          id: emailDocId,
          sourceType: 'EMAIL',
          status: 'VALID',
          storagePath: null,
          senderEmail: parsed.senderEmail,
          spfStatus: parsed.spfStatus || null,
          dkimStatus: parsed.dkimStatus || null,
          receivedAt,
        });

        // Route document to create or link case
        const route = routeDocument(db, {
          documentId: emailDocId,
          customerId: effectiveCust,
          poNumber: resolvedPoNumber,
          identityConflict: senderRes.hasIdentityConflict
            ? { hasConflict: true, reason: senderRes.identityConflictReason || 'Identity conflict' }
            : null,
        });

        finalCaseId = route.caseId;

        // Persist extracted text and fields
        extractedTextRepo.insert(db, {
          id: crypto.randomUUID(),
          documentId: emailDocId,
          rawText: parsed.bodyText,
          cleanedText: emailExtraction.quoteStripResult.cleanedText,
          pageBreakOffsets: [0],
          quoteStripMetadata: emailExtraction.quoteStripResult.metadata,
        });

        extractedFieldsRepo.insert(db, {
          id: crypto.randomUUID(),
          documentId: emailDocId,
          stage: 'STAGE_A',
          payload: emailStageA,
        });

        for (const item of emailStageA.lineItems) {
          lineItemRepo.insert(db, {
            id: crypto.randomUUID(),
            sourceDocumentId: emailDocId,
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

        ingestedDocs.push({
          id: emailDocId,
          sourceType: 'EMAIL',
          poNumber: resolvedPoNumber,
          customerId: effectiveCust,
        });
      }

      // 2. Ingest Attached PDFs
      const uploadsDir = path.resolve(process.cwd(), 'storage', 'uploads');
      fs.mkdirSync(uploadsDir, { recursive: true });

      for (const pdf of parsed.pdfAttachments) {
        const pdfDocId = crypto.randomUUID();
        const safeName = `${pdfDocId}-${path.basename(pdf.filename)}`;
        const savedPath = path.join(uploadsDir, safeName);
        fs.writeFileSync(savedPath, pdf.buffer);

        const pdfExtraction = await extractPdfBufferToStageA({
          buffer: pdf.buffer,
          documentId: pdfDocId,
          receivedAt,
          storagePath: savedPath,
        });

        const pdfStageA = pdfExtraction.stageA;
        if (!resolvedPoNumber && pdfStageA.order.poNumber) {
          resolvedPoNumber = pdfStageA.order.poNumber;
        }
        if (!resolvedCustomerId && pdfStageA.order.customerId) {
          resolvedCustomerId = pdfStageA.order.customerId;
        }

        // If no case yet, route PDF
        if (!finalCaseId) {
          const route = routeDocument(db, {
            documentId: pdfDocId,
            customerId: resolvedCustomerId,
            poNumber: resolvedPoNumber,
          });
          finalCaseId = route.caseId;
        }

        documentRepo.insert(db, {
          id: pdfDocId,
          sourceType: 'PDF',
          status: 'VALID',
          storagePath: savedPath,
          receivedAt,
        });

        if (finalCaseId) {
          linkDocumentToCase(db, pdfDocId, finalCaseId);
          assignDocumentVersion(db, {
            caseId: finalCaseId,
            sourceType: 'PDF',
            documentId: pdfDocId,
            receivedAt,
          });
        }

        extractedTextRepo.insert(db, {
          id: crypto.randomUUID(),
          documentId: pdfDocId,
          rawText: pdfExtraction.rawText,
          cleanedText: pdfExtraction.rawText,
          pageBreakOffsets: pdfExtraction.pageBreakOffsets,
        });

        extractedFieldsRepo.insert(db, {
          id: crypto.randomUUID(),
          documentId: pdfDocId,
          stage: 'STAGE_A',
          payload: pdfStageA,
        });

        for (const item of pdfStageA.lineItems) {
          lineItemRepo.insert(db, {
            id: crypto.randomUUID(),
            sourceDocumentId: pdfDocId,
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

        ingestedDocs.push({
          id: pdfDocId,
          sourceType: 'PDF',
          poNumber: pdfStageA.order.poNumber,
          customerId: pdfStageA.order.customerId,
        });
      }

      // 3. Real-Time Reconciliation Trigger
      let reconSummary: any = null;
      if (finalCaseId) {
        const caseRow = caseRepo.findById(db, finalCaseId);
        const docRows = documentRepo.findCurrentForCase(db, finalCaseId).filter((d: any) => d.status === 'VALID');
        const stageADocs: StageADocument[] = [];

        for (const d of docRows) {
          const fieldRow = extractedFieldsRepo.findByDocId(db, d.id, 'STAGE_A');
          if (fieldRow) {
            stageADocs.push(JSON.parse(fieldRow.payload_json));
          }
        }

        const expectedSources = JSON.parse(caseRow.expected_sources || '["EMAIL","PDF","JSON"]');
        const reconResult = reconcileCase({
          db,
          caseId: finalCaseId,
          customerId: caseRow.customer_id,
          poNumber: caseRow.po_number,
          documents: stageADocs,
          expectedSources,
        });

        const runId = crypto.randomUUID();
        runRepo.insert(db, {
          id: runId,
          caseId: finalCaseId,
          status: 'COMPLETED',
          documentVersionIds: stageADocs.map((d) => d.source.documentId),
          initiatedBy: 'INBOUND_WEBHOOK',
          startedAt: receivedAt,
          completedAt: new Date().toISOString(),
        });

        resultRepo.insert(db, {
          id: crypto.randomUUID(),
          runId,
          caseId: finalCaseId,
          status: reconResult.status,
          issues: reconResult.issues,
          summary: reconResult.summary,
        });

        caseRepo.updateStatus(db, finalCaseId, reconResult.status);

        reconSummary = {
          runId,
          status: reconResult.status,
          issuesCount: reconResult.issues.length,
          issues: reconResult.issues,
        };
      }

      res.status(200).json({
        success: true,
        message: `Inbound email and ${parsed.pdfAttachments.length} PDF attachment(s) ingested in real time`,
        caseId: finalCaseId,
        poNumber: resolvedPoNumber,
        customerId: resolvedCustomerId,
        documentsIngested: ingestedDocs,
        reconciliation: reconSummary,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Inbound webhook processing failed' });
    }
  });

  // Link an existing document to a case manually (Phase 1 Fix 4 & Fix 5)
  app.post('/api/documents/:id/link', (req: Request, res: Response): void => {
    try {
      const documentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const { caseId } = req.body;
      if (!caseId) {
        res.status(400).json({ error: 'caseId is required' });
        return;
      }
      const doc = documentRepo.findById(db, documentId);
      if (!doc) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      const caseRow = caseRepo.findById(db, caseId);
      if (!caseRow) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      linkDocumentToCase(db, documentId, caseId);
      const versionResult = assignDocumentVersion(db, {
        caseId,
        sourceType: doc.source_type,
        documentId,
        receivedAt: doc.received_at,
      });
      res.json({
        message: 'Document linked successfully',
        documentId,
        caseId,
        versionResult,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to link document' });
    }
  });

  // List all cases
  app.get('/api/cases', (req: Request, res: Response): void => {
    const cases = caseRepo.findAll(db);
    const enriched = cases.map((c) => {
      const docs = documentRepo.findForCase(db, c.id);
      const latestResult = resultRepo.findByCaseId(db, c.id);
      return {
        ...c,
        documentCount: docs.length,
        documents: docs.map((d) => ({
          id: d.id,
          sourceType: d.source_type,
          status: d.status,
          receivedAt: d.received_at,
          storagePath: d.storage_path,
        })),
        latestResult: latestResult
          ? {
            status: latestResult.status,
            createdAt: latestResult.created_at,
          }
          : null,
      };
    });
    res.json({ cases: enriched });
  });

  // Get Case Details (enriched with extracted stage A, line items, and issues)
  app.get('/api/cases/:id', (req: Request, res: Response): void => {
    const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const caseRow = caseRepo.findById(db, caseId);
    if (!caseRow) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }

    const docRows = documentRepo.findForCase(db, caseId);
    const enrichedDocs = docRows.map((d) => {
      const fieldRow = extractedFieldsRepo.findByDocId(db, d.id, 'STAGE_A');
      const textRow = extractedTextRepo.findByDocId(db, d.id);
      const issues = extractionIssueRepo.findByDocumentId(db, d.id);
      const lineItems = lineItemRepo.findByDocId(db, d.id);
      const headerAdjustments = headerAdjustmentRepo.findByDocumentId(db, d.id);
      return {
        ...d,
        stageA: fieldRow ? JSON.parse(fieldRow.payload_json) : null,
        rawText: textRow?.raw_text || null,
        cleanedText: textRow?.cleaned_text || null,
        pageBreakOffsets: textRow?.page_break_offsets ? JSON.parse(textRow.page_break_offsets) : [0],
        extractionIssues: issues,
        lineItems,
        headerAdjustments,
      };
    });

    const latestResult = resultRepo.findByCaseId(db, caseId);
    const activeDecisions = reviewRepo.findActiveForCase(db, caseId);
    const allDecisions = reviewRepo.findAllForCase(db, caseId);

    res.json({
      case: caseRow,
      documents: enrichedDocs,
      latestResult: latestResult
        ? {
          ...latestResult,
          issues: JSON.parse(latestResult.issues_json),
          summary: JSON.parse(latestResult.summary_json),
        }
        : null,
      activeDecisions,
      allDecisions,
      decisions: allDecisions,
    });
  });

  // Run Reconcile for Case
  app.post('/api/cases/:id/reconcile', (req: Request, res: Response): void => {
    const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const caseRow = caseRepo.findById(db, caseId);
    if (!caseRow) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }

    const docRows = documentRepo.findCurrentForCase(db, caseId).filter((d: any) => d.status === 'VALID');
    const stageADocs: StageADocument[] = [];

    for (const d of docRows) {
      const fieldRow = extractedFieldsRepo.findByDocId(db, d.id, 'STAGE_A');
      if (fieldRow) {
        stageADocs.push(JSON.parse(fieldRow.payload_json));
      }
    }

    const startedAt = new Date().toISOString();
    const runId = crypto.randomUUID();

    const expectedSources = JSON.parse(caseRow.expected_sources || '["EMAIL","PDF","JSON"]');

    const result = reconcileCase({
      db,
      caseId,
      customerId: caseRow.customer_id,
      poNumber: caseRow.po_number,
      documents: stageADocs,
      expectedSources,
    });

    const completedAt = new Date().toISOString();

    // Insert run and result
    runRepo.insert(db, {
      id: runId,
      caseId,
      status: 'COMPLETED',
      documentVersionIds: stageADocs.map((d) => d.source.documentId),
      initiatedBy: req.body.initiatedBy || 'API',
      startedAt,
      completedAt,
    });

    resultRepo.insert(db, {
      id: crypto.randomUUID(),
      runId,
      caseId,
      status: result.status,
      issues: result.issues,
      summary: result.summary,
    });

    // Update case status
    caseRepo.updateStatus(db, caseId, result.status);

    // Audit log for reconciliation run
    auditRepo.insert(db, {
      id: crypto.randomUUID(),
      entityType: 'CASE',
      entityId: caseId,
      action: 'RECONCILIATION_RUN',
      details: {
        runId,
        status: result.status,
        mismatchesCount: result.issues.length,
      },
      performedBy: req.body.initiatedBy || 'API',
      createdAt: completedAt,
    });

    res.json({
      runId,
      status: result.status,
      isWaitingForJson: result.isWaitingForJson,
      wasReopened: result.wasReopened,
      issues: result.issues,
      summary: result.summary,
    });
  });

  // AI Discrepancy Explainer endpoint
  app.post('/api/cases/:id/ai-explain', async (req: Request, res: Response): Promise<void> => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const caseRow = caseRepo.findById(db, caseId);
      if (!caseRow) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }

      const latestResult = resultRepo.findByCaseId(db, caseId);
      if (!latestResult) {
        res.status(404).json({ error: 'No reconciliation results found for case' });
        return;
      }

      const issues = JSON.parse(latestResult.issues_json || '[]');
      const targetFingerprint = req.body?.issueFingerprint;

      const targetIssues = targetFingerprint
        ? issues.filter((i: any) => i.fingerprint === targetFingerprint)
        : issues.slice(0, 5);

      if (targetIssues.length === 0) {
        res.json({ explanations: [] });
        return;
      }

      const docs = documentRepo.findCurrentForCase(db, caseId);
      const snippets: Array<{ sourceType: string; text: string }> = [];
      for (const d of docs) {
        const textRow = extractedTextRepo.findByDocId(db, d.id);
        if (textRow && textRow.raw_text) {
          snippets.push({
            sourceType: d.source_type,
            text: textRow.raw_text.slice(0, 1000),
          });
        }
      }

      const explanations = await Promise.all(
        targetIssues.map((issue: any) =>
          explainDiscrepancy({
            poNumber: caseRow.po_number,
            customerId: caseRow.customer_id,
            issue,
            documentSnippets: snippets,
          })
        )
      );

      res.json({ explanations });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed generating AI explanation' });
    }
  });

  // Submit Review Decision
  app.post('/api/cases/:id/review', (req: Request, res: Response): void => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const {
        issueFingerprint,
        field,
        lineReference,
        previousValue,
        selectedValue,
        reason,
        reviewer,
        documentVersionIds,
        supersedesId,
      } = req.body;

      if (!issueFingerprint || !field || !selectedValue || !reason || !reviewer) {
        res.status(400).json({ error: 'Missing required review fields' });
        return;
      }

      const decisionId = crypto.randomUUID();
      const decisionResult = reviewRepo.insertDecision(db, {
        id: decisionId,
        caseId,
        issueFingerprint,
        field,
        lineReference,
        previousValue,
        selectedValue,
        reason,
        reviewer,
        documentVersionIds: documentVersionIds || [],
        supersedesId,
      });

      // Audit log for review decision
      auditRepo.insert(db, {
        id: crypto.randomUUID(),
        entityType: 'CASE',
        entityId: caseId,
        action: 'REVIEW_DECISION',
        details: {
          decisionId,
          issueFingerprint,
          field,
          selectedValue,
          previousValue: previousValue || null,
          reason,
          reviewer,
          supersedesId: decisionResult.supersededId || supersedesId || null,
        },
        performedBy: reviewer,
      });

      res.status(201).json({
        decisionId,
        message: 'Review decision recorded',
      });
    } catch (err: any) {
      console.error('ERROR IN /api/cases/:id/review:', err);
      res.status(500).json({ error: err.message || 'Internal review error' });
    }
  });

  // Get Chronological Audit History for Case and Linked Documents (Phase 3)
  app.get('/api/cases/:id/audit', (req: Request, res: Response): void => {
    const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const caseRow = caseRepo.findById(db, caseId);
    if (!caseRow) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }

    const docRows = documentRepo.findForCase(db, caseId);
    const docIds = docRows.map((d: any) => d.id);
    const rawLogs = auditRepo.findByCaseAndDocIds(db, caseId, docIds);
    const auditLogs = rawLogs.map((l: any) => {
      let details: any = null;
      try {
        details = JSON.parse(l.details_json);
      } catch {
        details = l.details_json;
      }
      return {
        id: l.id,
        entity_type: l.entity_type,
        entity_id: l.entity_id,
        action: l.action,
        details,
        performed_by: l.performed_by,
        created_at: l.created_at,
      };
    });

    res.json({
      caseId,
      auditLogs,
    });
  });

  // Get Ingestion Job Status
  app.get('/api/ingestions/:id', (req: Request, res: Response): void => {
    const jobId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const job = ingestionQueue.getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'Ingestion job not found' });
      return;
    }
    res.json(job);
  });

  // List Queued Items
  app.get('/api/queues', (req: Request, res: Response): void => {
    try {
      const queueType = req.query.queueType as any;
      const resolved = req.query.resolved !== undefined ? req.query.resolved === 'true' : undefined;
      const queues = getQueuedItems(db, { queueType, resolved });
      res.json({ queues });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to list queues' });
    }
  });

  // Resolve Queue Item
  app.post('/api/queues/:id/resolve', (req: Request, res: Response): void => {
    try {
      const queueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const { action, targetCaseId, targetCustomerId, targetPoNumber, resolvedBy } = req.body;
      if (!action || !['LINK_CASE', 'REASSIGN', 'DISMISS'].includes(action)) {
        res.status(400).json({ error: 'action must be LINK_CASE, REASSIGN, or DISMISS' });
        return;
      }
      const result = resolveQueueItem(db, {
        queueId,
        action,
        targetCaseId,
        targetCustomerId,
        targetPoNumber,
        resolvedBy,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to resolve queue item' });
    }
  });

  // Check Case Deadlines
  app.post('/api/cases/check-deadlines', (req: Request, res: Response): void => {
    try {
      const summary = evaluateCaseDeadlines(db, req.body?.now);
      res.json({ summary });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Deadline check failed' });
    }
  });

  return app;
}
