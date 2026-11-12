import Decimal from 'decimal.js';
import { Database as DatabaseType } from 'better-sqlite3';
import { LineItem, StageADocument, TaxDetail } from '../schema/stageA.schema.js';
import { taxRateRepo } from '../../db/repositories/taxRateRepo.js';

export interface GstTaxIssue {
  code: 'TAX_RATE_CALCULATION_MISMATCH' | 'INVALID_TAX_RATE' | 'GST_SPLIT_MISMATCH' | 'INVALID_TAX_COMBINATION';
  field: string;
  lineReference?: string | null;
  expected?: string;
  actual?: string;
  message: string;
  isBlocking: boolean;
}

export interface GstValidationResult {
  isValid: boolean;
  issues: GstTaxIssue[];
}

export const STANDARD_GST_RATES = new Set([
  '0', '0.0', '0.00',
  '0.1', '0.10',
  '0.25',
  '1.5', '1.50',
  '2.5', '2.50',
  '3', '3.0', '3.00',
  '5', '5.0', '5.00',
  '6', '6.0', '6.00',
  '9', '9.0', '9.00',
  '12', '12.0', '12.00',
  '14', '14.0', '14.00',
  '18', '18.0', '18.00',
  '28', '28.0', '28.00',
]);

const GST_TOLERANCE = new Decimal('0.01');

export interface GstValidationOptions {
  db?: DatabaseType;
  configuredRates?: Set<string>;
}

function getValidRates(options?: GstValidationOptions): Set<string> {
  if (options?.configuredRates) {
    return options.configuredRates;
  }
  const rates = new Set<string>(STANDARD_GST_RATES);
  if (options?.db) {
    try {
      const dbRates = taxRateRepo.findAll(options.db);
      for (const r of dbRates) {
        rates.add(new Decimal(r.rate).toFixed(2));
        rates.add(new Decimal(r.rate).toFixed());
      }
    } catch {
      // fallback to standard rates
    }
  }
  return rates;
}

export function validateGstTaxes(
  taxableAmountStr: string,
  taxes: TaxDetail[],
  fieldPrefix: string = 'lineItems[0]',
  lineRef?: string | null,
  options?: GstValidationOptions
): GstValidationResult {
  const issues: GstTaxIssue[] = [];
  if (!taxes || taxes.length === 0) {
    return { isValid: true, issues: [] };
  }

  const validRates = getValidRates(options);
  const taxable = new Decimal(taxableAmountStr || '0');

  let hasIgst = false;
  let hasCgst = false;
  let hasSgst = false;
  let cgstRate: Decimal | null = null;
  let sgstRate: Decimal | null = null;
  let cgstAmount: Decimal | null = null;
  let sgstAmount: Decimal | null = null;

  for (let idx = 0; idx < taxes.length; idx++) {
    const tax = taxes[idx];
    const taxType = (tax.type || '').toUpperCase().trim();
    const rateStr = tax.rate;
    const statedAmountStr = tax.amount;
    const taxField = `${fieldPrefix}.taxes[${idx}]`;

    if (!rateStr) continue;

    const rateDec = new Decimal(rateStr);
    const normalizedRateKey = rateDec.toFixed(2);
    const plainRateKey = rateDec.toFixed();

    // Validate rate in configured tax rates
    const isValidRate = validRates.has(normalizedRateKey) || validRates.has(plainRateKey);
    if (!isValidRate) {
      issues.push({
        code: 'INVALID_TAX_RATE',
        field: `${taxField}.rate`,
        lineReference: lineRef,
        expected: 'Configured GST Rate (0, 5, 12, 18, 28% or equal CGST/SGST splits)',
        actual: rateStr,
        message: `Tax rate of ${rateStr}% is not recognized as a valid configured tax rate`,
        isBlocking: false,
      });
    }

    // Validate tax math: expectedTax = taxableAmount * (rate / 100)
    const expectedTax = taxable.times(rateDec.dividedBy(100));
    if (statedAmountStr) {
      const statedTax = new Decimal(statedAmountStr);
      const diff = statedTax.minus(expectedTax).abs();

      if (diff.greaterThan(GST_TOLERANCE)) {
        issues.push({
          code: 'TAX_RATE_CALCULATION_MISMATCH',
          field: `${taxField}.amount`,
          lineReference: lineRef,
          expected: expectedTax.toFixed(2),
          actual: statedTax.toFixed(2),
          message: `Stated tax amount ${statedTax.toFixed(2)} does not match computed tax ${expectedTax.toFixed(2)} (${taxable.toFixed(2)} * ${rateDec.toFixed(2)}%)`,
          isBlocking: false,
        });
      }
    }

    if (taxType === 'IGST') {
      hasIgst = true;
    } else if (taxType === 'CGST') {
      hasCgst = true;
      cgstRate = rateDec;
      if (statedAmountStr) cgstAmount = new Decimal(statedAmountStr);
    } else if (taxType === 'SGST' || taxType === 'UTGST') {
      hasSgst = true;
      sgstRate = rateDec;
      if (statedAmountStr) sgstAmount = new Decimal(statedAmountStr);
    }
  }

  // Cross-check tax types combinations
  if (hasIgst && (hasCgst || hasSgst)) {
    issues.push({
      code: 'INVALID_TAX_COMBINATION',
      field: `${fieldPrefix}.taxes`,
      lineReference: lineRef,
      message: 'Both interstate (IGST) and intrastate (CGST/SGST) taxes cannot be applied to the same item',
      isBlocking: false,
    });
  }

  // If intrastate (CGST and SGST), ensure rates are equal splits
  if (hasCgst && hasSgst && cgstRate && sgstRate) {
    if (!cgstRate.equals(sgstRate)) {
      issues.push({
        code: 'GST_SPLIT_MISMATCH',
        field: `${fieldPrefix}.taxes`,
        lineReference: lineRef,
        expected: `Equal CGST/SGST rates (CGST: ${cgstRate.toFixed()}%, SGST: ${sgstRate.toFixed()}%)`,
        actual: `CGST=${cgstRate.toFixed()}%, SGST=${sgstRate.toFixed()}%`,
        message: `Intrastate GST requires equal split between CGST and SGST, but got CGST ${cgstRate.toFixed()}% and SGST ${sgstRate.toFixed()}%`,
        isBlocking: false,
      });
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}

export function validateGstLineItem(
  line: LineItem,
  lineIndex: number = 0,
  options?: GstValidationOptions
): GstValidationResult {
  const lineRef = line.lineReference || `${lineIndex + 1}`;
  const fieldPrefix = `lineItems[${lineIndex}]`;
  const taxable = line.taxableAmount || (line.quantity && line.unitPrice
    ? new Decimal(line.quantity).times(new Decimal(line.unitPrice)).minus(new Decimal(line.discountAmount || '0')).toFixed()
    : '0');

  return validateGstTaxes(taxable, line.taxes || [], fieldPrefix, lineRef, options);
}

export function validateDocumentGst(
  doc: StageADocument,
  options?: GstValidationOptions
): GstValidationResult {
  const allIssues: GstTaxIssue[] = [];

  // Check each line item
  for (let i = 0; i < doc.lineItems.length; i++) {
    const line = doc.lineItems[i];
    const res = validateGstLineItem(line, i, options);
    if (!res.isValid) {
      allIssues.push(...res.issues);
    }
  }

  return {
    isValid: allIssues.length === 0,
    issues: allIssues,
  };
}

