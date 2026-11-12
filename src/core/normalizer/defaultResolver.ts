import { Database as DatabaseType } from 'better-sqlite3';

export type ResolutionOrigin = 'DOCUMENT' | 'CUSTOMER_DEFAULT' | 'CUSTOMER_ALIAS' | 'UNKNOWN';

export interface ResolvedField {
  value: string | null;
  origin: ResolutionOrigin;
  configVersion: string | null;
}

export interface AliasResolutionResult {
  resolved: boolean;
  sku?: string;
  origin: ResolutionOrigin;
  configVersion?: string | null;
  isAmbiguous?: boolean;
  flagReview?: boolean;
  candidateSkus?: string[];
}

export function normalizeAliasText(text: string): string {
  if (!text) return '';
  return text.trim().toLowerCase();
}

export function resolveProductAlias(
  db: DatabaseType,
  customerId: string,
  rawAlias: string
): AliasResolutionResult {
  const normalizedAlias = normalizeAliasText(rawAlias);
  if (!normalizedAlias || !customerId) {
    return { resolved: false, origin: 'UNKNOWN' };
  }

  const rows = db.prepare(`
    SELECT normalized_sku, config_version
    FROM product_aliases
    WHERE customer_id = ? AND alias_text = ?
  `).all(customerId, normalizedAlias) as Array<{ normalized_sku: string; config_version: string }>;

  if (rows.length === 0) {
    return { resolved: false, origin: 'UNKNOWN' };
  }

  // Check unique SKUs
  const uniqueSkus = Array.from(new Set(rows.map((r) => r.normalized_sku)));

  if (uniqueSkus.length > 1) {
    // Phase 1 Fix 8: If one alias maps to two SKUs, flag for review instead of picking one
    return {
      resolved: false,
      isAmbiguous: true,
      flagReview: true,
      candidateSkus: uniqueSkus,
      origin: 'UNKNOWN',
    };
  }

  return {
    resolved: true,
    sku: rows[0].normalized_sku,
    origin: 'CUSTOMER_ALIAS',
    configVersion: rows[0].config_version,
  };
}

export function resolveDefaults(
  db: DatabaseType,
  customerId: string,
  currentValues: {
    currency?: string | null;
    uom?: string | null;
  }
): {
  currency: ResolvedField;
  uom: ResolvedField;
} {
  const config = db.prepare(`
    SELECT default_currency, default_uom, config_version
    FROM customer_config
    WHERE customer_id = ?
  `).get(customerId) as { default_currency: string; default_uom: string; config_version: string } | undefined;

  // Currency
  let currencyField: ResolvedField;
  if (currentValues.currency) {
    currencyField = {
      value: currentValues.currency,
      origin: 'DOCUMENT',
      configVersion: null,
    };
  } else if (config && config.default_currency) {
    currencyField = {
      value: config.default_currency,
      origin: 'CUSTOMER_DEFAULT',
      configVersion: config.config_version,
    };
  } else {
    currencyField = {
      value: null,
      origin: 'UNKNOWN',
      configVersion: null,
    };
  }

  // UOM
  let uomField: ResolvedField;
  if (currentValues.uom) {
    uomField = {
      value: currentValues.uom,
      origin: 'DOCUMENT',
      configVersion: null,
    };
  } else if (config && config.default_uom) {
    uomField = {
      value: config.default_uom,
      origin: 'CUSTOMER_DEFAULT',
      configVersion: config.config_version,
    };
  } else {
    uomField = {
      value: null,
      origin: 'UNKNOWN',
      configVersion: null,
    };
  }

  return {
    currency: currencyField,
    uom: uomField,
  };
}

