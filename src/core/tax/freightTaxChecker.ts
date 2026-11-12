import Decimal from 'decimal.js';
import { StageADocument } from '../schema/stageA.schema.js';
import { TOLERANCES, isWithinTolerance } from '../engine/tolerance.js';

export interface HeaderChargeIssue {
  code:
  | 'TAX_RATE_CALCULATION_MISMATCH'
  | 'FREIGHT_AMOUNT_MISMATCH'
  | 'DISCOUNT_TOTAL_MISMATCH'
  | 'TAX_TOTAL_MISMATCH'
  | 'INVALID_TAX_RATE';
  field: string;
  expected?: string;
  actual?: string;
  message: string;
  isBlocking: boolean;
}

export interface HeaderChargesCheckResult {
  isValid: boolean;
  computedFreight: string;
  computedFreightTax: string;
  computedHeaderCharges: string;
  computedHeaderChargeTaxes: string;
  computedHeaderDiscounts: string;
  computedHeaderDiscountTaxes: string;
  issues: HeaderChargeIssue[];
}

const TOLERANCE_001 = new Decimal('0.01');

export function checkHeaderChargesAndTaxes(doc: StageADocument): HeaderChargesCheckResult {
  const issues: HeaderChargeIssue[] = [];

  let computedFreight = new Decimal(0);
  let computedFreightTax = new Decimal(0);

  let computedHeaderCharges = new Decimal(0);
  let computedHeaderChargeTaxes = new Decimal(0);

  let computedHeaderDiscounts = new Decimal(0);
  let computedHeaderDiscountTaxes = new Decimal(0);

  const adjustments = doc.headerAdjustments || [];

  for (let i = 0; i < adjustments.length; i++) {
    const adj = adjustments[i];
    const amount = new Decimal(adj.amount || '0');
    const fieldPrefix = `headerAdjustments[${i}]`;

    if (adj.type === 'DISCOUNT') {
      computedHeaderDiscounts = computedHeaderDiscounts.plus(amount);

      // Check tax reduction on discount if specified
      if (adj.taxes && adj.taxes.length > 0) {
        for (let tIdx = 0; tIdx < adj.taxes.length; tIdx++) {
          const tax = adj.taxes[tIdx];
          if (tax.rate) {
            const rateDec = new Decimal(tax.rate);
            const expectedTax = amount.times(rateDec.dividedBy(100));
            if (tax.amount) {
              const statedTax = new Decimal(tax.amount);
              if (!isWithinTolerance(expectedTax, statedTax, TOLERANCE_001)) {
                issues.push({
                  code: 'TAX_RATE_CALCULATION_MISMATCH',
                  field: `${fieldPrefix}.taxes[${tIdx}].amount`,
                  expected: expectedTax.toFixed(2),
                  actual: statedTax.toFixed(2),
                  message: `Tax reduction on discount (${statedTax.toFixed(2)}) does not match computed tax ${expectedTax.toFixed(2)} (${amount.toFixed(2)} * ${rateDec.toFixed(2)}%)`,
                  isBlocking: false,
                });
              }
              computedHeaderDiscountTaxes = computedHeaderDiscountTaxes.plus(statedTax);
            } else {
              computedHeaderDiscountTaxes = computedHeaderDiscountTaxes.plus(expectedTax);
            }
          } else if (tax.amount) {
            computedHeaderDiscountTaxes = computedHeaderDiscountTaxes.plus(new Decimal(tax.amount));
          }
        }
      }
    } else {
      // FREIGHT, PACKING, OTHER
      computedHeaderCharges = computedHeaderCharges.plus(amount);
      if (adj.type === 'FREIGHT') {
        computedFreight = computedFreight.plus(amount);
      }

      if (adj.taxes && adj.taxes.length > 0) {
        for (let tIdx = 0; tIdx < adj.taxes.length; tIdx++) {
          const tax = adj.taxes[tIdx];
          if (tax.rate) {
            const rateDec = new Decimal(tax.rate);
            const expectedTax = amount.times(rateDec.dividedBy(100));
            if (tax.amount) {
              const statedTax = new Decimal(tax.amount);
              if (!isWithinTolerance(expectedTax, statedTax, TOLERANCE_001)) {
                issues.push({
                  code: 'TAX_RATE_CALCULATION_MISMATCH',
                  field: `${fieldPrefix}.taxes[${tIdx}].amount`,
                  expected: expectedTax.toFixed(2),
                  actual: statedTax.toFixed(2),
                  message: `Tax on ${adj.type} (${statedTax.toFixed(2)}) does not match computed tax ${expectedTax.toFixed(2)} (${amount.toFixed(2)} * ${rateDec.toFixed(2)}%)`,
                  isBlocking: false,
                });
              }
              computedHeaderChargeTaxes = computedHeaderChargeTaxes.plus(statedTax);
              if (adj.type === 'FREIGHT') {
                computedFreightTax = computedFreightTax.plus(statedTax);
              }
            } else {
              computedHeaderChargeTaxes = computedHeaderChargeTaxes.plus(expectedTax);
              if (adj.type === 'FREIGHT') {
                computedFreightTax = computedFreightTax.plus(expectedTax);
              }
            }
          } else if (tax.amount) {
            const statedTax = new Decimal(tax.amount);
            computedHeaderChargeTaxes = computedHeaderChargeTaxes.plus(statedTax);
            if (adj.type === 'FREIGHT') {
              computedFreightTax = computedFreightTax.plus(statedTax);
            }
          }
        }
      }
    }
  }

  // Cross-check: printed freight vs extracted FREIGHT adjustment amount
  if (doc.amounts.freight !== null && doc.amounts.freight !== undefined && doc.amounts.freight !== '') {
    const printedFreight = new Decimal(doc.amounts.freight);
    if (!isWithinTolerance(printedFreight, computedFreight, TOLERANCE_001)) {
      issues.push({
        code: 'FREIGHT_AMOUNT_MISMATCH',
        field: 'amounts.freight',
        expected: computedFreight.toFixed(2),
        actual: printedFreight.toFixed(2),
        message: `Printed freight (${printedFreight.toFixed(2)}) does not match extracted freight header adjustment (${computedFreight.toFixed(2)})`,
        isBlocking: false,
      });
    }
  }

  // Cross-check: printed discountTotal vs sum of line discounts + header discounts
  if (doc.amounts.discountTotal !== null && doc.amounts.discountTotal !== undefined && doc.amounts.discountTotal !== '') {
    let sumLineDiscounts = new Decimal(0);
    for (const item of doc.lineItems || []) {
      if (item.discountAmount) {
        sumLineDiscounts = sumLineDiscounts.plus(new Decimal(item.discountAmount));
      }
    }
    const totalExpectedDiscount = sumLineDiscounts.plus(computedHeaderDiscounts);
    const printedDiscount = new Decimal(doc.amounts.discountTotal);

    if (!isWithinTolerance(printedDiscount, totalExpectedDiscount, TOLERANCE_001)) {
      issues.push({
        code: 'DISCOUNT_TOTAL_MISMATCH',
        field: 'amounts.discountTotal',
        expected: totalExpectedDiscount.toFixed(2),
        actual: printedDiscount.toFixed(2),
        message: `Printed discount total (${printedDiscount.toFixed(2)}) does not match sum of line and header discounts (${totalExpectedDiscount.toFixed(2)})`,
        isBlocking: false,
      });
    }
  }

  // Cross-check: printed taxTotal vs sum of line taxes + header adjustment taxes
  if (doc.amounts.taxTotal !== null && doc.amounts.taxTotal !== undefined && doc.amounts.taxTotal !== '') {
    let sumLineTaxes = new Decimal(0);
    for (const item of doc.lineItems || []) {
      if (item.taxes && item.taxes.length > 0) {
        for (const tax of item.taxes) {
          if (tax.amount) {
            sumLineTaxes = sumLineTaxes.plus(new Decimal(tax.amount));
          }
        }
      }
    }

    const netAdjustmentTaxes = computedHeaderChargeTaxes.minus(computedHeaderDiscountTaxes);
    const totalExpectedTax = sumLineTaxes.plus(netAdjustmentTaxes);
    const printedTax = new Decimal(doc.amounts.taxTotal);

    if (!isWithinTolerance(printedTax, totalExpectedTax, TOLERANCE_001)) {
      issues.push({
        code: 'TAX_TOTAL_MISMATCH',
        field: 'amounts.taxTotal',
        expected: totalExpectedTax.toFixed(2),
        actual: printedTax.toFixed(2),
        message: `Printed tax total (${printedTax.toFixed(2)}) does not match sum of line and header taxes (${totalExpectedTax.toFixed(2)})`,
        isBlocking: false,
      });
    }
  }

  return {
    isValid: issues.length === 0,
    computedFreight: computedFreight.toFixed(2),
    computedFreightTax: computedFreightTax.toFixed(2),
    computedHeaderCharges: computedHeaderCharges.toFixed(2),
    computedHeaderChargeTaxes: computedHeaderChargeTaxes.toFixed(2),
    computedHeaderDiscounts: computedHeaderDiscounts.toFixed(2),
    computedHeaderDiscountTaxes: computedHeaderDiscountTaxes.toFixed(2),
    issues,
  };
}
