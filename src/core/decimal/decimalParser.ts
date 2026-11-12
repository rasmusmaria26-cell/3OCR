import Decimal from 'decimal.js';

export interface ParsedDecimal {
  value: string;
  currency: string | null;
}

const CURRENCY_MAP: Record<string, string> = {
  '₹': 'INR',
  'INR': 'INR',
  '$': 'USD',
  'USD': 'USD',
  '€': 'EUR',
  'EUR': 'EUR',
  '£': 'GBP',
  'GBP': 'GBP',
};

// Patterns for comma grouping
// en-US: 1,000 or 1,000,000
const US_GROUPING = /^\d{1,3}(,\d{3})+$/;
// en-IN: 1,000 or 12,500 or 5,00,000 or 1,10,000
const IN_GROUPING = /^\d{1,2}(,\d{2})*,\d{3}$/;

export function parseDecimal(input: string | null | undefined): ParsedDecimal | null {
  if (!input) return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  let isNegative = false;
  let currency: string | null = null;
  let numStr = trimmed;

  // Check currency prefix
  const prefixMatch = /^(?<neg1>-)?\s*(?<curr>₹|\$|€|£|INR|USD|EUR|GBP)\s*(?<neg2>-)?\s*(?<rest>.*)$/i.exec(numStr);
  if (prefixMatch && prefixMatch.groups) {
    currency = CURRENCY_MAP[prefixMatch.groups.curr.toUpperCase()] || prefixMatch.groups.curr.toUpperCase();
    if (prefixMatch.groups.neg1 || prefixMatch.groups.neg2) {
      isNegative = true;
    }
    numStr = prefixMatch.groups.rest;
  } else {
    // Check currency suffix
    const suffixMatch = /^(?<neg1>-)?\s*(?<rest>.*?)\s*(?<curr>₹|\$|€|£|INR|USD|EUR|GBP)\s*$/i.exec(numStr);
    if (suffixMatch && suffixMatch.groups) {
      currency = CURRENCY_MAP[suffixMatch.groups.curr.toUpperCase()] || suffixMatch.groups.curr.toUpperCase();
      if (suffixMatch.groups.neg1) {
        isNegative = true;
      }
      numStr = suffixMatch.groups.rest;
    } else {
      // No currency, check negative
      const negMatch = /^-\s*(.*)$/.exec(numStr);
      if (negMatch) {
        isNegative = true;
        numStr = negMatch[1];
      }
    }
  }

  // numStr must not have internal whitespace
  if (/\s/.test(numStr)) {
    return null;
  }

  // Split integer and decimal parts
  const dotParts = numStr.split('.');
  if (dotParts.length > 2) {
    return null; // multiple decimal points
  }

  const intPart = dotParts[0];
  const fracPart = dotParts.length === 2 ? dotParts[1] : null;

  // If fractional part exists, must be 1 to 4 digits
  if (fracPart !== null) {
    if (!/^\d{1,4}$/.test(fracPart)) {
      return null;
    }
  }

  // Integer part validation
  if (!intPart && fracPart !== null) {
    // e.g. .50 is allowed as 0.50
  } else if (!intPart) {
    return null;
  } else {
    // Check if integer part has commas
    if (intPart.includes(',')) {
      // Must match either US or Indian grouping
      const isUsValid = US_GROUPING.test(intPart);
      const isInValid = IN_GROUPING.test(intPart);
      if (!isUsValid && !isInValid) {
        return null;
      }
    } else {
      // Must be pure digits
      if (!/^\d+$/.test(intPart)) {
        return null;
      }
    }
  }

  // Clean commas
  const cleanedInt = intPart ? intPart.replace(/,/g, '') : '0';
  const cleanDecimalStr = (isNegative ? '-' : '') + cleanedInt + (fracPart !== null ? '.' + fracPart : '');

  try {
    const d = new Decimal(cleanDecimalStr);
    // If d is zero, do not output -0
    const finalVal = d.isZero() ? '0' : d.toFixed();
    // Re-attach precision if fracPart existed
    let formattedVal: string;
    if (fracPart !== null) {
      // Keep exact decimal string with user's fractional part
      formattedVal = (isNegative && !d.isZero() ? '-' : '') + cleanedInt + '.' + fracPart;
    } else {
      formattedVal = (isNegative && !d.isZero() ? '-' : '') + cleanedInt;
    }

    return {
      value: formattedVal,
      currency,
    };
  } catch {
    return null;
  }
}

