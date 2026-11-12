import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { createDatabase } from '../src/db/database.js';
import { seedCustomerConfig } from '../src/config/customerConfig.js';
import { createExpressApp } from '../src/api/app.js';
import { Database as DatabaseType } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

describe('Real-Time Inbound Email Webhook (Email + Attached PDF)', () => {
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

  it('receives an inbound email with attached PDF, extracts both, links them to one case, and runs real-time reconciliation', async () => {
    const samplePdfPath = path.resolve(process.cwd(), 'storage', 'samples', 'order.pdf');
    const pdfBuffer = fs.readFileSync(samplePdfPath);

    // 1. Pre-ingest the ERP JSON order for PO-9001
    await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'JSON',
        jsonData: {
          poNumber: 'PO-9001',
          customerId: 'CUST-001',
          currency: 'USD',
          lineItems: [
            {
              lineReference: '1',
              productCode: 'SKU-001',
              description: 'Industrial Widget',
              quantity: 10,
              unitPrice: 50,
              lineTotal: 500,
            },
          ],
          amounts: { grandTotal: 500 },
        },
      }),
    });

    // 2. Simulate incoming real-time email with attached PDF (e.g. from SendGrid / Postmark / Mailgun webhook)
    const boundary = '----WebKitFormBoundaryInboundTest';
    const emailText =
      'From: orders@acme.com\n' +
      'Subject: Order PO-9001 Confirmation\n\n' +
      'Hi Team, please find PO-9001 attached.\n' +
      'PO Number: PO-9001\n' +
      'Customer ID: CUST-001\n' +
      'Item: SKU-001\n' +
      'Description: Industrial Widget\n' +
      'Quantity: 10\n' +
      'Unit Price: $50.00\n' +
      'Total: $500.00\n' +
      'Grand Total: $500.00\n';

    const part1 =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="from"\r\n\r\n` +
      `orders@acme.com\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="subject"\r\n\r\n` +
      `Order PO-9001 Confirmation\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="text"\r\n\r\n` +
      `${emailText}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="attachment1"; filename="PO-9001.pdf"\r\n` +
      `Content-Type: application/pdf\r\n\r\n`;

    const part2 = `\r\n--${boundary}--\r\n`;
    const multipartBody = Buffer.concat([Buffer.from(part1, 'utf8'), pdfBuffer, Buffer.from(part2, 'utf8')]);

    const res = await fetch(`${baseUrl}/api/webhooks/inbound-email`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    const resText = await res.text();
    if (res.status !== 200) {
      console.error('Webhook error response:', res.status, resText);
    }
    expect(res.status).toBe(200);
    const data = JSON.parse(resText);

    expect(data.success).toBe(true);
    expect(data.poNumber).toBe('PO-9001');
    expect(data.documentsIngested.length).toBe(2);
    expect(data.documentsIngested.map((d: any) => d.sourceType)).toContain('EMAIL');
    expect(data.documentsIngested.map((d: any) => d.sourceType)).toContain('PDF');

    // 3. Verify real-time reconciliation executed immediately
    expect(data.reconciliation).toBeDefined();
    expect(data.reconciliation.status).toBe('MATCHED');
    expect(data.reconciliation.issuesCount).toBe(0);

    // 4. Verify in database that the case exists and has status MATCHED
    const caseInDb = db.prepare('SELECT * FROM processing_cases WHERE po_number = ?').get('PO-9001') as any;
    expect(caseInDb).toBeDefined();
    expect(caseInDb.status).toBe('MATCHED');

    // 5. Verify all 3 documents (JSON, EMAIL, PDF) are linked to this case
    const docs = db.prepare('SELECT source_type FROM documents WHERE case_id = ?').all(caseInDb.id) as any[];
    expect(docs.map((d) => d.source_type)).toContain('JSON');
    expect(docs.map((d) => d.source_type)).toContain('EMAIL');
    expect(docs.map((d) => d.source_type)).toContain('PDF');
  });

  it('handles Postmark JSON format with base64 PDF attachment natively', async () => {
    const samplePdfPath = path.resolve(process.cwd(), 'storage', 'samples', 'order.pdf');
    const pdfBase64 = fs.readFileSync(samplePdfPath).toString('base64');

    const res = await fetch(`${baseUrl}/api/webhooks/inbound-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        From: 'buyer@acme.com',
        Subject: 'Order PO-POSTMARK Confirmation',
        TextBody: 'PO Number: PO-POSTMARK\nCustomer ID: CUST-001\nItem: SKU-001\nQty: 10\nPrice: $50.00\nTotal: $500.00\nGrand Total: $500.00',
        Attachments: [
          {
            Name: 'PO-POSTMARK.pdf',
            ContentType: 'application/pdf',
            Content: pdfBase64,
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.documentsIngested.length).toBe(2);
    expect(data.documentsIngested.map((d: any) => d.sourceType)).toContain('EMAIL');
    expect(data.documentsIngested.map((d: any) => d.sourceType)).toContain('PDF');
  });
});
