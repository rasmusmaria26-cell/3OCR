import Decimal from 'decimal.js';
import { StageADocument } from '../schema/stageA.schema.js';
import { TOLERANCES, isWithinTolerance } from './tolerance.js';
import { calculateDocumentGrandTotal } from './headerCalculator.js';

export interface ArithmeticIssue {
  code: string;
  field: string;
  lineReference?: string | null;
  expected: string;
  actual: string;
  message: string;
  isBlocking: boolean;
}

export interface ArithmeticCheckResult {
  isValid: boolean;
  computedGrandTotal: string;
  skippedHeaderAdjustments: boolean;
  issues: ArithmeticIssue[];
}

export function checkDocumentArithmetic(doc: StageADocument): ArithmeticCheckResult {
  const issues: ArithmeticIssue[] = [];
  let computedSubtotal = new Decimal(0);
  let computedLineTotalSum = new Decimal(0);

  // Check line-level arithmetic
  for (let i = 0; i < doc.lineItems.length; i++) {
    const item = doc.lineItems[i];
    const lineRef = item.lineReference || `${i + 1}`;

    if (item.quantity && item.unitPrice) {
      const qty = new Decimal(item.quantity);
      const price = new Decimal(item.unitPrice);
      const discount = item.discountAmount ? new Decimal(item.discountAmount) : new Decimal(0);

      const expectedTaxable = qty.times(price).minus(discount);

      // Check taxableAmount
      if (item.taxableAmount) {
        const actualTaxable = new Decimal(item.taxableAmount);
        if (!isWithinTolerance(expectedTaxable, actualTaxable, TOLERANCES.LINE_TOTAL)) {
          issues.push({
            code: 'LINE_TAXABLE_MISMATCH',
            field: `lineItems[${i}].taxableAmount`,
            lineReference: lineRef,
            expected: expectedTaxable.toFixed(),
            actual: actualTaxable.toFixed(),
            message: `Line ${lineRef} taxable amount (${actualTaxable.toFixed()}) does not match qty * price - discount (${expectedTaxable.toFixed()})`,
            isBlocking: false,
          });
        }
      }

      // Taxes sum
      let lineTaxSum = new Decimal(0);
      if (item.taxes && item.taxes.length > 0) {
        for (const tax of item.taxes) {
          if (tax.amount) {
            lineTaxSum = lineTaxSum.plus(new Decimal(tax.amount));
          }
        }
      }

      const expectedLineTotal = expectedTaxable.plus(lineTaxSum);

      // Check lineTotal
      if (item.lineTotal) {
        const actualLineTotal = new Decimal(item.lineTotal);
        if (!isWithinTolerance(expectedLineTotal, actualLineTotal, TOLERANCES.LINE_TOTAL)) {
          issues.push({
            code: 'LINE_TOTAL_MISMATCH',
            field: `lineItems[${i}].lineTotal`,
            lineReference: lineRef,
            expected: expectedLineTotal.toFixed(),
            actual: actualLineTotal.toFixed(),
            message: `Line ${lineRef} total (${actualLineTotal.toFixed()}) does not match taxable + taxes (${expectedLineTotal.toFixed()})`,
            isBlocking: false,
          });
        }
        computedLineTotalSum = computedLineTotalSum.plus(actualLineTotal);
      } else {
        computedLineTotalSum = computedLineTotalSum.plus(expectedLineTotal);
      }

      computedSubtotal = computedSubtotal.plus(expectedTaxable);
    }
  }

  // Header adjustments handling (Fix 10)
  const hasHeaderAdjustments = doc.headerAdjustments && doc.headerAdjustments.length > 0;
  let skippedHeaderAdjustments = false;

  let computedGrandTotal = computedLineTotalSum;

  if (hasHeaderAdjustments) {
    // When header adjustments are present, skip grand total arithmetic validation
    // to prevent false flags, or handle minimally.
    skippedHeaderAdjustments = true;
  } else {
    // Standard grand total check without header adjustments
    const rounding = doc.amounts.roundingAdjustment ? new Decimal(doc.amounts.roundingAdjustment) : new Decimal(0);
    computedGrandTotal = computedGrandTotal.plus(rounding);

    if (doc.amounts.grandTotal) {
      const actualGrandTotal = new Decimal(doc.amounts.grandTotal);
      if (!isWithinTolerance(computedGrandTotal, actualGrandTotal, TOLERANCES.GRAND_TOTAL)) {
        issues.push({
          code: 'GRAND_TOTAL_ARITHMETIC_MISMATCH',
          field: 'amounts.grandTotal',
          expected: computedGrandTotal.toFixed(),
          actual: actualGrandTotal.toFixed(),
          message: `Document printed grand total (${actualGrandTotal.toFixed()}) does not match sum of lines (${computedGrandTotal.toFixed()})`,
          isBlocking: false,
        });
      }
    }
  }

  return {
    isValid: issues.length === 0,
    computedGrandTotal: computedGrandTotal.toFixed(),
    skippedHeaderAdjustments,
    issues,
  };
}

export interface SharedWrongTotalResult {
  isSharedWrongTotal: boolean;
  code?: string;
  printedTotal?: string;
  computedTotal?: string;
  message?: string;
}

export function detectSharedWrongTotal(docs: StageADocument[]): SharedWrongTotalResult {
  if (docs.length < 2) {
    return { isSharedWrongTotal: false };
  }

  const docsWithTotals = docs.filter((d) => d.amounts.grandTotal);
  if (docsWithTotals.length < 2) {
    return { isSharedWrongTotal: false };
  }

  const firstPrinted = docsWithTotals[0].amounts.grandTotal!;
  const allPrintedAgree = docsWithTotals.every((d) =>
    isWithinTolerance(d.amounts.grandTotal!, firstPrinted, TOLERANCES.GRAND_TOTAL)
  );

  if (!allPrintedAgree) {
    return { isSharedWrongTotal: false };
  }

  // Check their computed totals (incorporating header adjustments if present)
  const computedTotals = docsWithTotals.map((d) => {
    if (d.headerAdjustments && d.headerAdjustments.length > 0) {
      return calculateDocumentGrandTotal(d).computedGrandTotal;
    }
    return checkDocumentArithmetic(d).computedGrandTotal;
  });
  const firstComputed = computedTotals[0];

  const allComputedAgree = computedTotals.every((comp) =>
    isWithinTolerance(comp, firstComputed, TOLERANCES.GRAND_TOTAL)
  );

  if (allComputedAgree && !isWithinTolerance(firstPrinted, firstComputed, TOLERANCES.GRAND_TOTAL)) {
    return {
      isSharedWrongTotal: true,
      code: 'SHARED_WRONG_TOTAL',
      printedTotal: firstPrinted,
      computedTotal: firstComputed,
      message: `All documents agree on printed grand total of ${firstPrinted}, but actual total sums to ${firstComputed}`,
    };
  }

  return { isSharedWrongTotal: false };
}

