import { OCRProvider } from './ocrProvider.js';
import { TesseractProvider } from './tesseractProvider.js';
import {
  OCRResult,
  OCRPageResult,
  OCRWord,
  OCRLine,
  BoundingBox,
} from './ocrResult.schema.js';
import {
  inspectPdfPages,
  renderPdfPageToImage,
  PDFInspectionResult,
} from './pdfPreprocessor.js';
import {
  checkDocumentQuality,
  QualityReport,
  DEFAULT_CONFIDENCE_THRESHOLD,
} from './ocrQualityChecker.js';

export interface OCRServiceOptions {
  provider?: OCRProvider;
  scale?: number;
  language?: string;
  minConfidence?: number;
}

export class OCRService {
  private provider: OCRProvider;
  private ownProvider = false;

  constructor(options?: OCRServiceOptions) {
    if (options?.provider) {
      this.provider = options.provider;
    } else {
      this.provider = new TesseractProvider({ language: options?.language || 'eng' });
      this.ownProvider = true;
    }
  }

  public getProvider(): OCRProvider {
    return this.provider;
  }

  /**
   * Coordinates digital text extraction vs OCR for digital, scanned, and mixed PDFs.
   * Assembles pages in strict sequential order and computes accurate pageBreakOffsets.
   */
  public async processPdf(
    buffer: Buffer,
    options?: OCRServiceOptions
  ): Promise<{ ocrResult: OCRResult; quality: QualityReport; inspection: PDFInspectionResult }> {
    const inspection = await inspectPdfPages(buffer);
    const pages: OCRPageResult[] = [];
    const pageBreakOffsets: number[] = [0];
    let fullText = '';

    for (const pageInfo of inspection.pages) {
      const pageNum = pageInfo.pageNumber;

      if (pageInfo.isScanned) {
        // Render scanned page as image and run OCR
        const imgBuffer = await renderPdfPageToImage(buffer, pageNum, {
          scale: options?.scale || 2.0,
        });

        const pageResult = await this.provider.recognize({
          buffer: imgBuffer,
          pageNumber: pageNum,
          language: options?.language || 'eng',
        });

        pages.push(pageResult);
      } else {
        // Digital page: retain digital text and synthesize word positions
        const words = this.synthesizeDigitalWords(pageInfo.digitalText);
        const lines: OCRLine[] = [
          {
            text: pageInfo.digitalText,
            confidence: 100,
            bbox: { x0: 0, y0: 0, x1: 0, y1: 0 },
            words,
          },
        ];

        pages.push({
          pageNumber: pageNum,
          text: pageInfo.digitalText,
          confidence: 100,
          lines,
          words,
          isScanned: false,
        });
      }
    }

    // Assemble text and calculate sequential pageBreakOffsets
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (i === 0) {
        fullText = page.text;
      } else {
        pageBreakOffsets.push(fullText.length + 2);
        fullText += '\n\n' + page.text;
      }
    }

    const totalConf = pages.reduce((sum, p) => sum + p.confidence, 0);
    const averageConfidence = pages.length > 0 ? Math.round(totalConf / pages.length) : 0;

    const ocrResult: OCRResult = {
      fullText,
      pages,
      averageConfidence,
      pageBreakOffsets,
      provider: this.provider.name,
      metadata: {
        totalPages: inspection.totalPages,
        hasScannedPages: inspection.hasScannedPages,
        hasDigitalPages: inspection.hasDigitalPages,
        isFullyScanned: inspection.isFullyScanned,
        isFullyDigital: inspection.isFullyDigital,
      },
    };

    const quality = checkDocumentQuality(ocrResult, {
      minConfidence: options?.minConfidence ?? DEFAULT_CONFIDENCE_THRESHOLD,
    });

    return { ocrResult, quality, inspection };
  }

  private synthesizeDigitalWords(text: string): OCRWord[] {
    const words: OCRWord[] = [];
    const regex = /\S+/g;
    let match: RegExpExecArray | null;
    let wordNum = 0;

    while ((match = regex.exec(text)) !== null) {
      words.push({
        text: match[0],
        confidence: 100,
        bbox: { x0: 0, y0: 0, x1: 0, y1: 0 },
        wordNum: wordNum++,
        charStart: match.index,
        charEnd: match.index + match[0].length,
      });
    }

    return words;
  }

  public async terminate(): Promise<void> {
    if (this.ownProvider && typeof this.provider.terminate === 'function') {
      await this.provider.terminate();
    }
  }
}

/**
 * Singleton or shared OCRService instance for general use.
 */
let defaultService: OCRService | null = null;

export function getDefaultOCRService(): OCRService {
  if (!defaultService) {
    defaultService = new OCRService();
  }
  return defaultService;
}

/**
 * Computes bounding box envelope and minimum confidence for evidence matching
 * a given character range on a specific page.
 */
export function computeEvidenceMetadata(
  page: OCRPageResult | undefined,
  pageCharStart: number,
  pageCharEnd: number
): { boundingBox: BoundingBox | null; confidence: number | null } {
  if (!page || !page.words || page.words.length === 0) {
    return { boundingBox: null, confidence: page?.confidence ?? null };
  }

  if (!page.isScanned) {
    return { boundingBox: null, confidence: 100 };
  }

  // Find all words that overlap [pageCharStart, pageCharEnd]
  const overlapping = page.words.filter((w) => {
    if (w.charStart === undefined || w.charEnd === undefined) return false;
    return w.charStart < pageCharEnd && w.charEnd > pageCharStart;
  });

  if (overlapping.length === 0) {
    return {
      boundingBox: null,
      confidence: page.confidence,
    };
  }

  const x0 = Math.min(...overlapping.map((w) => w.bbox.x0));
  const y0 = Math.min(...overlapping.map((w) => w.bbox.y0));
  const x1 = Math.max(...overlapping.map((w) => w.bbox.x1));
  const y1 = Math.max(...overlapping.map((w) => w.bbox.y1));
  const minConfidence = Math.min(...overlapping.map((w) => w.confidence));

  return {
    boundingBox: { x0, y0, x1, y1 },
    confidence: minConfidence,
  };
}
