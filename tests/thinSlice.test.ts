import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Database as DatabaseType } from 'better-sqlite3';
import { createDatabase } from '../src/db/database.js';
import { seedCustomerConfig } from '../src/config/customerConfig.js';
import { createExpressApp } from '../src/api/app.js';
import { extractPdfBufferToStageA } from '../src/extractors/pdfExtractor.js';

describe('Phase 1 Thin Real Slice End-to-End Demo', () => {
  let db: DatabaseType;
  let server: http.Server;
  let baseUrl: string;

  const samplePdfPath = path.resolve(process.cwd(), 'storage', 'samples', 'order.pdf');
  const sampleEmlPath = path.resolve(process.cwd(), 'storage', 'samples', 'order.eml');
  const sampleJsonPath = path.resolve(process.cwd(), 'storage', 'samples', 'order.json');

  beforeEach(async () => {
    db = createDatabase(':memory:');
    seedCustomerConfig(db);
    const app = createExpressApp(db);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('extracts real PDF buffer directly using pdf-parse with verified evidence and page offsets', async () => {
    expect(fs.existsSync(samplePdfPath)).toBe(true);
    const pdfBuffer = fs.readFileSync(samplePdfPath);

    const extraction = await extractPdfBufferToStageA({
      buffer: pdfBuffer,
      documentId: 'doc-pdf-direct',
      receivedAt: new Date().toISOString(),
      storagePath: samplePdfPath,
    });

    expect(extraction.stageA.order.poNumber).toBe('PO-9001');
    expect(extraction.stageA.order.customerId).toBe('CUST-001');
    expect(extraction.stageA.order.currency).toBe('USD');
    expect(extraction.stageA.lineItems).toHaveLength(1);
    expect(extraction.stageA.lineItems[0].productCode).toBe('SKU-001');
    expect(extraction.stageA.lineItems[0].quantity).toBe('10');
    expect(extraction.stageA.lineItems[0].unitPrice).toBe('50.00');
    expect(extraction.stageA.lineItems[0].lineTotal).toBe('500.00');
    expect(extraction.stageA.amounts.grandTotal).toBe('500.00');

    // Verify evidence trail
    expect(extraction.stageA.evidence.length).toBeGreaterThan(0);
    const skuEv = extraction.stageA.evidence.find((e) => e.fieldPath === 'lineItems[0].productCode');
    expect(skuEv).toBeDefined();
    expect(skuEv?.rawValue).toBe('SKU-001');
    expect(skuEv?.page).toBe(1);
    expect(skuEv?.charStart).toBeGreaterThanOrEqual(0);
    expect(skuEv?.extractionMethod).toBe('PDF_PARSE');
  });

  it('ingests real sample files (PDF, email with quote history, JSON) via API, reconciles, and asserts full match', async () => {
    expect(fs.existsSync(samplePdfPath)).toBe(true);
    expect(fs.existsSync(sampleEmlPath)).toBe(true);
    expect(fs.existsSync(sampleJsonPath)).toBe(true);

    const pdfBuffer = fs.readFileSync(samplePdfPath);
    const emlText = fs.readFileSync(sampleEmlPath, 'utf8');
    const jsonOrder = JSON.parse(fs.readFileSync(sampleJsonPath, 'utf8'));

    // 1. Ingest PDF buffer using multipart/form-data upload
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const pdfFilename = 'order.pdf';

    const pdfHead = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${pdfFilename}"\r\n` +
      `Content-Type: application/pdf\r\n\r\n`
    );
    const pdfTail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const multipartBody = Buffer.concat([pdfHead, pdfBuffer, pdfTail]);

    const pdfRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    expect(pdfRes.status).toBe(201);
    const pdfData = (await pdfRes.json()) as any;
    expect(pdfData.documentId).toBeDefined();
    const caseId = pdfData.caseId;
    expect(caseId).toBeDefined();
    expect(pdfData.stageA.order.poNumber).toBe('PO-9001');

    // 2. Ingest Email (contains quote history that must be stripped)
    const emailRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'EMAIL',
        rawText: emlText,
        caseId,
        storagePath: sampleEmlPath,
      }),
    });

    expect(emailRes.status).toBe(201);
    const emailData = (await emailRes.json()) as any;
    expect(emailData.caseId).toBe(caseId);
    expect(emailData.stageA.order.poNumber).toBe('PO-9001');

    // Verify in DB that quote strip metadata was saved
    const emailTextRecord = db.prepare('SELECT * FROM extracted_text WHERE document_id = ?').get(emailData.documentId) as any;
    expect(emailTextRecord).toBeDefined();
    expect(emailTextRecord.quote_strip_metadata).toBeDefined();
    const meta = JSON.parse(emailTextRecord.quote_strip_metadata);
    expect(meta.charsRemoved).toBeGreaterThan(0);

    // 3. Ingest JSON order
    const jsonRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'JSON',
        jsonData: jsonOrder,
        caseId,
        storagePath: sampleJsonPath,
      }),
    });

    expect(jsonRes.status).toBe(201);
    const jsonData = (await jsonRes.json()) as any;
    expect(jsonData.caseId).toBe(caseId);

    // 4. Run reconciliation on the case
    const reconcileRes = await fetch(`${baseUrl}/api/cases/${caseId}/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initiatedBy: 'TEST_THIN_SLICE' }),
    });

    expect(reconcileRes.status).toBe(200);
    const result = (await reconcileRes.json()) as any;

    expect(result.status).toBe('MATCHED');
    expect(result.issues).toHaveLength(0); // Zero mismatches!
    expect(result.summary.documentsCompared).toHaveLength(3);
    expect(result.summary.linesChecked).toBe(2);
    expect(result.summary.mismatchesCount).toBe(0);
    expect(result.summary.blockingIssuesCount).toBe(0);
    expect(result.summary.arithmeticStatus).toBe('VALID');

    // 5. Query Dashboard API endpoints
    // 5a. GET / (Dashboard UI HTML)
    const uiRes = await fetch(`${baseUrl}/`);
    expect(uiRes.status).toBe(200);
    const uiHtml = await uiRes.text();
    expect(uiHtml).toContain('Reconciliation Engine');
    expect(uiHtml).toContain('Processing Cases');

    // 5b. GET /dashboard
    const dashRes = await fetch(`${baseUrl}/dashboard`);
    expect(dashRes.status).toBe(200);
    expect(await dashRes.text()).toContain('Reconciliation Engine');

    // 5c. GET /api/cases (List all cases)
    const listRes = await fetch(`${baseUrl}/api/cases`);
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as any;
    expect(listData.cases).toHaveLength(1);
    expect(listData.cases[0].id).toBe(caseId);
    expect(listData.cases[0].po_number).toBe('PO-9001');
    expect(listData.cases[0].documentCount).toBe(3);
    expect(listData.cases[0].status).toBe('MATCHED');

    // 5d. GET /api/cases/:id (Enriched details with evidence)
    const detailRes = await fetch(`${baseUrl}/api/cases/${caseId}`);
    expect(detailRes.status).toBe(200);
    const detailData = (await detailRes.json()) as any;
    expect(detailData.case.id).toBe(caseId);
    expect(detailData.documents).toHaveLength(3);

    const pdfDoc = detailData.documents.find((d: any) => d.source_type === 'PDF');
    expect(pdfDoc).toBeDefined();
    expect(pdfDoc.stageA).toBeDefined();
    expect(pdfDoc.stageA.evidence.length).toBeGreaterThan(0);
    expect(pdfDoc.lineItems).toHaveLength(1);
  });

  it('correctly calculates pageBreakOffsets for multi-page PDF buffer and assigns page 2 to line items and currency', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const existingPdfBytes = fs.readFileSync(samplePdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    // Keep page 1 for PO & Customer info, add page 2 for line item
    const p2 = pdfDoc.addPage([600, 800]);

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    p2.drawText('2 SKU-002 Deluxe Widget 5 EA $100.00 $500.00\nTotal: $500.00', {
      x: 50,
      y: 700,
      size: 14,
      font,
    });

    const multiPageBuffer = Buffer.from(await pdfDoc.save());

    const extraction = await extractPdfBufferToStageA({
      buffer: multiPageBuffer,
      documentId: 'doc-multipage-pdf',
      receivedAt: new Date().toISOString(),
    });

    expect(extraction.pageBreakOffsets.length).toBe(2);
    expect(extraction.pageBreakOffsets[0]).toBe(0);
    expect(extraction.pageBreakOffsets[1]).toBeGreaterThan(0);

    const skuEv = extraction.stageA.evidence.find((e) => e.fieldPath === 'lineItems[1].productCode');
    expect(skuEv).toBeDefined();
    expect(skuEv?.page).toBe(2); // Accurately identified on Page 2!
  });

  it('handles invalid or corrupted PDF buffer gracefully via API upload without crashing server', async () => {
    const corruptBuffer = Buffer.from('NOT_A_VALID_PDF_STREAM_CORRUPTED_BYTES');

    const boundary = '----WebKitFormBoundaryCorrupt' + Math.random().toString(36).substring(2);
    const pdfHead = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="corrupt.pdf"\r\n` +
      `Content-Type: application/pdf\r\n\r\n`
    );
    const pdfTail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const multipartBody = Buffer.concat([pdfHead, corruptBuffer, pdfTail]);

    const res = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    expect(res.status).toBe(500);
    const data = (await res.json()) as any;
    expect(data.error).toBeDefined();

    // Verify server is still alive and responsive
    const healthCheck = await fetch(`${baseUrl}/api/cases`);
    expect(healthCheck.status).toBe(200);
  });

  it('records review decision and re-evaluates reconciliation status from REVIEW_REQUIRED to RESOLVED', async () => {
    // 1. Ingest PDF with quantity 10 and expectedSources ['PDF', 'JSON']
    const pdfRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'PDF',
        rawText: 'Purchase Order PO-9003\nCustomer ID: CUST-001\n1 SKU-001 Industrial Widget 10 EA $50.00 $500.00\nGrand Total: $500.00',
        expectedSources: ['PDF', 'JSON'],
      }),
    });
    const pdfData = (await pdfRes.json()) as any;
    const caseId = pdfData.caseId;

    // 2. Ingest JSON order with mismatched quantity 15
    await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'JSON',
        caseId,
        jsonData: {
          poNumber: 'PO-9003',
          customerId: 'CUST-001',
          lineItems: [
            {
              productCode: 'SKU-001',
              quantity: 15, // Mismatch with PDF 10!
              unitPrice: 50.00,
              lineTotal: 750.00,
            },
          ],
          amounts: { grandTotal: 750.00 },
        },
      }),
    });

    // 3. Reconcile - should fail with MISMATCH
    const reconcile1 = await fetch(`${baseUrl}/api/cases/${caseId}/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initiatedBy: 'TEST' }),
    });
    const res1 = (await reconcile1.json()) as any;
    expect(res1.status).toBe('MISMATCH');
    expect(res1.issues.length).toBeGreaterThan(0);

    const targetIssue = res1.issues.find((i: any) => i.field.includes('quantity'));
    expect(targetIssue).toBeDefined();
    expect(targetIssue.fingerprint).toBeDefined();

    // 4. Submit Review Decision for the quantity mismatch
    const reviewRes = await fetch(`${baseUrl}/api/cases/${caseId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issueFingerprint: targetIssue.fingerprint,
        field: targetIssue.field,
        previousValue: '15',
        selectedValue: '10',
        reason: 'Customer confirmed 10 units via phone approval',
        reviewer: 'Agent Smith',
      }),
    });
    expect(reviewRes.status).toBe(201);

    // 5. Also resolve grandTotal issue if any
    const totalIssue = res1.issues.find((i: any) => i.field.includes('grandTotal') || i.field.includes('lineTotal'));
    if (totalIssue) {
      await fetch(`${baseUrl}/api/cases/${caseId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueFingerprint: totalIssue.fingerprint,
          field: totalIssue.field,
          previousValue: '750.00',
          selectedValue: '500.00',
          reason: 'Adjusted total to match 10 units',
          reviewer: 'Agent Smith',
        }),
      });
    }

    // 6. Reconcile again - all blocking issues resolved by review
    const reconcile2 = await fetch(`${baseUrl}/api/cases/${caseId}/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initiatedBy: 'TEST_POST_REVIEW' }),
    });
    const res2 = (await reconcile2.json()) as any;
    expect(res2.status).toBe('RESOLVED');
  });
});
