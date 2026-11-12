export interface QuoteStripMetadata {
  rawChars: number;
  cleanedChars: number;
  charsRemoved: number;
  ratio: number;
  largeChunkRemoved: boolean;
}

export interface QuoteStripResult {
  cleanedText: string;
  metadata: QuoteStripMetadata;
}

// Patterns that mark the beginning of quoted, forwarded, or history blocks
const FORWARDED_PATTERNS = [
  /^-{3,}\s*Forwarded message\s*-{3,}/im,
  /^_{3,}/m,
  /^On\s+.+?wrote:\s*$/im,
  /^From:\s*.+?\nSent:\s*.+?\nTo:\s*.+?/im,
];

export function stripEmailQuotes(rawText: string): QuoteStripResult {
  if (!rawText) {
    return {
      cleanedText: '',
      metadata: {
        rawChars: 0,
        cleanedChars: 0,
        charsRemoved: 0,
        ratio: 0,
        largeChunkRemoved: false,
      },
    };
  }

  const rawChars = rawText.length;
  const lines = rawText.split('\n');
  const cleanedLines: string[] = [];

  let inQuoteBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if line starts a quote / forward section
    const isForwardHeader = FORWARDED_PATTERNS.some((pattern) => pattern.test(line));
    if (isForwardHeader) {
      inQuoteBlock = true;
      break; // Everything following the forward header is quote history
    }

    // Check classic email quote prefix '>'
    if (/^\s*>/.test(line)) {
      continue; // Skip individual quoted lines
    }

    // Check 'On ... wrote:' inline line
    if (/^On\s+.+?wrote:\s*$/i.test(line.trim())) {
      inQuoteBlock = true;
      break;
    }

    cleanedLines.push(line);
  }

  const cleanedText = cleanedLines.join('\n').trimEnd();
  const cleanedChars = cleanedText.length;
  const charsRemoved = Math.max(0, rawChars - cleanedChars);
  const ratio = rawChars > 0 ? charsRemoved / rawChars : 0;

  // Large chunk removed if > 200 chars removed or ratio >= 0.40
  const largeChunkRemoved = charsRemoved > 200 || ratio >= 0.4;

  return {
    cleanedText,
    metadata: {
      rawChars,
      cleanedChars,
      charsRemoved,
      ratio: Math.round(ratio * 1000) / 1000,
      largeChunkRemoved,
    },
  };
}

