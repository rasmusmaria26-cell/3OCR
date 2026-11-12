import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from '../src/db/database.js';
import { normalizePoNumber, matchPoForCustomer } from '../src/core/normalizer/identifierNormalizer.js';
import { Database as DatabaseType } from 'better-sqlite3';

describe('Identifier Normalizer', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = createDatabase(':memory:');
    // Customer 1: separators_insignificant = 0
    db.prepare(`
      INSERT INTO customer_config (customer_id, default_currency, default_uom, separators_insignificant, config_version, created_at, updated_at)
      VALUES ('CUST-STRICT', 'USD', 'EA', 0, '1.0', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    // Customer 2: separators_insignificant = 1
    db.prepare(`
      INSERT INTO customer_config (customer_id, default_currency, default_uom, separators_insignificant, config_version, created_at, updated_at)
      VALUES ('CUST-FLEX', 'INR', 'PCS', 1, '1.0', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();
  });

  it('normalizes PO by uppercase and trim only', () => {
    expect(normalizePoNumber('  po-1001  ')).toBe('PO-1001');
    expect(normalizePoNumber('po_9999/ab ')).toBe('PO_9999/AB');
  });

  it('does NOT silently match PO-10-01 to PO1001 when separators are significant', () => {
    // Existing PO in system is PO-1001
    const match = matchPoForCustomer(db, 'CUST-STRICT', 'PO-1001', 'PO1001');
    expect(match.isMatch).toBe(false);
    expect(match.reason).toBe('SEPARATORS_SIGNIFICANT');
  });

  it('matches PO-1001 and PO1001 only when customer config allows separators_insignificant', () => {
    const match = matchPoForCustomer(db, 'CUST-FLEX', 'PO-1001', 'PO1001');
    expect(match.isMatch).toBe(true);
    expect(match.logged).toBe(true);
    expect(match.reason).toBe('SEPARATOR_INSENSITIVE_MATCH_PERMITTED');
  });
});

