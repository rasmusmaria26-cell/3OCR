import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { createDatabase } from '../src/db/database.js';
import { seedCustomerConfig } from '../src/config/customerConfig.js';
import { createExpressApp } from '../src/api/app.js';
import { Database as DatabaseType } from 'better-sqlite3';

describe('Express API Integration (Ingest, Reconcile, Review)', () => {
  let db: DatabaseType;
  let server: http.Server;
  let baseUrl: string;

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

  it('ingests email, PDF, and JSON documents with storage_path and links them to one case', async () => {
    // 1. Ingest Email
    const emailRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'EMAIL',
        rawText: 'PO: PO-1001\nCustomer ID: CUST-101\nItem: LAP-001\nQty: 10\nPrice: ₹50,000\nTotal: ₹5,00,000',
        storagePath: '/storage/emails/email-1.eml',
      }),
    });

    expect(emailRes.status).toBe(201);
    const emailData = await emailRes.json() as any;
    expect(emailData.documentId).toBeDefined();
    const caseId = emailData.caseId;
    expect(caseId).toBeDefined();

    // 2. Ingest PDF
    const pdfRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'PDF',
        rawText: 'Purchase Order PO-1001\nCustomer ID: CUST-101\n1 LAP-001 Laptop 10 EA 50000 500000\nGrand Total: 500000',
        storagePath: '/storage/pdfs/po-1001.pdf',
        caseId,
      }),
    });

    expect(pdfRes.status).toBe(201);
    const pdfData = await pdfRes.json() as any;
    expect(pdfData.caseId).toBe(caseId);

    // 3. Ingest JSON Order
    const jsonRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'JSON',
        jsonData: {
          poNumber: 'PO-1001',
          customerId: 'CUST-101',
          lineItems: [
            {
              productCode: 'LAP-001',
              description: 'Laptop',
              quantity: 10,
              unitPrice: 50000,
              lineTotal: 500000,
            },
          ],
          amounts: {
            grandTotal: 500000,
          },
        },
        storagePath: '/storage/json/po-1001.json',
        caseId,
      }),
    });

    expect(jsonRes.status).toBe(201);

    // 4. Verify documents in DB have storage_path
    const docs = db.prepare('SELECT storage_path FROM documents WHERE case_id = ?').all(caseId) as any[];
    expect(docs).toHaveLength(3);
    expect(docs.map((d) => d.storage_path)).toContain('/storage/pdfs/po-1001.pdf');

    // 5. Trigger reconciliation
    const reconcileRes = await fetch(`${baseUrl}/api/cases/${caseId}/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initiatedBy: 'TEST' }),
    });

    expect(reconcileRes.status).toBe(200);
    const reconcileData = await reconcileRes.json() as any;
    expect(reconcileData.status).toBe('MATCHED');
    expect(reconcileData.issues).toHaveLength(0);
  });

  it('handles review workflow for quantity mismatch via issue fingerprint', async () => {
    // Ingest PDF with qty 10
    const pdfRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'PDF',
        rawText: 'Purchase Order PO-2002\nCustomer ID: CUST-101\n1 LAP-001 Laptop 10 EA 50000 500000\nGrand Total: 500000',
        storagePath: '/storage/pdfs/po-2002.pdf',
        expectedSources: ['PDF', 'JSON'],
      }),
    });

    const pdfData = await pdfRes.json() as any;
    const caseId = pdfData.caseId;

    // Ingest JSON with qty 12
    await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'JSON',
        jsonData: {
          poNumber: 'PO-2002',
          customerId: 'CUST-101',
          lineItems: [
            {
              productCode: 'LAP-001',
              description: 'Laptop',
              quantity: 12,
              unitPrice: 50000,
              lineTotal: 600000,
            },
          ],
          amounts: {
            grandTotal: 600000,
          },
        },
        caseId,
      }),
    });

    // Reconcile -> returns MISMATCH
    const rec1Res = await fetch(`${baseUrl}/api/cases/${caseId}/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const rec1 = await rec1Res.json() as any;
    expect(rec1.status).toBe('MISMATCH');
    expect(rec1.issues.length).toBeGreaterThan(0);

    // Review all issues by fingerprint
    for (const issue of rec1.issues) {
      const revRes = await fetch(`${baseUrl}/api/cases/${caseId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueFingerprint: issue.fingerprint,
          field: issue.field,
          selectedValue: '10',
          reason: 'Verified with procurement',
          reviewer: 'bob',
        }),
      });
      expect(revRes.status).toBe(201);
    }

    // Reconcile again -> now RESOLVED
    const rec2Res = await fetch(`${baseUrl}/api/cases/${caseId}/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const rec2 = await rec2Res.json() as any;
    expect(rec2.status).toBe('RESOLVED');
  });

  it('stores cleanedText & quote metadata for forwarded emails, and populates line_items table', async () => {
    const rawEmailWithForward = `
Please process PO-3003.
Customer ID: CUST-101

Item: LAP-001
Qty: 5
Price: $500
Total: $2500

---------- Forwarded message ---------
From: old@client.com
Subject: Pricing discussion
Here is the previous thread with old terms and large chunk of text that exceeds two hundred characters to trigger the largeChunkRemoved flag properly.
1. Some old info
2. Another line of notes
3. More discussion notes
`;

    const emailRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'EMAIL',
        rawText: rawEmailWithForward,
        storagePath: '/storage/emails/email-3003.eml',
      }),
    });

    expect(emailRes.status).toBe(201);
    const emailData = await emailRes.json() as any;
    const docId = emailData.documentId;

    // Verify extracted_text table has both raw_text and cleaned_text plus metadata
    const textRow = db.prepare('SELECT raw_text, cleaned_text, quote_strip_metadata FROM extracted_text WHERE document_id = ?').get(docId) as any;
    expect(textRow).toBeDefined();
    expect(textRow.raw_text).toContain('---------- Forwarded message ---------');
    expect(textRow.cleaned_text).not.toContain('---------- Forwarded message ---------');
    expect(textRow.quote_strip_metadata).toBeDefined();
    const meta = JSON.parse(textRow.quote_strip_metadata);
    expect(meta.largeChunkRemoved).toBe(true);

    // Verify line_items table is populated
    const lineRows = db.prepare('SELECT * FROM line_items WHERE source_document_id = ?').all(docId) as any[];
    expect(lineRows).toHaveLength(1);
    expect(lineRows[0].product_code).toBe('LAP-001');
    expect(lineRows[0].quantity).toBe('5');
    expect(lineRows[0].unit_price).toBe('500');
  });

  it('persists extraction issues and forces reconciliation status to REVIEW_REQUIRED', async () => {
    // Ingest PDF missing required Unit Price
    const pdfRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'PDF',
        rawText: 'Purchase Order PO-4004\nCustomer ID: CUST-101\n1 LAP-001 Laptop 10 EA\nGrand Total: 500000',
        storagePath: '/storage/pdfs/po-4004.pdf',
        expectedSources: ['PDF'],
      }),
    });

    expect(pdfRes.status).toBe(201);
    const pdfData = await pdfRes.json() as any;
    const caseId = pdfData.caseId;

    // Reconcile -> missing unit price in PDF is blocking source policy issue -> REVIEW_REQUIRED
    const recRes = await fetch(`${baseUrl}/api/cases/${caseId}/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const recData = await recRes.json() as any;
    expect(recData.status).toBe('REVIEW_REQUIRED');
    expect(recData.summary.blockingIssuesCount).toBeGreaterThan(0);
  });

  it('supports manual document linking via POST /api/documents/:id/link and records audit log', async () => {
    // 1. Ingest an unlinked document (no Customer ID and no PO in text)
    const docRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'EMAIL',
        rawText: 'Item: LAP-001\nQty: 5\nPrice: $500\nTotal: $2500',
      }),
    });

    expect(docRes.status).toBe(201);
    const docData = await docRes.json() as any;
    expect(docData.documentId).toBeDefined();
    expect(docData.caseId).toBeNull();

    // 2. Create a case
    db.prepare(`
      INSERT INTO processing_cases (id, customer_id, po_number, status, expected_sources, created_at, updated_at)
      VALUES ('case-manual-link', 'CUST-101', 'PO-MANUAL', 'OPEN', '["EMAIL"]', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    // 3. Link document via API
    const linkRes = await fetch(`${baseUrl}/api/documents/${docData.documentId}/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId: 'case-manual-link' }),
    });

    expect(linkRes.status).toBe(200);
    const linkData = await linkRes.json() as any;
    expect(linkData.caseId).toBe('case-manual-link');

    // 4. Verify DB and audit log
    const docInDb = db.prepare('SELECT case_id FROM documents WHERE id = ?').get(docData.documentId) as any;
    expect(docInDb.case_id).toBe('case-manual-link');

    const auditEntry = db.prepare('SELECT * FROM audit_logs WHERE entity_id = ? AND action = ?')
      .get(docData.documentId, 'LINK_CASE') as any;
    expect(auditEntry).toBeDefined();
    const details = JSON.parse(auditEntry.details_json);
    expect(details.new_case_id).toBe('case-manual-link');
  });
});
