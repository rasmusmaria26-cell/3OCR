import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from '../src/db/database.js';
import { resolveProductAlias, resolveDefaults } from '../src/core/normalizer/defaultResolver.js';
import { Database as DatabaseType } from 'better-sqlite3';

describe('Default & Alias Resolver (Fix 8)', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = createDatabase(':memory:');

    // Customer config
    db.prepare(`
      INSERT INTO customer_config (customer_id, default_currency, default_uom, separators_insignificant, config_version, created_at, updated_at)
      VALUES ('CUST-101', 'INR', 'EA', 0, 'v1.2', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')
    `).run();

    // Single alias mapping: "laptop standard" -> "LAP-001"
    db.prepare(`
      INSERT INTO product_aliases (id, customer_id, alias_text, normalized_sku, config_version, created_at)
      VALUES ('pa-1', 'CUST-101', 'laptop standard', 'LAP-001', 'v1.2', '2026-11-11T00:00:00Z')
    `).run();

    // Ambiguous alias mapping for CUST-AMB: "wireless mouse" maps to both "MOU-001" and "MOU-002"
    db.prepare(`
      INSERT INTO product_aliases (id, customer_id, alias_text, normalized_sku, config_version, created_at)
      VALUES 
        ('pa-2', 'CUST-AMB', 'wireless mouse', 'MOU-001', 'v1.0', '2026-11-11T00:00:00Z'),
        ('pa-3', 'CUST-AMB', 'wireless mouse', 'MOU-002', 'v1.0', '2026-11-11T00:00:00Z')
    `).run();
  });

  it('stores and matches aliases in lowercase and trimmed (Fix 8)', () => {
    // Lookup with mixed case and spaces
    const result = resolveProductAlias(db, 'CUST-101', '  Laptop STANDARD  ');
    expect(result.resolved).toBe(true);
    expect(result.sku).toBe('LAP-001');
    expect(result.origin).toBe('CUSTOMER_ALIAS');
    expect(result.configVersion).toBe('v1.2');
  });

  it('flags for review instead of picking one when one alias maps to two SKUs (Fix 8)', () => {
    const result = resolveProductAlias(db, 'CUST-AMB', 'Wireless Mouse');
    expect(result.resolved).toBe(false);
    expect(result.isAmbiguous).toBe(true);
    expect(result.flagReview).toBe(true);
    expect(result.candidateSkus).toEqual(['MOU-001', 'MOU-002']);
    expect(result.origin).toBe('UNKNOWN');
  });

  it('resolves currency and UOM defaults from customer config', () => {
    const defaults = resolveDefaults(db, 'CUST-101', {
      currency: null,
      uom: null,
    });

    expect(defaults.currency).toEqual({
      value: 'INR',
      origin: 'CUSTOMER_DEFAULT',
      configVersion: 'v1.2',
    });

    expect(defaults.uom).toEqual({
      value: 'EA',
      origin: 'CUSTOMER_DEFAULT',
      configVersion: 'v1.2',
    });
  });

  it('preserves document values if provided instead of applying customer defaults', () => {
    const defaults = resolveDefaults(db, 'CUST-101', {
      currency: 'USD',
      uom: 'PCS',
    });

    expect(defaults.currency).toEqual({
      value: 'USD',
      origin: 'DOCUMENT',
      configVersion: null,
    });

    expect(defaults.uom).toEqual({
      value: 'PCS',
      origin: 'DOCUMENT',
      configVersion: null,
    });
  });
});

