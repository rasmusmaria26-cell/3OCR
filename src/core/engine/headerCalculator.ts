import Decimal from 'decimal.js';
import { StageADocument } from '../schema/stageA.schema.js';
import { TOLERANCES, isWithinTolerance } from './tolerance.js';
import { checkHeaderChargesAndTaxes, HeaderChargeIssue } from '../tax/freightTaxChecker.js';

export interface HeaderCalculationIssue {
  code: string;
  field: string;
  lineReference?: string | null;
  expected?: string;
  actual?: string;
  message: string;
  isBlocking: boolean;
}

export interface HeaderCalculationResult {
  isValid: boolean;
  computedLineTotalsSum: string;
  computedHeaderCharges: string;
  computedHeaderChargeTaxes: string;
  computedHeaderDiscounts: string;
  computedHeaderDiscountTaxes: string;
  roundingAdjustment: string;
  computedGrandTotal: string;
  issues: HeaderCalculationIssue[];
}

export function calculateDocumentGrandTotal(doc: StageADocument): HeaderCalculationResult {
  const issues: HeaderCalculationIssue[] = [];

  // 1. Sum line totals
  let sumLineTotals = new Decimal(0);
  for (let i = 0; i < (doc.lineItems || []).length; i++) {
    const item = doc.lineItems[i];
    if (item.lineTotal) {
      sumLineTotals = sumLineTotals.plus(new Decimal(item.lineTotal));
    } else {
      let taxable = new Decimal(0);
      if (item.taxableAmount) {
        taxable = new Decimal(item.taxableAmount);
      } else if (item.quantity && item.unitPrice) {
        const qty = new Decimal(item.quantity);
        const price = new Decimal(item.unitPrice);
        const discount = item.discountAmount ? new Decimal(item.discountAmount) : new Decimal(0);
        taxable = qty.times(price).minus(discount);
      }

      let lineTaxes = new Decimal(0);
      for (const t of item.taxes || []) {
        if (t.amount) {
          lineTaxes = lineTaxes.plus(new Decimal(t.amount));
        } else if (t.rate) {
          lineTaxes = lineTaxes.plus(taxable.times(new Decimal(t.rate).dividedBy(100)));
        }
      }
      sumLineTotals = sumLineTotals.plus(taxable.plus(lineTaxes));
    }
  }

  // 2. Header charges and discounts check
  const headerCheck = checkHeaderChargesAndTaxes(doc);
  for (const hIssue of headerCheck.issues) {
    issues.push(hIssue);
  }

  const charges = new Decimal(headerCheck.computedHeaderCharges);
  const chargeTaxes = new Decimal(headerCheck.computedHeaderChargeTaxes);
  const discounts = new Decimal(headerCheck.computedHeaderDiscounts);
  const discountTaxes = new Decimal(headerCheck.computedHeaderDiscountTaxes);

  const rounding = doc.amounts?.roundingAdjustment
    ? new Decimal(doc.amounts.roundingAdjustment)
    : new Decimal(0);

  // Full grand total arithmetic formula:
  // computedGrandTotal = sum(lineTotals) + sum(header charges) + sum(header charge taxes)
  //                      - sum(header discounts) - sum(header discount tax reductions) + roundingAdjustment
  const computedGrandTotal = sumLineTotals
    .plus(charges)
    .plus(chargeTaxes)
    .minus(discounts)
    .minus(discountTaxes)
    .plus(rounding);

  // Compare against printed grandTotal if present
  if (doc.amounts?.grandTotal !== null && doc.amounts?.grandTotal !== undefined && doc.amounts?.grandTotal !== '') {
    const actualGrandTotal = new Decimal(doc.amounts.grandTotal);
    if (!isWithinTolerance(computedGrandTotal, actualGrandTotal, TOLERANCES.GRAND_TOTAL)) {
      issues.push({
        code: 'GRAND_TOTAL_ARITHMETIC_MISMATCH',
        field: 'amounts.grandTotal',
        expected: computedGrandTotal.toFixed(2),
        actual: actualGrandTotal.toFixed(2),
        message: `Document printed grand total (${actualGrandTotal.toFixed(2)}) does not match computed total (${computedGrandTotal.toFixed(2)})`,
        isBlocking: false,
      });
    }
  }

  return {
    isValid: issues.length === 0,
    computedLineTotalsSum: sumLineTotals.toFixed(2),
    computedHeaderCharges: charges.toFixed(2),
    computedHeaderChargeTaxes: chargeTaxes.toFixed(2),
    computedHeaderDiscounts: discounts.toFixed(2),
    computedHeaderDiscountTaxes: discountTaxes.toFixed(2),
    roundingAdjustment: rounding.toFixed(2),
    computedGrandTotal: computedGrandTotal.toFixed(2),
    issues,
  };
}

