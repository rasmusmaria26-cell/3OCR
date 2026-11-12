import Decimal from 'decimal.js';
import { Evidence } from '../schema/stageA.schema.js';
import { parseDecimal } from '../decimal/decimalParser.js';
import { isValidNumberBoundary, isValidWordBoundary } from '../verification/evidenceVerifier.js';

export type VerificationBadge =
  | 'TOKEN_BOUNDARY_VERIFIED'
  | 'EXACT_SUBSTRING_VERIFIED'
  | 'DECIMAL_EQUIVALENT_VERIFIED'
  | 'UNVERIFIED';

export interface HighlightOptions {
  documentText: string;
  evidence: Evidence;
  candidateValue?: string | null;
  contextPadding?: number;
}

export interface HighlightResult {
  matchedSnippet: string;
  prefixContext: string;
  suffixContext: string;
  highlightedSnippetHtml: string;
  badges: VerificationBadge[];
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function getVerificationBadges(options: {
  documentText: string;
  evidence: Evidence;
  candidateValue?: string | null;
}): VerificationBadge[] {
  const { documentText, evidence, candidateValue } = options;
  const badges: VerificationBadge[] = [];

  if (!documentText || !evidence) {
    return ['UNVERIFIED'];
  }

  const raw = evidence.rawValue || '';
  const snippet = evidence.snippet || '';

  // Check EXACT_SUBSTRING_VERIFIED
  const hasExactSnippet = snippet.length > 0 && documentText.includes(snippet);
  const hasExactRaw = raw.length > 0 && documentText.includes(raw);

  if (hasExactSnippet || hasExactRaw) {
    badges.push('EXACT_SUBSTRING_VERIFIED');
  }

  // Check TOKEN_BOUNDARY_VERIFIED
  let boundaryValid = false;
  let matchStart = evidence.charStart ?? -1;
  let matchEnd = evidence.charEnd ?? -1;

  if (matchStart >= 0 && matchEnd > matchStart) {
    const isNum = !isNaN(Number(raw.replace(/[,$]/g, '')));
    boundaryValid = isNum
      ? isValidNumberBoundary(documentText, matchStart, matchEnd)
      : isValidWordBoundary(documentText, matchStart, matchEnd);
  } else {
    // Search for rawValue occurrence
    if (raw.length > 0) {
      let pos = 0;
      const isNum = !isNaN(Number(raw.replace(/[,$]/g, '')));
      while (pos < documentText.length) {
        const idx = documentText.indexOf(raw, pos);
        if (idx === -1) break;
        const end = idx + raw.length;
        if (isNum ? isValidNumberBoundary(documentText, idx, end) : isValidWordBoundary(documentText, idx, end)) {
          boundaryValid = true;
          break;
        }
        pos = idx + 1;
      }
    }
  }

  if (boundaryValid) {
    badges.push('TOKEN_BOUNDARY_VERIFIED');
  }

  // Check DECIMAL_EQUIVALENT_VERIFIED
  if (candidateValue && raw) {
    const candParsed = parseDecimal(candidateValue);
    const rawParsed = parseDecimal(raw);
    if (candParsed && rawParsed) {
      try {
        if (new Decimal(candParsed.value).equals(new Decimal(rawParsed.value))) {
          badges.push('DECIMAL_EQUIVALENT_VERIFIED');
        }
      } catch {
        // ignore parse error
      }
    }
  }

  if (badges.length === 0) {
    badges.push('UNVERIFIED');
  }

  return badges;
}

export function highlightEvidenceSnippet(options: HighlightOptions): HighlightResult {
  const { documentText, evidence, candidateValue, contextPadding = 40 } = options;
  const snippet = evidence.snippet || evidence.rawValue || '';

  let start = evidence.charStart ?? -1;
  let end = evidence.charEnd ?? -1;

  if (start < 0 || end <= start || documentText.substring(start, end) !== snippet) {
    // Find snippet in document text
    const idx = documentText.indexOf(snippet);
    if (idx !== -1) {
      start = idx;
      end = idx + snippet.length;
    } else {
      // Fallback to rawValue
      const rawIdx = documentText.indexOf(evidence.rawValue || '');
      if (rawIdx !== -1) {
        start = rawIdx;
        end = rawIdx + (evidence.rawValue || '').length;
      } else {
        start = 0;
        end = 0;
      }
    }
  }

  const prefixStart = Math.max(0, start - contextPadding);
  const prefixContext = documentText.substring(prefixStart, start);
  const matchedSnippet = start < end ? documentText.substring(start, end) : snippet;
  const suffixEnd = Math.min(documentText.length, end + contextPadding);
  const suffixContext = documentText.substring(end, suffixEnd);

  const prefixEllipsis = prefixStart > 0 ? '...' : '';
  const suffixEllipsis = suffixEnd < documentText.length ? '...' : '';

  const highlightedSnippetHtml = `${escapeHtml(prefixEllipsis)}${escapeHtml(prefixContext)}<mark class="bg-indigo-500/30 text-indigo-200 px-1 py-0.5 rounded font-bold border border-indigo-500/50">${escapeHtml(matchedSnippet)}</mark>${escapeHtml(suffixContext)}${escapeHtml(suffixEllipsis)}`;

  const badges = getVerificationBadges({ documentText, evidence, candidateValue });

  return {
    matchedSnippet,
    prefixContext,
    suffixContext,
    highlightedSnippetHtml,
    badges,
  };
}
