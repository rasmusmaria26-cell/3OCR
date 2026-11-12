import Decimal from 'decimal.js';

export interface LineForMatch {
  sku: string;
  qty: string;
  unitPrice?: string | null;
  uom?: string | null;
  discountAmount?: string | null;
  taxes?: Array<{ type?: string | null; rate?: string | null; amount?: string | null }>;
  lineReference?: string | null;
  description?: string | null;
}

export interface AggregatedLine {
  sku: string;
  totalQty: string;
  unitPrice?: string | null;
  uom?: string | null;
  originalLines: LineForMatch[];
}

export interface MatchedPair {
  sku: string;
  lineA: LineForMatch;
  lineB: LineForMatch;
  aggregatedA?: AggregatedLine;
  aggregatedB?: AggregatedLine;
}

export interface MatchReviewIssue {
  code: string;
  sku: string;
  message: string;
  isBlocking: boolean;
}

export interface LineMatchResult {
  matchedPairs: MatchedPair[];
  unmatchedA: LineForMatch[];
  unmatchedB: LineForMatch[];
  reviewIssues: MatchReviewIssue[];
}

interface GroupedLines {
  validGroups: Map<string, AggregatedLine>;
  issues: MatchReviewIssue[];
}

function groupLinesBySku(lines: LineForMatch[], docLabel: string): GroupedLines {
  const map = new Map<string, LineForMatch[]>();
  for (const line of lines) {
    const sku = line.sku.trim().toUpperCase();
    if (!map.has(sku)) {
      map.set(sku, []);
    }
    map.get(sku)!.push(line);
  }

  const validGroups = new Map<string, AggregatedLine>();
  const issues: MatchReviewIssue[] = [];

  for (const [sku, skuLines] of map.entries()) {
    if (skuLines.length === 1) {
      validGroups.set(sku, {
        sku,
        totalQty: skuLines[0].qty,
        unitPrice: skuLines[0].unitPrice,
        uom: skuLines[0].uom,
        originalLines: skuLines,
      });
      continue;
    }

    // Multiple lines for same SKU: check compatibility
    const basePrice = skuLines[0].unitPrice || null;
    const baseUom = skuLines[0].uom || null;
    let isCompatible = true;

    for (let i = 1; i < skuLines.length; i++) {
      if ((skuLines[i].unitPrice || null) !== basePrice) {
        isCompatible = false;
        break;
      }
      if ((skuLines[i].uom || null) !== baseUom) {
        isCompatible = false;
        break;
      }
    }

    if (!isCompatible) {
      issues.push({
        code: 'DUPLICATE_SKU_INCOMPATIBLE',
        sku,
        message: `Duplicate line items for SKU ${sku} in ${docLabel} have conflicting prices or UOMs. Review required.`,
        isBlocking: true,
      });
    } else {
      // Sum quantities using Decimal
      let total = new Decimal(0);
      for (const line of skuLines) {
        total = total.plus(new Decimal(line.qty));
      }
      validGroups.set(sku, {
        sku,
        totalQty: total.toFixed(),
        unitPrice: basePrice,
        uom: baseUom,
        originalLines: skuLines,
      });
    }
  }

  return { validGroups, issues };
}

export function matchDocumentLines(
  docALines: LineForMatch[],
  docBLines: LineForMatch[]
): LineMatchResult {
  const groupA = groupLinesBySku(docALines, 'Doc A');
  const groupB = groupLinesBySku(docBLines, 'Doc B');

  const matchedPairs: MatchedPair[] = [];
  const unmatchedA: LineForMatch[] = [];
  const unmatchedB: LineForMatch[] = [];
  const reviewIssues: MatchReviewIssue[] = [...groupA.issues, ...groupB.issues];

  const processedSkusB = new Set<string>();

  for (const [sku, aggA] of groupA.validGroups.entries()) {
    if (groupB.validGroups.has(sku)) {
      const aggB = groupB.validGroups.get(sku)!;
      matchedPairs.push({
        sku,
        lineA: {
          sku,
          qty: aggA.totalQty,
          unitPrice: aggA.unitPrice,
          uom: aggA.uom,
          lineReference: aggA.originalLines[0].lineReference,
        },
        lineB: {
          sku,
          qty: aggB.totalQty,
          unitPrice: aggB.unitPrice,
          uom: aggB.uom,
          lineReference: aggB.originalLines[0].lineReference,
        },
        aggregatedA: aggA.originalLines.length > 1 ? aggA : undefined,
        aggregatedB: aggB.originalLines.length > 1 ? aggB : undefined,
      });
      processedSkusB.add(sku);
    } else {
      unmatchedA.push(...aggA.originalLines);
    }
  }

  for (const [sku, aggB] of groupB.validGroups.entries()) {
    if (!processedSkusB.has(sku)) {
      unmatchedB.push(...aggB.originalLines);
    }
  }

  return {
    matchedPairs,
    unmatchedA,
    unmatchedB,
    reviewIssues,
  };
}

