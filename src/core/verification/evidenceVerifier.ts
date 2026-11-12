import { parseDecimal } from '../decimal/decimalParser.js';

export interface TokenOccurrence {
  start: number;
  end: number;
}

export interface VerificationIssue {
  code: 'SNIPPET_NOT_FOUND' | 'TOKEN_BOUNDARY_VIOLATION' | 'VALUE_MISMATCH' | 'PARSER_FAILURE' | 'CURRENCY_MISMATCH';
  fieldPath: string;
  candidateValue?: string;
  rawValue?: string;
  snippet?: string;
  isBlocking: boolean;
}

export interface VerificationResult {
  isValid: boolean;
  charStart?: number;
  charEnd?: number;
  page?: number;
  issue: VerificationIssue | null;
}

export function isValidNumberBoundary(text: string, matchStart: number, matchEnd: number): boolean {
  // Preceding boundary: not preceded by a digit, nor by a '.' or ',' attached to a digit
  const beforeIdx = matchStart - 1;
  if (beforeIdx >= 0) {
    const chBefore = text[beforeIdx];
    if (/\d/.test(chBefore)) {
      return false;
    }
    if (chBefore === '.' || chBefore === ',') {
      // Attached to a digit on the left (e.g. 1.10 or 1,10)
      if (beforeIdx - 1 >= 0 && /\d/.test(text[beforeIdx - 1])) {
        return false;
      }
      // Attached to a digit on the right (e.g. .10 or ,10)
      if (matchStart < text.length && /\d/.test(text[matchStart])) {
        return false;
      }
    }
  }

  // Following boundary: not followed by a digit, nor by a '.' or ',' attached to a digit
  const afterIdx = matchEnd;
  if (afterIdx < text.length) {
    const chAfter = text[afterIdx];
    if (/\d/.test(chAfter)) {
      return false;
    }
    if (chAfter === '.' || chAfter === ',') {
      // Attached to a digit on the right (e.g. 10.50 or 10,000)
      if (afterIdx + 1 < text.length && /\d/.test(text[afterIdx + 1])) {
        return false;
      }
    }
  }

  return true;
}

export function isValidWordBoundary(text: string, matchStart: number, matchEnd: number): boolean {
  const beforeIdx = matchStart - 1;
  if (beforeIdx >= 0) {
    const chBefore = text[beforeIdx];
    if (/[a-zA-Z0-9_]/.test(chBefore)) {
      return false;
    }
  }

  const afterIdx = matchEnd;
  if (afterIdx < text.length) {
    const chAfter = text[afterIdx];
    if (/[a-zA-Z0-9_]/.test(chAfter)) {
      return false;
    }
  }

  return true;
}

export function findTokenBoundaryOccurrences(text: string, rawValue: string, isNumeric: boolean): TokenOccurrence[] {
  const results: TokenOccurrence[] = [];
  if (!text || !rawValue) return results;

  let pos = 0;
  while (pos < text.length) {
    const idx = text.indexOf(rawValue, pos);
    if (idx === -1) break;

    const end = idx + rawValue.length;
    const isValid = isNumeric
      ? isValidNumberBoundary(text, idx, end)
      : isValidWordBoundary(text, idx, end);

    if (isValid) {
      results.push({ start: idx, end });
    }
    pos = idx + 1;
  }

  return results;
}

export function getPageForOffset(offset: number, pageBreakOffsets?: number[] | null): number {
  if (!pageBreakOffsets || pageBreakOffsets.length === 0) {
    return 1;
  }

  // pageBreakOffsets is a sorted list of offsets marking page starts, e.g. [0, 500, 1200]
  // Page 1: [0, 500), Page 2: [500, 1200), Page 3: 1200+
  let page = 1;
  for (let i = 0; i < pageBreakOffsets.length; i++) {
    if (offset >= pageBreakOffsets[i]) {
      page = i + 1;
    } else {
      break;
    }
  }
  return page;
}

export function verifyEvidence(params: {
  documentText: string;
  snippet: string;
  rawValue: string;
  expectedValue: string;
  isNumeric: boolean;
  fieldPath: string;
  isBlockingField: boolean;
  expectedCurrency?: string | null;
  pageBreakOffsets?: number[] | null;
}): VerificationResult {
  const {
    documentText,
    snippet,
    rawValue,
    expectedValue,
    isNumeric,
    fieldPath,
    isBlockingField,
    expectedCurrency,
    pageBreakOffsets,
  } = params;

  // 1. Snippet check: snippet must be exact substring of documentText
  if (!snippet || documentText.indexOf(snippet) === -1) {
    return {
      isValid: false,
      issue: {
        code: 'SNIPPET_NOT_FOUND',
        fieldPath,
        candidateValue: expectedValue,
        rawValue,
        snippet,
        isBlocking: isBlockingField,
      },
    };
  }

  // 2. Token boundary check inside the snippet
  const snippetOccurrences = findTokenBoundaryOccurrences(snippet, rawValue, isNumeric);
  if (snippetOccurrences.length === 0) {
    return {
      isValid: false,
      issue: {
        code: 'TOKEN_BOUNDARY_VIOLATION',
        fieldPath,
        candidateValue: expectedValue,
        rawValue,
        snippet,
        isBlocking: isBlockingField,
      },
    };
  }

  // Find an occurrence of snippet in documentText where rawValue at (sIdx + occ.start)
  // also satisfies the token boundary check in documentText
  let validCharStart: number | null = null;
  let validCharEnd: number | null = null;

  let searchPos = 0;
  while (searchPos <= documentText.length - snippet.length) {
    const sIdx = documentText.indexOf(snippet, searchPos);
    if (sIdx === -1) break;

    for (const occ of snippetOccurrences) {
      const cStart = sIdx + occ.start;
      const cEnd = sIdx + occ.end;
      const isDocBoundaryValid = isNumeric
        ? isValidNumberBoundary(documentText, cStart, cEnd)
        : isValidWordBoundary(documentText, cStart, cEnd);

      if (isDocBoundaryValid) {
        validCharStart = cStart;
        validCharEnd = cEnd;
        break;
      }
    }

    if (validCharStart !== null) {
      break;
    }
    searchPos = sIdx + 1;
  }

  if (validCharStart === null || validCharEnd === null) {
    return {
      isValid: false,
      issue: {
        code: 'TOKEN_BOUNDARY_VIOLATION',
        fieldPath,
        candidateValue: expectedValue,
        rawValue,
        snippet,
        isBlocking: isBlockingField,
      },
    };
  }

  const charStart = validCharStart;
  const charEnd = validCharEnd;
  const page = getPageForOffset(charStart, pageBreakOffsets);

  // 3. Decimal and currency equivalence check if numeric
  if (isNumeric) {
    const parsed = parseDecimal(rawValue);
    if (!parsed) {
      return {
        isValid: false,
        charStart,
        charEnd,
        page,
        issue: {
          code: 'PARSER_FAILURE',
          fieldPath,
          candidateValue: expectedValue,
          rawValue,
          snippet,
          isBlocking: isBlockingField,
        },
      };
    }

    if (parsed.value !== expectedValue) {
      return {
        isValid: false,
        charStart,
        charEnd,
        page,
        issue: {
          code: 'VALUE_MISMATCH',
          fieldPath,
          candidateValue: expectedValue,
          rawValue,
          snippet,
          isBlocking: isBlockingField,
        },
      };
    }

    if (expectedCurrency && parsed.currency && parsed.currency !== expectedCurrency) {
      return {
        isValid: false,
        charStart,
        charEnd,
        page,
        issue: {
          code: 'CURRENCY_MISMATCH',
          fieldPath,
          candidateValue: expectedCurrency,
          rawValue: parsed.currency,
          snippet,
          isBlocking: isBlockingField,
        },
      };
    }
  } else {
    // Exact string match for non-numeric fields
    if (rawValue.trim() !== expectedValue.trim()) {
      return {
        isValid: false,
        charStart,
        charEnd,
        page,
        issue: {
          code: 'VALUE_MISMATCH',
          fieldPath,
          candidateValue: expectedValue,
          rawValue,
          snippet,
          isBlocking: isBlockingField,
        },
      };
    }
  }

  return {
    isValid: true,
    charStart,
    charEnd,
    page,
    issue: null,
  };
}

