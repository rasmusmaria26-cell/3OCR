import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'node:fs';
import path from 'node:path';

async function getPdfRenderer() {
  const mod = await import('pdf-to-img');
  return mod.pdf;
}
import {
  extractPdfBufferToStageA,
  extractPdfTextToStageA,
} from '../src/extractors/pdfExtractor.js';
import {
  OCRService,
  getDefaultOCRService,
  TesseractProvider,
  inspectPdfPages,
  checkPageQuality,
  checkDocumentQuality,
  OCRInput,
  OCRProvider,
  OCRPageResult,
} from '../src/ocr/index.js';
import { reconcileCase } from '../src/core/engine/reconciler.js';
import { evaluateCaseStatus } from '../src/core/status/statusEvaluator.js';

describe('OCR-01: Tesseract OCR Integration Test Suite', () => {
  const samplePdfPath = path.resolve(process.cwd(), 'storage', 'samples', 'order.pdf');

  afterAll(async () => {
    await getDefaultOCRService().terminate();
  });

  // Helper to create a pure raster scanned PDF from text lines
  async function createRasterPdfFromDigital(sourcePdfBuffer: Buffer): Promise<Buffer> {
    const renderPdf = await getPdfRenderer();
    const doc = await renderPdf(sourcePdfBuffer, { scale: 2.0 });
    const pngPage = Buffer.from(await doc.getPage(1));
    await doc.destroy();

    const scannedDoc = await PDFDocument.create();
    const embedded = await scannedDoc.embedPng(pngPage);
    const page = scannedDoc.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: embedded.width,
      height: embedded.height,
    });
    return Buffer.from(await scannedDoc.save());
  }

  // Helper to create a blank white raster PDF
  async function createBlankRasterPdf(): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    // 1x1 white PNG embedded and scaled
    const whitePngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const embedded = await pdfDoc.embedPng(Buffer.from(whitePngBase64, 'base64'));
    const page = pdfDoc.addPage([600, 800]);
    page.drawImage(embedded, { x: 0, y: 0, width: 600, height: 800 });
    return Buffer.from(await pdfDoc.save());
  }

  // Helper to create a mixed 2-page PDF: Page 1 Digital, Page 2 Scanned
  async function createMixedPdf(sampleBuffer: Buffer): Promise<Buffer> {
    const mixedDoc = await PDFDocument.create();
    const font = await mixedDoc.embedFont(StandardFonts.Helvetica);

    // Page 1: Digital text
    const p1 = mixedDoc.addPage([600, 800]);
    p1.drawText('Purchase Order PO-9001\nCustomer ID: CUST-001\nCustomer Name: Acme Corp', {
      x: 50,
      y: 720,
      size: 14,
      font,
      color: rgb(0, 0, 0),
    });

    // Page 2: Raster scanned image of line item
    const lineDoc = await PDFDocument.create();
    const lineP = lineDoc.addPage([600, 400]);
    const lineFont = await lineDoc.embedFont(StandardFonts.Helvetica);
    lineP.drawText('1 SKU-001 Industrial Widget 10 EA $50.00 $500.00\nGrand Total: $500.00', {
      x: 50,
      y: 300,
      size: 14,
      font: lineFont,
      color: rgb(0, 0, 0),
    });
    const lineBuf = Buffer.from(await lineDoc.save());

    const renderPdf = await getPdfRenderer();
    const doc = await renderPdf(lineBuf, { scale: 2.0 });
    const pngPage = Buffer.from(await doc.getPage(1));
    await doc.destroy();

    const embeddedPng = await mixedDoc.embedPng(pngPage);
    const p2 = mixedDoc.addPage([600, 800]);
    p2.drawImage(embeddedPng, {
      x: 50,
      y: 400,
      width: 500,
      height: 333,
    });

    return Buffer.from(await mixedDoc.save());
  }

  it('1. Digital PDF: extracts text and evidence without triggering OCR', async () => {
    const digitalBuffer = fs.readFileSync(samplePdfPath);
    const inspection = await inspectPdfPages(digitalBuffer);

    expect(inspection.isFullyDigital).toBe(true);
    expect(inspection.hasScannedPages).toBe(false);

    const extraction = await extractPdfBufferToStageA({
      buffer: digitalBuffer,
      documentId: 'doc-digital-test',
      receivedAt: new Date().toISOString(),
    });

    expect(extraction.stageA.order.poNumber).toBe('PO-9001');
    expect(extraction.stageA.order.customerId).toBe('CUST-001');
    expect(extraction.stageA.amounts.grandTotal).toBe('500.00');
    expect(extraction.stageA.lineItems).toHaveLength(1);

    // Extraction method must be PDF_PARSE, not OCR
    const poEvidence = extraction.stageA.evidence.find((e) => e.fieldPath === 'order.poNumber');
    expect(poEvidence).toBeDefined();
    expect(poEvidence?.extractionMethod).toBe('PDF_PARSE');
    expect(poEvidence?.boundingBox).toBeNull();
    expect(poEvidence?.confidence).toBeNull();
  });

  it('2. Fully scanned PDF: Tesseract OCR extracts text, bounding boxes, and evidence', async () => {
    const digitalBuffer = fs.readFileSync(samplePdfPath);
    const scannedBuffer = await createRasterPdfFromDigital(digitalBuffer);

    // Verify inspection flags it as scanned
    const inspection = await inspectPdfPages(scannedBuffer);
    expect(inspection.isFullyScanned).toBe(true);
    expect(inspection.hasScannedPages).toBe(true);
    expect(inspection.pages[0].itemCount).toBe(0);

    // Extract via OCR pipeline
    const extraction = await extractPdfBufferToStageA({
      buffer: scannedBuffer,
      documentId: 'doc-scanned-test',
      receivedAt: new Date().toISOString(),
    });

    expect(extraction.stageA.order.poNumber).toBe('PO-9001');
    expect(extraction.stageA.order.customerId).toBe('CUST-001');
    expect(extraction.stageA.amounts.grandTotal).toBe('500.00');
    expect(extraction.stageA.lineItems.length).toBeGreaterThanOrEqual(1);

    // Evidence must carry OCR extraction method, bounding boxes, and confidence
    const poEv = extraction.stageA.evidence.find((e) => e.fieldPath === 'order.poNumber');
    expect(poEv).toBeDefined();
    expect(poEv?.extractionMethod).toBe('OCR');
    expect(poEv?.page).toBe(1);
    expect(poEv?.confidence).toBeGreaterThan(60);
    expect(poEv?.boundingBox).toBeDefined();
    expect(poEv?.boundingBox?.x1).toBeGreaterThan(poEv?.boundingBox?.x0 || 0);
    expect(poEv?.boundingBox?.y1).toBeGreaterThan(poEv?.boundingBox?.y0 || 0);

    const skuEv = extraction.stageA.evidence.find((e) => e.fieldPath === 'lineItems[0].productCode');
    expect(skuEv).toBeDefined();
    expect(skuEv?.extractionMethod).toBe('OCR');
    expect(skuEv?.boundingBox).not.toBeNull();
    expect(skuEv?.confidence).toBeGreaterThan(60);
  }, 30000);

  it('3. Mixed PDF: preserves page ordering, routes digital to PDF_PARSE and scanned to OCR', async () => {
    const digitalBuffer = fs.readFileSync(samplePdfPath);
    const mixedBuffer = await createMixedPdf(digitalBuffer);

    const inspection = await inspectPdfPages(mixedBuffer);
    expect(inspection.totalPages).toBe(2);
    expect(inspection.hasDigitalPages).toBe(true);
    expect(inspection.hasScannedPages).toBe(true);
    expect(inspection.pages[0].isScanned).toBe(false);
    expect(inspection.pages[1].isScanned).toBe(true);

    const extraction = await extractPdfBufferToStageA({
      buffer: mixedBuffer,
      documentId: 'doc-mixed-test',
      receivedAt: new Date().toISOString(),
    });

    expect(extraction.pageBreakOffsets.length).toBe(2);
    expect(extraction.pageBreakOffsets[0]).toBe(0);
    expect(extraction.pageBreakOffsets[1]).toBeGreaterThan(0);

    // Page 1 header fields should have PDF_PARSE
    const poEv = extraction.stageA.evidence.find((e) => e.fieldPath === 'order.poNumber');
    expect(poEv).toBeDefined();
    expect(poEv?.page).toBe(1);
    expect(poEv?.extractionMethod).toBe('PDF_PARSE');

    // Page 2 line items should have OCR extraction method and bounding box
    const skuEv = extraction.stageA.evidence.find((e) => e.fieldPath === 'lineItems[0].productCode');
    expect(skuEv).toBeDefined();
    expect(skuEv?.page).toBe(2);
    expect(skuEv?.extractionMethod).toBe('OCR');
    expect(skuEv?.boundingBox).toBeDefined();
  }, 30000);

  it('4. Empty scanned PDF: handled gracefully without crash and flags quality issue', async () => {
    const blankScannedPdf = await createBlankRasterPdf();

    const extraction = await extractPdfBufferToStageA({
      buffer: blankScannedPdf,
      documentId: 'doc-empty-scan',
      receivedAt: new Date().toISOString(),
    });

    expect(extraction.stageA.order.poNumber).toBeNull();
    expect(extraction.stageA.lineItems).toHaveLength(0);
    expect(extraction.stageA.amounts.grandTotal).toBeNull();

    // Must generate LOW_OCR_CONFIDENCE or quality issue
    expect(extraction.issues.length).toBeGreaterThan(0);
    const blankIssue = extraction.issues.find(
      (i) => i.code === 'LOW_OCR_CONFIDENCE' && i.isBlocking === true
    );
    expect(blankIssue).toBeDefined();
  }, 20000);

  it('5. Blurry / rotated scan: detected and gated by quality checker', () => {
    // Test quality checker with synthetic degraded / rotated scan data
    const degradedPage: OCRPageResult = {
      pageNumber: 1,
      text: '~~? §* &@!!',
      confidence: 25, // very low confidence due to severe blur
      lines: [],
      words: [
        {
          text: '~~?',
          confidence: 20,
          bbox: { x0: 10, y0: 10, x1: 50, y1: 30 },
        },
      ],
      isScanned: true,
    };

    const report = checkPageQuality(degradedPage);
    expect(report.passed).toBe(false);
    expect(report.hasBlockingIssue).toBe(true);
    expect(report.issues.some((i) => i.code === 'UNREADABLE_SCAN' || i.code === 'LOW_OCR_CONFIDENCE')).toBe(true);
  });

  it('6. OCR execution failure: produces controlled error with clean resource handling', async () => {
    // Mock failing provider
    const failingProvider: OCRProvider = {
      name: 'failing-mock',
      recognize: async () => {
        throw new Error('Fatal worker crash in Wasm runtime');
      },
      terminate: async () => {},
    };

    const mockService = new OCRService({ provider: failingProvider });
    const digitalBuffer = fs.readFileSync(samplePdfPath);
    const scannedBuffer = await createRasterPdfFromDigital(digitalBuffer);

    await expect(
      extractPdfBufferToStageA({
        buffer: scannedBuffer,
        documentId: 'doc-fail-test',
        receivedAt: new Date().toISOString(),
        ocrService: mockService,
      })
    ).rejects.toThrow(/Fatal worker crash in Wasm runtime/);
  });

  it('7. Corrupted PDF: handled gracefully with controlled error', async () => {
    const corruptBuffer = Buffer.from('NOT_A_VALID_PDF_STREAM_CORRUPT');

    await expect(
      extractPdfBufferToStageA({
        buffer: corruptBuffer,
        documentId: 'doc-corrupt',
        receivedAt: new Date().toISOString(),
      })
    ).rejects.toThrow(/PDF_PARSE_STREAM_CORRUPT/);
  });

  it('8. Evidence mapping: preserves bounding boxes and word confidence envelope', () => {
    const mockOcrPage: OCRPageResult = {
      pageNumber: 1,
      text: 'Purchase Order PO-9001\n1 SKU-001 Widget 10 EA $50.00 $500.00',
      confidence: 90,
      lines: [],
      words: [
        {
          text: 'PO-9001',
          confidence: 92,
          bbox: { x0: 120, y0: 50, x1: 200, y1: 70 },
          charStart: 15,
          charEnd: 22,
        },
        {
          text: 'SKU-001',
          confidence: 88,
          bbox: { x0: 50, y0: 100, x1: 110, y1: 120 },
          charStart: 25,
          charEnd: 32,
        },
        {
          text: '50.00',
          confidence: 94,
          bbox: { x0: 250, y0: 100, x1: 290, y1: 120 },
          charStart: 45,
          charEnd: 50,
        },
      ],
      isScanned: true,
    };

    const ocrResult = {
      fullText: mockOcrPage.text,
      pages: [mockOcrPage],
      averageConfidence: 90,
      pageBreakOffsets: [0],
      provider: 'tesseract',
    };

    const extraction = extractPdfTextToStageA({
      rawText: mockOcrPage.text,
      documentId: 'doc-evidence-test',
      receivedAt: new Date().toISOString(),
      pageBreakOffsets: [0],
      ocrResult,
    });

    expect(extraction.stageA.order.poNumber).toBe('PO-9001');
    const poEv = extraction.stageA.evidence.find((e) => e.fieldPath === 'order.poNumber');
    expect(poEv).toBeDefined();
    expect(poEv?.extractionMethod).toBe('OCR');
    expect(poEv?.confidence).toBe(92);
    expect(poEv?.boundingBox).toEqual({ x0: 120, y0: 50, x1: 200, y1: 70 });
  });

  it('9. Low confidence gating: fields with <60% confidence produce LOW_OCR_CONFIDENCE issue and block auto-matching', () => {
    // Mock OCR page with low confidence (45%) on the PO number
    const mockLowConfPage: OCRPageResult = {
      pageNumber: 1,
      text: 'Purchase Order PO-9001\n1 SKU-001 Widget 10 EA $50.00 $500.00\nGrand Total: $500.00',
      confidence: 45,
      lines: [],
      words: [
        {
          text: 'PO-9001',
          confidence: 45, // < 60% threshold!
          bbox: { x0: 100, y0: 50, x1: 180, y1: 70 },
          charStart: 15,
          charEnd: 22,
        },
        {
          text: 'SKU-001',
          confidence: 95,
          bbox: { x0: 50, y0: 100, x1: 120, y1: 120 },
          charStart: 25,
          charEnd: 32,
        },
      ],
      isScanned: true,
    };

    const ocrResult = {
      fullText: mockLowConfPage.text,
      pages: [mockLowConfPage],
      averageConfidence: 45,
      pageBreakOffsets: [0],
      provider: 'tesseract',
    };

    const extraction = extractPdfTextToStageA({
      rawText: mockLowConfPage.text,
      documentId: 'doc-low-conf-test',
      receivedAt: new Date().toISOString(),
      pageBreakOffsets: [0],
      ocrResult,
    });

    // PO number must have a LOW_OCR_CONFIDENCE verification issue
    const lowConfIssue = extraction.issues.find(
      (i) => i.code === 'LOW_OCR_CONFIDENCE' && i.fieldPath === 'order.poNumber'
    );
    expect(lowConfIssue).toBeDefined();
    expect(lowConfIssue?.isBlocking).toBe(true);

    // When statusEvaluator processes a document with blocking extraction issues:
    const statusResult = evaluateCaseStatus({
      hasBlockingIssues: true,
      hasMismatches: false,
      hasPendingExpectedSources: false,
    });

    // Low confidence MUST NOT be silently trusted -> status must be REVIEW_REQUIRED!
    expect(statusResult.status).toBe('REVIEW_REQUIRED');
  });
});
