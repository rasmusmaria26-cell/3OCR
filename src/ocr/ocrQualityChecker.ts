import { OCRPageResult, OCRResult, OCRWord } from './ocrResult.schema.js';

export interface QualityIssue {
  code: 'BLANK_PAGE' | 'LOW_TEXT_DENSITY' | 'UNREADABLE_SCAN' | 'LOW_OCR_CONFIDENCE';
  message: string;
  pageNumber: number;
  confidence?: number;
  details?: Record<string, any>;
}

export interface QualityReport {
  passed: boolean;
  issues: QualityIssue[];
  hasBlockingIssue: boolean;
  averageConfidence: number;
}

export interface QualityCheckerOptions {
  minConfidence?: number; // default: 60
  minWordsPerPage?: number; // default: 3
  minCharsPerPage?: number; // default: 10
}

export const DEFAULT_CONFIDENCE_THRESHOLD = 60;
export const DEFAULT_MIN_WORDS = 3;
export const DEFAULT_MIN_CHARS = 10;

/**
 * Checks whether an OCR page contains zero or negligible text.
 */
export function isPageBlank(page: OCRPageResult): boolean {
  const trimmed = page.text.trim();
  if (trimmed.length === 0) return true;
  const alphanumeric = (trimmed.match(/[a-zA-Z0-9]/g) || []).length;
  return alphanumeric === 0 || page.words.length === 0;
}

/**
 * Checks whether text density on a page is suspiciously low (sparse scan).
 */
export function isTextDensityLow(
  page: OCRPageResult,
  minWords = DEFAULT_MIN_WORDS,
  minChars = DEFAULT_MIN_CHARS
): boolean {
  if (isPageBlank(page)) return true;
  const alphanumeric = (page.text.match(/[a-zA-Z0-9]/g) || []).length;
  return page.words.length < minWords || alphanumeric < minChars;
}

/**
 * Checks if a scan is unreadable due to extremely low confidence or severe garbling.
 */
export function isScanUnreadable(page: OCRPageResult): boolean {
  if (page.confidence < 30 && page.words.length > 0) {
    return true;
  }
  return false;
}

/**
 * Evaluates quality for a single OCR page.
 */
export function checkPageQuality(
  page: OCRPageResult,
  options?: QualityCheckerOptions
): QualityReport {
  const minConfidence = options?.minConfidence ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const minWords = options?.minWordsPerPage ?? DEFAULT_MIN_WORDS;
  const minChars = options?.minCharsPerPage ?? DEFAULT_MIN_CHARS;

  const issues: QualityIssue[] = [];

  if (isPageBlank(page)) {
    issues.push({
      code: 'BLANK_PAGE',
      message: `Page ${page.pageNumber} contains no readable text or characters.`,
      pageNumber: page.pageNumber,
      confidence: page.confidence,
    });
  } else if (isTextDensityLow(page, minWords, minChars)) {
    issues.push({
      code: 'LOW_TEXT_DENSITY',
      message: `Page ${page.pageNumber} has unusually low text density (${page.words.length} words, ${page.text.trim().length} chars).`,
      pageNumber: page.pageNumber,
      confidence: page.confidence,
      details: { wordCount: page.words.length, charCount: page.text.trim().length },
    });
  }

  if (isScanUnreadable(page)) {
    issues.push({
      code: 'UNREADABLE_SCAN',
      message: `Page ${page.pageNumber} scan appears unreadable with average confidence ${page.confidence}%.`,
      pageNumber: page.pageNumber,
      confidence: page.confidence,
    });
  } else if (page.isScanned && page.confidence < minConfidence) {
    issues.push({
      code: 'LOW_OCR_CONFIDENCE',
      message: `Page ${page.pageNumber} OCR confidence (${page.confidence}%) is below minimum threshold (${minConfidence}%).`,
      pageNumber: page.pageNumber,
      confidence: page.confidence,
    });
  }

  const hasBlockingIssue = issues.some(
    (i) => i.code === 'BLANK_PAGE' || i.code === 'UNREADABLE_SCAN' || i.code === 'LOW_OCR_CONFIDENCE'
  );

  return {
    passed: issues.length === 0,
    issues,
    hasBlockingIssue,
    averageConfidence: page.confidence,
  };
}

/**
 * Evaluates overall document OCR quality across all pages.
 */
export function checkDocumentQuality(
  result: OCRResult,
  options?: QualityCheckerOptions
): QualityReport {
  const allIssues: QualityIssue[] = [];

  for (const page of result.pages) {
    const pageReport = checkPageQuality(page, options);
    allIssues.push(...pageReport.issues);
  }

  const minConfidence = options?.minConfidence ?? DEFAULT_CONFIDENCE_THRESHOLD;
  if (result.pages.some((p) => p.isScanned) && result.averageConfidence < minConfidence) {
    const exists = allIssues.some((i) => i.code === 'LOW_OCR_CONFIDENCE');
    if (!exists) {
      allIssues.push({
        code: 'LOW_OCR_CONFIDENCE',
        message: `Overall document OCR average confidence (${result.averageConfidence}%) is below threshold (${minConfidence}%).`,
        pageNumber: 1,
        confidence: result.averageConfidence,
      });
    }
  }

  const hasBlockingIssue = allIssues.some(
    (i) => i.code === 'BLANK_PAGE' || i.code === 'UNREADABLE_SCAN' || i.code === 'LOW_OCR_CONFIDENCE'
  );

  return {
    passed: allIssues.length === 0,
    issues: allIssues,
    hasBlockingIssue,
    averageConfidence: result.averageConfidence,
  };
}

/**
 * Finds all words in a page that fall below a confidence threshold.
 */
export function findLowConfidenceWords(
  words: OCRWord[],
  threshold = DEFAULT_CONFIDENCE_THRESHOLD
): OCRWord[] {
  return words.filter((w) => w.confidence < threshold);
}
