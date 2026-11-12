import { Database as DatabaseType } from 'better-sqlite3';

export function normalizePoNumber(poNumber: string): string {
  if (!poNumber) return '';
  return poNumber.trim().toUpperCase();
}

export function stripSeparators(poNumber: string): string {
  return poNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export interface PoMatchResult {
  isMatch: boolean;
  logged: boolean;
  reason: string;
}

export function matchPoForCustomer(
  db: DatabaseType,
  customerId: string,
  poNumberA: string,
  poNumberB: string
): PoMatchResult {
  const normA = normalizePoNumber(poNumberA);
  const normB = normalizePoNumber(poNumberB);

  // Exact match
  if (normA === normB) {
    return {
      isMatch: true,
      logged: false,
      reason: 'EXACT_MATCH',
    };
  }

  // Check customer configuration
  const config = db.prepare('SELECT separators_insignificant FROM customer_config WHERE customer_id = ?')
    .get(customerId) as { separators_insignificant: number } | undefined;

  const separatorsInsignificant = config ? config.separators_insignificant === 1 : false;

  const strippedA = stripSeparators(normA);
  const strippedB = stripSeparators(normB);

  if (strippedA === strippedB) {
    if (separatorsInsignificant) {
      return {
        isMatch: true,
        logged: true,
        reason: 'SEPARATOR_INSENSITIVE_MATCH_PERMITTED',
      };
    } else {
      return {
        isMatch: false,
        logged: false,
        reason: 'SEPARATORS_SIGNIFICANT',
      };
    }
  }

  return {
    isMatch: false,
    logged: false,
    reason: 'NO_MATCH',
  };
}

