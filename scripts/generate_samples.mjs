import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

async function generateSamples() {
  const samplesDir = path.resolve(process.cwd(), 'storage', 'samples');
  fs.mkdirSync(samplesDir, { recursive: true });

  // 1. PDF
  const pdfPath = path.join(samplesDir, 'order.pdf');
  const basePdf = fs.existsSync(pdfPath)
    ? pdfPath
    : path.resolve(process.cwd(), 'node_modules', 'pdf-parse', 'test', 'data', '04-valid.pdf');
  const existingPdfBytes = fs.readFileSync(basePdf);
  const pdfDoc = await PDFDocument.load(existingPdfBytes);
  const newPage = pdfDoc.addPage([600, 800]);
  while (pdfDoc.getPageCount() > 1) {
    pdfDoc.removePage(0);
  }
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  newPage.drawText(
    'Purchase Order PO-9001\n' +
    'Customer ID: CUST-001\n' +
    'Customer Name: Acme Corp\n' +
    '1 SKU-001 Industrial Widget 10 EA $50.00 $500.00\n' +
    'Grand Total: $500.00',
    {
      x: 50,
      y: 700,
      size: 14,
      font,
    }
  );

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(pdfPath, Buffer.from(pdfBytes));
  console.log(`Saved sample PDF to ${pdfPath}`);

  // 2. Email (.eml / text with quote history)
  const emlContent = `From: buyer@acme.com
To: sales@vendor.com
Date: Wed, 11 Nov 2026 09:00:00 +0000
Subject: Order PO-9001 - Acme Corp

Hi Team,

Please find our purchase order details below:
PO Number: PO-9001
Customer ID: CUST-001
Item: SKU-001
Description: Industrial Widget
Quantity: 10
Unit Price: $50.00
Total: $500.00

Thank you,
John Doe
Acme Corp

> On Tue, 10 Nov 2026 at 15:30, Vendor Sales <sales@vendor.com> wrote:
> Thanks for your inquiry regarding Industrial Widget SKU-001.
> The price is $50.00 each for orders of 10 or more.
`;
  const emlPath = path.join(samplesDir, 'order.eml');
  fs.writeFileSync(emlPath, emlContent, 'utf8');
  console.log(`Saved sample EML to ${emlPath}`);

  // 3. JSON
  const jsonContent = {
    poNumber: 'PO-9001',
    customerId: 'CUST-001',
    customerName: 'Acme Corp',
    currency: 'USD',
    lineItems: [
      {
        lineReference: '1',
        productCode: 'SKU-001',
        description: 'Industrial Widget',
        quantity: 10,
        unitOfMeasure: 'EA',
        unitPrice: 50.00,
        lineTotal: 500.00,
      },
    ],
    amounts: {
      grandTotal: 500.00,
    },
  };
  const jsonPath = path.join(samplesDir, 'order.json');
  fs.writeFileSync(jsonPath, JSON.stringify(jsonContent, null, 2), 'utf8');
  console.log(`Saved sample JSON to ${jsonPath}`);
}

generateSamples().catch(err => {
  console.error(err);
  process.exit(1);
});

