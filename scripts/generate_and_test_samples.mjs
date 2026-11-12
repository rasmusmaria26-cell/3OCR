import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const BATCH_DIR = path.resolve(process.cwd(), 'storage', 'samples', 'batch');
const CSV_PATH = path.resolve(process.cwd(), 'test_results.csv');

fs.mkdirSync(BATCH_DIR, { recursive: true });

async function createPdf(filePath, { po, customer, customerName, lines, grandTotal }) {
  const basePdf = path.resolve(process.cwd(), 'node_modules', 'pdf-parse', 'test', 'data', '04-valid.pdf');
  const baseBytes = fs.readFileSync(basePdf);
  const pdfDoc = await PDFDocument.load(baseBytes);
  const newPage = pdfDoc.addPage([600, 800]);
  while (pdfDoc.getPageCount() > 1) {
    pdfDoc.removePage(0);
  }
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let y = 720;
  const headerLines = [
    `Purchase Order ${po}`,
    `Customer ID: ${customer}`,
    `Customer Name: ${customerName}`,
  ];

  for (const h of headerLines) {
    newPage.drawText(h, { x: 50, y, size: 13, font });
    y -= 22;
  }
  y -= 10;

  lines.forEach((l, idx) => {
    const lineTotal = (Number(l.qty) * Number(l.price)).toFixed(2);
    const lineStr = `${idx + 1} ${l.sku} ${l.desc} ${l.qty} ${l.uom || 'EA'} ${Number(l.price).toFixed(2)} ${lineTotal}`;
    newPage.drawText(lineStr, { x: 50, y, size: 12, font });
    y -= 20;
  });

  y -= 15;
  newPage.drawText(`Grand Total: ${Number(grandTotal).toFixed(2)}`, { x: 50, y, size: 13, font });

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(filePath, Buffer.from(pdfBytes));
}

function createEmail(filePath, { po, customer, customerName, lines, grandTotal }) {
  const lineDetails = lines
    .map(
      (l) =>
        `Item: ${l.sku}\nDescription: ${l.desc}\nQuantity: ${l.qty}\nUnit Price: $${Number(l.price).toFixed(2)}\nTotal: $${(Number(l.qty) * Number(l.price)).toFixed(2)}`
    )
    .join('\n\n');

  const content = `From: orders@acme.com
To: sales@vendor.com
Date: Wed, 11 Nov 2026 10:00:00 +0000
Subject: Order Confirmation ${po} - ${customerName}

Hi Team,

Please find our purchase order details below:
PO Number: ${po}
Customer ID: ${customer}

${lineDetails}

Grand Total: $${Number(grandTotal).toFixed(2)}

Thank you,
${customerName} Purchasing
`;

  fs.writeFileSync(filePath, content, 'utf8');
}

function createJson(filePath, { po, customer, customerName, lines, grandTotal }) {
  const jsonContent = {
    poNumber: po,
    customerId: customer,
    customerName: customerName,
    currency: 'USD',
    lineItems: lines.map((l, idx) => ({
      lineReference: String(idx + 1),
      productCode: l.sku,
      description: l.desc,
      quantity: Number(l.qty),
      unitOfMeasure: l.uom || 'EA',
      unitPrice: Number(l.price),
      lineTotal: Number(l.lineTotal !== undefined ? l.lineTotal : (Number(l.qty) * Number(l.price)).toFixed(2)),
    })),
    amounts: {
      grandTotal: Number(grandTotal),
    },
  };

  fs.writeFileSync(filePath, JSON.stringify(jsonContent, null, 2), 'utf8');
}

// 10 Comprehensive Scenarios
const testScenarios = [
  {
    id: 'TC-01',
    po: 'PO-9401',
    customer: 'CUST-001',
    customerName: 'Acme Corp',
    name: 'Clean 3-Way Match (Single Item)',
    expectedStatus: 'MATCHED',
    sources: ['PDF', 'EMAIL', 'JSON'],
    pdfLines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: '10', uom: 'EA', price: '50.00' }],
    pdfTotal: 500,
    emailData: {
      lines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: '10', price: '50.00' }],
      grandTotal: 500,
    },
    jsonData: {
      lines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: 10, uom: 'EA', price: 50.0 }],
      grandTotal: 500,
    },
  },
  {
    id: 'TC-02',
    po: 'PO-9402',
    customer: 'CUST-001',
    customerName: 'Acme Corp',
    name: 'Quantity Discrepancy (JSON specifies 15 vs PDF 10)',
    expectedStatus: 'MISMATCH',
    sources: ['PDF', 'EMAIL', 'JSON'],
    pdfLines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: '10', uom: 'EA', price: '50.00' }],
    pdfTotal: 500,
    emailData: {
      lines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: '10', price: '50.00' }],
      grandTotal: 500,
    },
    jsonData: {
      lines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: 15, uom: 'EA', price: 50.0, lineTotal: 750.0 }],
      grandTotal: 750,
    },
  },
  {
    id: 'TC-03',
    po: 'PO-9403',
    customer: 'CUST-001',
    customerName: 'Acme Corp',
    name: 'Unit Price Discrepancy (JSON specifies $65.00 vs PDF $50.00)',
    expectedStatus: 'MISMATCH',
    sources: ['PDF', 'EMAIL', 'JSON'],
    pdfLines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: '10', uom: 'EA', price: '50.00' }],
    pdfTotal: 500,
    emailData: {
      lines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: '10', price: '50.00' }],
      grandTotal: 500,
    },
    jsonData: {
      lines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: 10, uom: 'EA', price: 65.0, lineTotal: 650.0 }],
      grandTotal: 650,
    },
  },
  {
    id: 'TC-04',
    po: 'PO-9404',
    customer: 'CUST-001',
    customerName: 'Acme Corp',
    name: 'JSON Line Total Arithmetic Discrepancy (12 * 50 stated as 500)',
    expectedStatus: 'MISMATCH',
    sources: ['PDF', 'EMAIL', 'JSON'],
    pdfLines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: '10', uom: 'EA', price: '50.00' }],
    pdfTotal: 500,
    emailData: {
      lines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: '10', price: '50.00' }],
      grandTotal: 500,
    },
    jsonData: {
      lines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: 12, uom: 'EA', price: 50.0, lineTotal: 500.0 }],
      grandTotal: 500,
    },
  },
  {
    id: 'TC-05',
    po: 'PO-9405',
    customer: 'CUST-001',
    customerName: 'Acme Corp',
    name: 'Product SKU Discrepancy (JSON specifies SKU-999 vs PDF/Email SKU-001)',
    expectedStatus: 'MISMATCH',
    sources: ['PDF', 'EMAIL', 'JSON'],
    pdfLines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: '5', uom: 'EA', price: '40.00' }],
    pdfTotal: 200,
    emailData: {
      lines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: '5', price: '40.00' }],
      grandTotal: 200,
    },
    jsonData: {
      lines: [{ sku: 'SKU-999', desc: 'Custom Unrecognized Part', qty: 5, uom: 'EA', price: 40.0 }],
      grandTotal: 200,
    },
  },
  {
    id: 'TC-06',
    po: 'PO-9406',
    customer: 'CUST-001',
    customerName: 'Acme Corp',
    name: 'Multi-Item Clean Match (2 Line Items)',
    expectedStatus: 'MATCHED',
    sources: ['PDF', 'EMAIL', 'JSON'],
    pdfLines: [
      { sku: 'SKU-001', desc: 'Industrial Widget', qty: '2', uom: 'EA', price: '50.00' },
      { sku: 'LAP-001', desc: 'Laptop Standard', qty: '1', uom: 'EA', price: '800.00' },
    ],
    pdfTotal: 900,
    emailData: {
      lines: [
        { sku: 'SKU-001', desc: 'Industrial Widget', qty: '2', price: '50.00' },
        { sku: 'LAP-001', desc: 'Laptop Standard', qty: '1', price: '800.00' },
      ],
      grandTotal: 900,
    },
    jsonData: {
      lines: [
        { sku: 'SKU-001', desc: 'Industrial Widget', qty: 2, uom: 'EA', price: 50.0 },
        { sku: 'LAP-001', desc: 'Laptop Standard', qty: 1, uom: 'EA', price: 800.0 },
      ],
      grandTotal: 900,
    },
  },
  {
    id: 'TC-07',
    po: 'PO-9407',
    customer: 'CUST-001',
    customerName: 'Acme Corp',
    name: 'Missing Line Item (JSON omits 2nd item LAP-001)',
    expectedStatus: 'MISMATCH',
    sources: ['PDF', 'EMAIL', 'JSON'],
    pdfLines: [
      { sku: 'SKU-001', desc: 'Industrial Widget', qty: '2', uom: 'EA', price: '50.00' },
      { sku: 'LAP-001', desc: 'Laptop Standard', qty: '1', uom: 'EA', price: '800.00' },
    ],
    pdfTotal: 900,
    emailData: {
      lines: [
        { sku: 'SKU-001', desc: 'Industrial Widget', qty: '2', price: '50.00' },
        { sku: 'LAP-001', desc: 'Laptop Standard', qty: '1', price: '800.00' },
      ],
      grandTotal: 900,
    },
    jsonData: {
      lines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: 2, uom: 'EA', price: 50.0 }],
      grandTotal: 100,
    },
  },
  {
    id: 'TC-08',
    po: 'PO-9408',
    customer: 'CUST-001',
    customerName: 'Acme Corp',
    name: 'Grand Total Discrepancy (Header states $1100 vs lines $1000)',
    expectedStatus: 'MISMATCH',
    sources: ['PDF', 'EMAIL', 'JSON'],
    pdfLines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: '20', uom: 'EA', price: '50.00' }],
    pdfTotal: 1100, // Discrepancy
    emailData: {
      lines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: '20', price: '50.00' }],
      grandTotal: 1000,
    },
    jsonData: {
      lines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: 20, uom: 'EA', price: 50.0 }],
      grandTotal: 1000,
    },
  },
  {
    id: 'TC-09',
    po: 'PO-9409',
    customer: 'CUST-001',
    customerName: 'Acme Corp',
    name: 'Waiting for Source (PDF & Email ingested, JSON missing)',
    expectedStatus: 'INCOMPLETE',
    sources: ['PDF', 'EMAIL'],
    pdfLines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: '10', uom: 'EA', price: '50.00' }],
    pdfTotal: 500,
    emailData: {
      lines: [{ sku: 'SKU-001', desc: 'Industrial Widget', qty: '10', price: '50.00' }],
      grandTotal: 500,
    },
    jsonData: null,
  },
  {
    id: 'TC-10',
    po: 'PO-9410',
    customer: 'CUST-001',
    customerName: 'Acme Corp',
    name: 'High-Volume Multi-Line Order (3 Items with Matching Totals)',
    expectedStatus: 'MATCHED',
    sources: ['PDF', 'EMAIL', 'JSON'],
    pdfLines: [
      { sku: 'SKU-001', desc: 'Industrial Widget', qty: '10', uom: 'EA', price: '50.00' },
      { sku: 'LAP-001', desc: 'Laptop Standard', qty: '2', uom: 'EA', price: '800.00' },
      { sku: 'MOU-001', desc: 'Optical Mouse', qty: '10', uom: 'EA', price: '20.00' },
    ],
    pdfTotal: 2300,
    emailData: {
      lines: [
        { sku: 'SKU-001', desc: 'Industrial Widget', qty: '10', price: '50.00' },
        { sku: 'LAP-001', desc: 'Laptop Standard', qty: '2', price: '800.00' },
        { sku: 'MOU-001', desc: 'Optical Mouse', qty: '10', price: '20.00' },
      ],
      grandTotal: 2300,
    },
    jsonData: {
      lines: [
        { sku: 'SKU-001', desc: 'Industrial Widget', qty: 10, uom: 'EA', price: 50.0 },
        { sku: 'LAP-001', desc: 'Laptop Standard', qty: 2, uom: 'EA', price: 800.0 },
        { sku: 'MOU-001', desc: 'Optical Mouse', qty: 10, uom: 'EA', price: 20.0 },
      ],
      grandTotal: 2300,
    },
  },
];

async function runBatchTests() {
  console.log(`Starting generation and execution for ${testScenarios.length} test scenarios...`);
  const results = [];

  for (const tc of testScenarios) {
    const start = Date.now();
    const scenarioDir = path.join(BATCH_DIR, tc.po);
    fs.mkdirSync(scenarioDir, { recursive: true });

    const pdfPath = path.join(scenarioDir, `${tc.po}.pdf`);
    const emlPath = path.join(scenarioDir, `${tc.po}.eml`);
    const jsonPath = path.join(scenarioDir, `${tc.po}.json`);

    // 1. Generate Files
    await createPdf(pdfPath, {
      po: tc.po,
      customer: tc.customer,
      customerName: tc.customerName,
      lines: tc.pdfLines,
      grandTotal: tc.pdfTotal,
    });

    createEmail(emlPath, {
      po: tc.po,
      customer: tc.customer,
      customerName: tc.customerName,
      lines: tc.emailData.lines,
      grandTotal: tc.emailData.grandTotal,
    });

    if (tc.jsonData) {
      createJson(jsonPath, {
        po: tc.po,
        customer: tc.customer,
        customerName: tc.customerName,
        lines: tc.jsonData.lines,
        grandTotal: tc.jsonData.grandTotal,
      });
    }

    // 2. Ingest Files into Server
    let caseId = null;

    // Ingest PDF
    if (tc.sources.includes('PDF')) {
      const pdfBuffer = fs.readFileSync(pdfPath);
      const fd = new FormData();
      fd.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), `${tc.po}.pdf`);
      fd.append('sourceType', 'PDF');
      fd.append('poNumber', tc.po);
      fd.append('customerId', tc.customer);

      const res = await fetch(`${BASE_URL}/api/documents`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !data.caseId) console.error(`PDF response for ${tc.id}:`, res.status, data);
      caseId = data.caseId;
    }

    // Ingest Email
    if (tc.sources.includes('EMAIL')) {
      const emlText = fs.readFileSync(emlPath, 'utf8');
      const res = await fetch(`${BASE_URL}/api/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: 'EMAIL',
          rawText: emlText,
          caseId,
          poNumber: tc.po,
          customerId: tc.customer,
        }),
      });
      const data = await res.json();
      if (!res.ok) console.error(`Email upload error ${tc.id}:`, data);
      if (!caseId) caseId = data.caseId;
    }

    // Ingest JSON
    if (tc.sources.includes('JSON')) {
      const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const res = await fetch(`${BASE_URL}/api/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: 'JSON',
          jsonData,
          caseId,
          poNumber: tc.po,
          customerId: tc.customer,
        }),
      });
      const data = await res.json();
      if (!res.ok) console.error(`JSON upload error ${tc.id}:`, data);
      if (!caseId) caseId = data.caseId;
    }

    // 3. Trigger Reconciliation
    let actualStatus = 'UNKNOWN';
    let issues = [];
    if (caseId) {
      const reconRes = await fetch(`${BASE_URL}/api/cases/${caseId}/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initiatedBy: 'BATCH_TEST_RUNNER' }),
      });
      const reconData = await reconRes.json();
      if (reconRes.ok) {
        actualStatus = reconData.status;
        issues = reconData.issues || [];
      } else {
        console.error(`Reconcile error for ${tc.id} (${caseId}):`, reconData);
        const cRes = await fetch(`${BASE_URL}/api/cases/${caseId}`);
        const cData = await cRes.json();
        actualStatus = cData.case?.status || 'ERROR';
      }
    } else {
      console.error(`No caseId for ${tc.id}`);
    }

    const duration = Date.now() - start;

    const isPass =
      actualStatus === tc.expectedStatus ||
      (tc.expectedStatus === 'MISMATCH' && (actualStatus === 'MISMATCH' || actualStatus === 'REVIEW_REQUIRED'));

    const issueSummaryStr = issues.length
      ? issues.map((i) => `${i.issueType}: ${i.message}`).join('; ')
      : tc.expectedStatus === 'OPEN' || tc.expectedStatus === 'INCOMPLETE'
      ? 'Waiting for remaining documents (JSON)'
      : 'None (Exact match)';

    console.log(
      `[${isPass ? 'PASS' : 'FAIL'}] ${tc.id} (${tc.po}): Expected=${tc.expectedStatus}, Actual=${actualStatus} (${duration}ms)`
    );

    results.push({
      testId: tc.id,
      poNumber: tc.po,
      customerId: tc.customer,
      scenarioName: tc.name,
      sourcesIngested: tc.sources.join(' + '),
      expectedStatus: tc.expectedStatus,
      actualStatus,
      testResult: isPass ? 'PASS' : 'FAIL',
      issuesCount: issues.length,
      issuesSummary: issueSummaryStr,
      durationMs: duration,
      pdfPath: tc.sources.includes('PDF') ? pdfPath : 'N/A',
      emailPath: tc.sources.includes('EMAIL') ? emlPath : 'N/A',
      jsonPath: tc.sources.includes('JSON') ? jsonPath : 'N/A',
    });
  }

  // Write CSV
  const csvHeaders = [
    'Test_ID',
    'PO_Number',
    'Customer_ID',
    'Scenario_Name',
    'Sources_Ingested',
    'Expected_Status',
    'Actual_Status',
    'Test_Result',
    'Issues_Count',
    'Issues_Summary',
    'Duration_Ms',
    'PDF_File_Path',
    'Email_File_Path',
    'JSON_File_Path',
  ];

  const csvRows = results.map((r) => [
    r.testId,
    r.poNumber,
    r.customerId,
    `"${r.scenarioName.replace(/"/g, '""')}"`,
    `"${r.sourcesIngested}"`,
    r.expectedStatus,
    r.actualStatus,
    r.testResult,
    r.issuesCount,
    `"${r.issuesSummary.replace(/"/g, '""')}"`,
    r.durationMs,
    `"${r.pdfPath.replace(/\\/g, '/')}"`,
    `"${r.emailPath.replace(/\\/g, '/')}"`,
    `"${r.jsonPath.replace(/\\/g, '/')}"`,
  ]);

  const csvContent = [csvHeaders.join(','), ...csvRows.map((row) => row.join(','))].join('\n');

  fs.writeFileSync(CSV_PATH, csvContent, 'utf8');
  fs.writeFileSync(path.resolve(BATCH_DIR, 'test_results.csv'), csvContent, 'utf8');

  console.log(`\n======================================================`);
  console.log(`Results saved to: ${CSV_PATH}`);
  console.log(`Total tests: ${results.length}`);
  console.log(`Passed: ${results.filter((r) => r.testResult === 'PASS').length}`);
  console.log(`Failed: ${results.filter((r) => r.testResult === 'FAIL').length}`);
  console.log(`======================================================\n`);
}

runBatchTests().catch((err) => {
  console.error('Batch testing failed:', err);
  process.exit(1);
});
