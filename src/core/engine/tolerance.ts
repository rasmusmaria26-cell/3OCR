import Decimal from 'decimal.js';

export const TOLERANCES = {
  // Max difference allowed for line totals and tax totals
  LINE_TOTAL: new Decimal('0.01'),
  TAX_TOTAL: new Decimal('0.01'),

  // Configurable placeholder tolerance for grand total comparison across documents.
  // Set to 1.00 as a placeholder to allow minor cross-currency or round-off differences.
  // Can be configured per customer or engine configuration.
  GRAND_TOTAL: new Decimal('1.00'),
};

/**
 * Configure the grand total tolerance placeholder.
 * Allows dynamically adjusting grand total tolerance (e.g. from config or environment).
 */
export function setGrandTotalTolerance(tolerance: string | number | Decimal): void {
  TOLERANCES.GRAND_TOTAL = tolerance instanceof Decimal ? tolerance : new Decimal(tolerance);
}

export function isWithinTolerance(
  valA: string | Decimal,
  valB: string | Decimal,
  tolerance: Decimal
): boolean {
  const decA = valA instanceof Decimal ? valA : new Decimal(valA);
  const decB = valB instanceof Decimal ? valB : new Decimal(valB);
  return decA.minus(decB).abs().lessThanOrEqualTo(tolerance);
}

