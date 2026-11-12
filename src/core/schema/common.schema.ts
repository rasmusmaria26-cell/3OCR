import { z } from 'zod';

// Helper to transform empty strings or whitespace to null
export const nullableTrimmedString = z
  .string()
  .nullish()
  .transform((val) => {
    if (!val) return null;
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

// Decimal string with max 4 decimal places
// Supports optional negative sign for adjustments
export const decimalString = z
  .string()
  .nullish()
  .refine(
    (val) => {
      if (val === null || val === undefined) return true;
      return /^-?\d+(\.\d{1,4})?$/.test(val);
    },
    { message: 'Must be a valid decimal string with at most 4 decimal places' }
  );

// Positive decimal string (e.g. for quantity, price, line totals)
export const positiveDecimalString = z
  .string()
  .nullish()
  .refine(
    (val) => {
      if (val === null || val === undefined) return true;
      if (!/^\d+(\.\d{1,4})?$/.test(val)) return false;
      const num = parseFloat(val);
      return num > 0;
    },
    { message: 'Must be a positive decimal string with at most 4 decimal places' }
  );

