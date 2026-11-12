import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createDatabase } from '../src/db/database.js';
import { createExpressApp } from '../src/api/app.js';
import { Database as DatabaseType } from 'better-sqlite3';
import { IngestionQueue } from '../src/core/async/ingestionQueue.js';
import { senderMappingRepo, documentRepo } from '../src/db/repositories/index.js';

describe('Async Ingestion & Lifecycle API (asyncIngestion)', () => {
  let db: DatabaseType;
  let server: http.Server;
  let baseUrl: string;
  let queue: IngestionQueue;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    queue = new IngestionQueue(db);
    const app = createExpressApp(db, queue);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // Seed master customer config
    db.prepare(`
      INSERT INTO customer_config (customer_id, default_currency, default_uom, separators_insignificant, config_version, created_at, updated_at)
      VALUES 
        ('CUST-ACME', 'USD', 'EA', 1, '1.0', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z'),
        ('CUST-BETA', 'USD', 'EA', 1, '1.0', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    // Seed sender mapping
    senderMappingRepo.insert(db, {
      id: 'sm-acme',
      senderPattern: '@acme.com',
      customerId: 'CUST-ACME',
      isDomain: true,
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('enqueues document asynchronously and transitions QUEUED -> PROCESSING -> COMPLETED', async () => {
    const job = await queue.enqueue({
      sourceType: 'JSON',
      jsonData: {
        order: { customerId: 'CUST-ACME', poNumber: 'PO-ASYNC-1' },
        lineItems: [{ lineReference: '1', productCode: 'ITEM-1', quantity: '5', unitPrice: '10.00', lineTotal: '50.00' }],
      },
    });

    expect(job.status).toBe('QUEUED');
    expect(job.documentId).toBeDefined();

    // Verify document arrival event is stored immediately
    const doc = documentRepo.findById(db, job.documentId);
    expect(doc).toBeDefined();

    // Wait for background job to process
    const completedJob = await queue.waitForJob(job.id, 3000);
    expect(completedJob.status).toBe('COMPLETED');
    expect(completedJob.caseId).toBeDefined();

    // Verify extraction occurred
    const lines = db.prepare('SELECT * FROM line_items WHERE source_document_id = ?').all(job.documentId);
    expect(lines.length).toBe(1);
  });

  it('marks job FAILED if payload is corrupted/unparseable', async () => {
    const job = await queue.enqueue({
      sourceType: 'JSON',
      rawText: 'NOT VALID JSON {',
    });

    const failedJob = await queue.waitForJob(job.id, 3000);
    expect(failedJob.status).toBe('FAILED');
    expect(failedJob.errorMessage).toBeDefined();
  });

  it('supports async document ingestion via POST /api/documents?async=true', async () => {
    const res = await fetch(`${baseUrl}/api/documents?async=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'JSON',
        jsonData: {
          order: { customerId: 'CUST-ACME', poNumber: 'PO-API-ASYNC' },
          lineItems: [],
        },
      }),
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as any;
    expect(body.jobId).toBeDefined();
    expect(body.status).toBe('QUEUED');

    // Poll status via GET /api/ingestions/:jobId
    const statusRes = await fetch(`${baseUrl}/api/ingestions/${body.jobId}`);
    expect(statusRes.status).toBe(200);
    const statusBody = (await statusRes.json()) as any;
    expect(['QUEUED', 'PROCESSING', 'COMPLETED']).toContain(statusBody.status);
  });

  it('lists queued items and resolves them via GET /api/queues and POST /api/queues/:id/resolve', async () => {
    // Ingest unlinked document (no PO number)
    const ingestRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'EMAIL',
        rawText: 'Hello, please process this order for CUST-ACME with no PO mentioned.',
        customerId: 'CUST-ACME',
      }),
    });

    expect(ingestRes.status).toBe(201);
    const ingestBody = (await ingestRes.json()) as any;
    expect(ingestBody.routedToQueue).toBe('UNLINKED');

    // Query queues
    const queueListRes = await fetch(`${baseUrl}/api/queues?queueType=UNLINKED`);
    expect(queueListRes.status).toBe(200);
    const queueListData = (await queueListRes.json()) as any;
    expect(queueListData.queues.length).toBeGreaterThanOrEqual(1);

    const queueId = queueListData.queues[0].id;

    // Resolve via REASSIGN
    const resolveRes = await fetch(`${baseUrl}/api/queues/${queueId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'REASSIGN',
        targetCustomerId: 'CUST-ACME',
        targetPoNumber: 'PO-RESOLVED-101',
      }),
    });

    expect(resolveRes.status).toBe(200);
    const resolveData = (await resolveRes.json()) as any;
    expect(resolveData.success).toBe(true);

    // Verify queue is now resolved
    const unresolvedRes = await fetch(`${baseUrl}/api/queues?resolved=false`);
    const unresolvedData = (await unresolvedRes.json()) as any;
    expect(unresolvedData.queues.find((q: any) => q.id === queueId)).toBeUndefined();
  });

  it('triggers deadline check via POST /api/cases/check-deadlines', async () => {
    // Insert open overdue case
    db.prepare(`
      INSERT INTO processing_cases (id, customer_id, po_number, status, expected_sources, deadline, created_at, updated_at)
      VALUES ('case-api-overdue', 'CUST-ACME', 'PO-DEADLINE-API', 'OPEN', '["PDF","JSON"]', '2026-11-11T10:00:00Z', '2026-11-11T09:00:00Z', '2026-11-11T09:00:00Z')
    `).run();

    const res = await fetch(`${baseUrl}/api/cases/check-deadlines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ now: '2026-11-11T12:00:00Z' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.summary).toBeDefined();
    expect(body.summary.incompleteCaseIds).toContain('case-api-overdue');

    const check = db.prepare('SELECT status FROM processing_cases WHERE id = ?').get('case-api-overdue') as any;
    expect(check.status).toBe('INCOMPLETE');
  });

  it('detects duplicate files on ingest and returns DUPLICATE_FILE without duplicate line items', async () => {
    const fileContent = 'Dummy invoice text for duplication test';
    const payload = {
      sourceType: 'EMAIL',
      rawText: fileContent,
      messageId: '<msg-dup-1@acme.com>',
      customerId: 'CUST-ACME',
      poNumber: 'PO-DUP-1',
    };

    const first = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as any;
    expect(firstBody.status).toBe('VALID');

    // Exact repeat
    const second = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as any;
    expect(secondBody.status).toBe('DUPLICATE_FILE');
    expect(secondBody.duplicateOfId).toBe(firstBody.documentId);
  });

  it('detects duplicate file uploads via file buffer hash and returns DUPLICATE_FILE', async () => {
    const samplePdfPath = path.resolve(process.cwd(), 'storage', 'samples', 'order.pdf');
    const fileBuffer = fs.readFileSync(samplePdfPath);
    const base64 = fileBuffer.toString('base64');
    const payload = {
      sourceType: 'PDF',
      pdfBase64: base64,
      customerId: 'CUST-ACME',
      poNumber: 'PO-DUP-FILE-1',
    };

    const first = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as any;

    const second = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as any;
    expect(secondBody.status).toBe('DUPLICATE_FILE');
    expect(secondBody.duplicateOfId).toBe(firstBody.documentId);
  });

  it('detects duplicate messageId repeats in async ingestion mode', async () => {
    const payload = {
      sourceType: 'EMAIL',
      rawText: 'First email content for PO-ASYNC-MSG',
      messageId: '<msg-async-dup-99@acme.com>',
      customerId: 'CUST-ACME',
      poNumber: 'PO-ASYNC-MSG',
    };

    const first = await fetch(`${baseUrl}/api/documents?async=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as any;

    const completedFirst = await queue.waitForJob(firstBody.jobId, 3000);
    expect(completedFirst.status).toBe('COMPLETED');
    expect(completedFirst.isDuplicate).toBe(false);

    // Second upload with same messageId
    const second = await fetch(`${baseUrl}/api/documents?async=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(202);
    const secondBody = (await second.json()) as any;
    expect(secondBody.isDuplicate).toBe(true);
    expect(secondBody.duplicateOfId).toBe(firstBody.documentId);

    const docInDb = documentRepo.findById(db, secondBody.documentId);
    expect(docInDb.status).toBe('DUPLICATE_FILE');
    expect(docInDb.duplicate_of_id).toBe(firstBody.documentId);
    expect(docInDb.message_id).toBe('<msg-async-dup-99@acme.com>');
  });

  it('detects duplicate pdfBase64 uploads in async ingestion mode', async () => {
    const samplePdfPath = path.resolve(process.cwd(), 'storage', 'samples', 'order.pdf');
    const fileBuffer = fs.readFileSync(samplePdfPath);
    const base64 = fileBuffer.toString('base64');
    const payload = {
      sourceType: 'PDF',
      pdfBase64: base64,
      customerId: 'CUST-ACME',
      poNumber: 'PO-ASYNC-PDF-DUP',
    };

    const first = await fetch(`${baseUrl}/api/documents?async=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as any;

    const completedFirst = await queue.waitForJob(firstBody.jobId, 3000);
    expect(completedFirst.status).toBe('COMPLETED');

    const second = await fetch(`${baseUrl}/api/documents?async=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(202);
    const secondBody = (await second.json()) as any;
    expect(secondBody.isDuplicate).toBe(true);
    expect(secondBody.duplicateOfId).toBe(firstBody.documentId);
  });

  it('reconciles only current document versions and excludes older superseded versions', async () => {
    // 1. Ingest PDF v1 with qty 10
    const pdf1Res = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'PDF',
        rawText: 'Purchase Order PO-MULTI-101\nCustomer ID: CUST-ACME\n1 ITEM-1 Widget 10 EA 50 500\nGrand Total: 500',
        customerId: 'CUST-ACME',
        poNumber: 'PO-MULTI-101',
        expectedSources: ['PDF', 'JSON'],
      }),
    });
    const pdf1Data = (await pdf1Res.json()) as any;
    const caseId = pdf1Data.caseId;

    // 2. Ingest JSON v1 with qty 10
    const json1Res = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'JSON',
        jsonData: {
          poNumber: 'PO-MULTI-101',
          customerId: 'CUST-ACME',
          lineItems: [{ lineReference: '1', productCode: 'ITEM-1', quantity: 10, unitPrice: 50, lineTotal: 500 }],
          amounts: { grandTotal: 500 },
        },
        caseId,
      }),
    });
    const json1Data = (await json1Res.json()) as any;

    // 3. Reconcile -> should MATCH
    const rec1Res = await fetch(`${baseUrl}/api/cases/${caseId}/reconcile`, { method: 'POST' });
    const rec1 = (await rec1Res.json()) as any;
    expect(rec1.status).toBe('MATCHED');

    // 4. Ingest PDF v2 with revised qty 15 (received later)
    const pdf2Res = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'PDF',
        rawText: 'Purchase Order PO-MULTI-101\nCustomer ID: CUST-ACME\n1 ITEM-1 Widget 15 EA 50 750\nGrand Total: 750',
        caseId,
      }),
    });
    const pdf2Data = (await pdf2Res.json()) as any;

    // Case should be reopened to OPEN
    const caseAfterPdf2 = db.prepare('SELECT status FROM processing_cases WHERE id = ?').get(caseId) as any;
    expect(caseAfterPdf2.status).toBe('OPEN');

    // 5. Reconcile -> should MISMATCH (PDF v2 has 15, current JSON v1 has 10)
    const rec2Res = await fetch(`${baseUrl}/api/cases/${caseId}/reconcile`, { method: 'POST' });
    const rec2 = (await rec2Res.json()) as any;
    expect(rec2.status).toBe('MISMATCH');

    // 6. Ingest JSON v2 with revised qty 15
    const json2Res = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'JSON',
        jsonData: {
          poNumber: 'PO-MULTI-101',
          customerId: 'CUST-ACME',
          lineItems: [{ lineReference: '1', productCode: 'ITEM-1', quantity: 15, unitPrice: 50, lineTotal: 750 }],
          amounts: { grandTotal: 750 },
        },
        caseId,
      }),
    });
    const json2Data = (await json2Res.json()) as any;

    // 7. Reconcile -> should MATCH (PDF v2 has 15, JSON v2 has 15; PDF v1 and JSON v1 are ignored!)
    const rec3Res = await fetch(`${baseUrl}/api/cases/${caseId}/reconcile`, { method: 'POST' });
    const rec3 = (await rec3Res.json()) as any;
    expect(rec3.status).toBe('MATCHED');
    expect(rec3.issues).toHaveLength(0);

    // Verify reconciliation_runs recorded exact current document IDs (pdf2 and json2, NOT pdf1 or json1)
    const latestRun = db.prepare('SELECT document_version_ids FROM reconciliation_runs WHERE case_id = ? ORDER BY started_at DESC LIMIT 1').get(caseId) as any;
    const recordedIds = JSON.parse(latestRun.document_version_ids);
    expect(recordedIds).toHaveLength(2);
    expect(recordedIds).toContain(pdf2Data.documentId);
    expect(recordedIds).toContain(json2Data.documentId);
    expect(recordedIds).not.toContain(pdf1Data.documentId);
    expect(recordedIds).not.toContain(json1Data.documentId);
  });

  it('properly assigns version when document is manually linked via POST /api/documents/:id/link', async () => {
    // Ingest document without PO (unlinked queue)
    const unlinkedRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'PDF',
        rawText: 'Item: WIDGET-1, Qty: 20',
        customerId: 'CUST-ACME',
      }),
    });
    const unlinkedData = (await unlinkedRes.json()) as any;

    // Create target case
    db.prepare(`
      INSERT INTO processing_cases (id, customer_id, po_number, status, expected_sources, created_at, updated_at)
      VALUES ('case-manual-link', 'CUST-ACME', 'PO-LINK-1', 'OPEN', '["PDF"]', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    const linkRes = await fetch(`${baseUrl}/api/documents/${unlinkedData.documentId}/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId: 'case-manual-link' }),
    });
    expect(linkRes.status).toBe(200);
    const linkBody = (await linkRes.json()) as any;
    expect(linkBody.versionResult).toBeDefined();
    expect(linkBody.versionResult.versionNumber).toBe(1);
    expect(linkBody.versionResult.isCurrentVersion).toBe(true);

    const docInDb = documentRepo.findById(db, unlinkedData.documentId);
    expect(docInDb.case_id).toBe('case-manual-link');
    expect(docInDb.version_number).toBe(1);
    expect(docInDb.is_current_version).toBe(1);
  });
});
