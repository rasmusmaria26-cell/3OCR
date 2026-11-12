// @ts-ignore
import pdfParseFn from 'pdf-parse/lib/pdf-parse.js';

async function getPdfRenderer() {
  const mod = await import('pdf-to-img');
  return mod.pdf;
}

const pdfParse: (dataBuffer: Buffer, options?: any) => Promise<any> =
  (pdfParseFn as any)?.default || pdfParseFn;

export interface PageClassification {
  pageNumber: number;
  isScanned: boolean;
  itemCount: number;
  alphanumericCount: number;
  digitalText: string;
}

export interface PDFInspectionResult {
  totalPages: number;
  pages: PageClassification[];
  hasScannedPages: boolean;
  hasDigitalPages: boolean;
  isFullyDigital: boolean;
  isFullyScanned: boolean;
}

export interface RenderPageOptions {
  scale?: number;
}

/**
 * Inspects a PDF buffer page-by-page using text glyph density heuristics.
 * A page is classified as Scanned if:
 * - text item count < 5 OR
 * - alphanumeric character count < 20
 */
export async function inspectPdfPages(buffer: Buffer): Promise<PDFInspectionResult> {
  const pages: PageClassification[] = [];
  let pageIdx = 0;

  try {
    await pdfParse(buffer, {
      pagerender: (pageData: any) => {
        return pageData.getTextContent({
          normalizeWhitespace: false,
          disableCombineTextItems: false,
        }).then((textContent: any) => {
          pageIdx++;
          const items: any[] = textContent.items || [];
          let lastY: any;
          let pageText = '';
          for (const item of items) {
            if (lastY === item.transform?.[5] || !lastY) {
              pageText += item.str;
            } else {
              pageText += '\n' + item.str;
            }
            lastY = item.transform?.[5];
          }

          const alphanumericMatches = pageText.match(/[a-zA-Z0-9]/g) || [];
          const alphanumericCount = alphanumericMatches.length;
          const itemCount = items.length;

          const isScanned = itemCount === 0 || alphanumericCount < 20;

          pages.push({
            pageNumber: pageIdx,
            isScanned,
            itemCount,
            alphanumericCount,
            digitalText: pageText,
          });

          return pageText;
        });
      },
    });
  } catch (err: any) {
    // If pdf-parse failed, inspect page count using pdf-to-img renderer
    try {
      const renderPdf = await getPdfRenderer();
      const doc = await renderPdf(buffer);
      const total = doc.length;
      await doc.destroy();

      if (total > 0) {
        for (let i = 1; i <= total; i++) {
          pages.push({
            pageNumber: i,
            isScanned: true,
            itemCount: 0,
            alphanumericCount: 0,
            digitalText: '',
          });
        }
      }
    } catch (renderErr: any) {
      throw new Error(`PDF_CORRUPT: Failed to inspect PDF buffer: ${err?.message || renderErr?.message}`);
    }
  }

  if (pages.length === 0) {
    // Attempt fallback to pdf-to-img to see if it has pages
    try {
      const renderPdf = await getPdfRenderer();
      const doc = await renderPdf(buffer);
      const total = doc.length;
      await doc.destroy();
      for (let i = 1; i <= total; i++) {
        pages.push({
          pageNumber: i,
          isScanned: true,
          itemCount: 0,
          alphanumericCount: 0,
          digitalText: '',
        });
      }
    } catch {
      throw new Error('PDF_CORRUPT: Unable to read any pages from PDF stream');
    }
  }

  const hasScannedPages = pages.some((p) => p.isScanned);
  const hasDigitalPages = pages.some((p) => !p.isScanned);

  return {
    totalPages: pages.length,
    pages,
    hasScannedPages,
    hasDigitalPages,
    isFullyDigital: !hasScannedPages && hasDigitalPages,
    isFullyScanned: hasScannedPages && !hasDigitalPages,
  };
}

/**
 * Renders a specific 1-based page of a PDF buffer to an image Buffer (PNG).
 * Ensures temporary resources are destroyed in finally block.
 */
export async function renderPdfPageToImage(
  buffer: Buffer,
  pageNumber: number,
  options?: RenderPageOptions
): Promise<Buffer> {
  const scale = options?.scale || 2.0;
  let doc: any = null;
  try {
    const renderPdf = await getPdfRenderer();
    doc = await renderPdf(buffer, { scale });
    if (pageNumber < 1 || pageNumber > doc.length) {
      throw new Error(`Invalid page number ${pageNumber}. PDF has ${doc.length} pages.`);
    }
    const pageImage = await doc.getPage(pageNumber);
    return Buffer.from(pageImage);
  } catch (err: any) {
    throw new Error(`PDF_RENDER_FAILED: Could not render page ${pageNumber}: ${err.message}`);
  } finally {
    if (doc && typeof doc.destroy === 'function') {
      try {
        await doc.destroy();
      } catch {
        // ignore cleanup error
      }
    }
  }
}

/**
 * Batch renders multiple pages to image Buffers.
 */
export async function renderPdfPagesToImages(
  buffer: Buffer,
  pageNumbers: number[],
  options?: RenderPageOptions
): Promise<Map<number, Buffer>> {
  const results = new Map<number, Buffer>();
  const scale = options?.scale || 2.0;
  let doc: any = null;

  try {
    const renderPdf = await getPdfRenderer();
    doc = await renderPdf(buffer, { scale });
    for (const pageNum of pageNumbers) {
      if (pageNum >= 1 && pageNum <= doc.length) {
        const pageImage = await doc.getPage(pageNum);
        results.set(pageNum, Buffer.from(pageImage));
      }
    }
    return results;
  } catch (err: any) {
    throw new Error(`PDF_RENDER_FAILED: Batch page rendering failed: ${err.message}`);
  } finally {
    if (doc && typeof doc.destroy === 'function') {
      try {
        await doc.destroy();
      } catch {
        // ignore cleanup error
      }
    }
  }
}
