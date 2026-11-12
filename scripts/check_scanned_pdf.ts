import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { createDatabase } from '../src/db/database.js';
import { extractPdfBufferToStageA } from '../src/extractors/pdfExtractor.js';
import { inspectPdfPages } from '../src/ocr/pdfPreprocessor.js';
import { getDefaultOCRService } from '../src/ocr/index.js';
import { documentRepo, extractedTextRepo, extractedFieldsRepo, lineItemRepo, caseRepo } from '../src/db/repositories/index.js';
import { resolveOrCreateCase } from '../src/core/linking/caseLinker.js';

async function getPdfRenderer() {
  const mod = await import('pdf-to-img');
  return mod.pdf;
}

async function runScannedPdfCheck() {
  console.log('====================================================');
  console.log('   3OCR — Scanned PDF Live Tesseract OCR Check     ');
  console.log('====================================================\n');

  let pdfPath = process.argv[2];
  let pdfBuffer: Buffer;

  if (pdfPath && fs.existsSync(pdfPath)) {
    console.log(`📂 Using user-supplied PDF: ${pdfPath}`);
    pdfBuffer = fs.readFileSync(pdfPath);
  } else {
    console.log('📄 No custom file provided. Creating a pure raster scanned PDF from sample order...');
    const sourcePdfPath = path.resolve(process.cwd(), 'storage', 'samples', 'order.pdf');
    if (!fs.existsSync(sourcePdfPath)) {
      throw new Error(`Sample source PDF not found at ${sourcePdfPath}`);
    }

    const sourceBuffer = fs.readFileSync(sourcePdfPath);
    const renderPdf = await getPdfRenderer();
    const doc = await renderPdf(sourceBuffer, { scale: 2.0 });
    const pngPage = Buffer.from(await doc.getPage(1));
    await doc.destroy();

    // Embed PNG into a fresh PDF without any text glyph stream
    const scannedDoc = await PDFDocument.create();
    const embedded = await scannedDoc.embedPng(pngPage);
    const page = scannedDoc.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: embedded.width,
      height: embedded.height,
    });

    const savedBytes = await scannedDoc.save();
    pdfBuffer = Buffer.from(savedBytes);

    const outDir = path.resolve(process.cwd(), 'storage', 'samples');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    pdfPath = path.resolve(outDir, 'scanned_order.pdf');
    fs.writeFileSync(pdfPath, pdfBuffer);
    console.log(`✅ Pure scanned raster PDF generated and saved to:\n   ${pdfPath} (${pdfBuffer.length} bytes)\n`);
  }

  // 1. Page text density inspection
  console.log('🔍 Step 1: Inspecting PDF Page Text Density...');
  const pageInspection = await inspectPdfPages(pdfBuffer);
  console.log(`   Total pages: ${pageInspection.pageCount}`);
  pageInspection.pages.forEach((p) => {
    console.log(`   - Page ${p.pageNumber}: ${p.type} (${p.charCount} embedded text characters)`);
  });

  // 2. Run extraction via extractPdfBufferToStageA (automatically triggers Tesseract for scanned pages)
  console.log('\n🧠 Step 2: Running Tesseract OCR Extraction Pipeline...');
  const docId = crypto.randomUUID();
  const startTime = Date.now();

  const result = await extractPdfBufferToStageA({
    buffer: pdfBuffer,
    documentId: docId,
    receivedAt: new Date().toISOString(),
    storagePath: pdfPath,
  });

  const durationMs = Date.now() - startTime;
  console.log(`⏱️  OCR processing completed in ${durationMs}ms`);

  // 3. Inspect OCR Raw Text Output
  console.log('\n📝 Step 3: Recognized Raw Text (First 350 chars):');
  console.log('----------------------------------------------------');
  console.log(result.rawText.slice(0, 350) + (result.rawText.length > 350 ? '...' : ''));
  console.log('----------------------------------------------------');

  // 4. Inspect Canonical Stage A Extracted Values
  console.log('\n📊 Step 4: Canonical Stage A Document Extraction:');
  console.log(`   PO Number:     ${result.stageA.order.poNumber || 'N/A'}`);
  console.log(`   Customer ID:   ${result.stageA.order.customerId || 'N/A'}`);
  console.log(`   Customer Name: ${result.stageA.order.customerName || 'N/A'}`);
  console.log(`   Currency:      ${result.stageA.order.currency || 'N/A'}`);
  console.log(`   Grand Total:   ${result.stageA.amounts?.grandTotal || 'N/A'}`);
  console.log(`   Line Items:    ${result.stageA.lineItems.length} lines detected`);

  result.stageA.lineItems.forEach((item, idx) => {
    console.log(`     [Line ${idx + 1}] SKU: ${item.productCode} | Qty: ${item.quantity} | Price: ${item.unitPrice} | Total: ${item.lineTotal}`);
  });

  // 5. Inspect Evidence & Bounding Boxes
  console.log('\n🔎 Step 5: Evidence & Bounding Box Inspection:');
  const ocrEvidence = result.stageA.evidence.filter((e) => e.extractionMethod === 'OCR');
  console.log(`   OCR Evidence Tokens: ${ocrEvidence.length}`);
  ocrEvidence.slice(0, 4).forEach((e) => {
    const box = e.boundingBox ? `[bbox: (${e.boundingBox.x0}, ${e.boundingBox.y0}) to (${e.boundingBox.x1}, ${e.boundingBox.y1})]` : '';
    const conf = e.confidence !== undefined ? `conf: ${e.confidence}%` : '';
    console.log(`   - ${e.fieldPath}: "${e.rawValue}" (Page ${e.page}, chars ${e.charStart}-${e.charEnd}) ${conf} ${box}`);
  });

  // 6. Ingest into database so user can view it in the Web Dashboard
  console.log('\n💾 Step 6: Ingesting into reconciliation.db for Dashboard View...');
  const db = createDatabase('reconciliation.db');

  const poNumber = result.stageA.order.poNumber || 'PO-SCAN-101';
  const customerId = result.stageA.order.customerId || 'CUST-001';

  const caseRes = resolveOrCreateCase(db, {
    poNumber,
    customerId,
    receivedAt: new Date().toISOString(),
  });

  // Insert document
  documentRepo.insert(db, {
    id: docId,
    caseId: caseRes.caseId,
    sourceType: 'PDF',
    status: 'VALID',
    storagePath: pdfPath,
    fileHash: crypto.createHash('sha256').update(pdfBuffer).digest('hex'),
    receivedAt: new Date().toISOString(),
  });

  // Insert text
  extractedTextRepo.insert(db, {
    id: crypto.randomUUID(),
    documentId: docId,
    rawText: result.rawText,
    cleanedText: result.rawText,
    pageBreakOffsets: JSON.stringify(result.pageBreakOffsets),
  });

  // Insert Stage A
  extractedFieldsRepo.insert(db, {
    id: crypto.randomUUID(),
    documentId: docId,
    stage: 'STAGE_A',
    payload: result.stageA,
  });

  // Insert line items
  for (const item of result.stageA.lineItems) {
    lineItemRepo.insert(db, {
      id: crypto.randomUUID(),
      sourceDocumentId: docId,
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

  console.log(`\n🎉 SUCCESS! Scanned PDF linked to Case "${poNumber}".`);
  console.log(`👉 Open http://localhost:3000 in your browser and select Case "${poNumber}" to view the OCR-extracted document!`);

  await getDefaultOCRService().terminate();
}

runScannedPdfCheck().catch((err) => {
  console.error('\n❌ Error during scanned PDF check:', err);
  process.exit(1);
});
