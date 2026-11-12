import { Database as DatabaseType } from 'better-sqlite3';

export interface CustomerSeedData {
  customerId: string;
  defaultCurrency: string;
  defaultUom: string;
  separatorsInsignificant: boolean;
  configVersion: string;
  aliases: Array<{ aliasText: string; normalizedSku: string }>;
}

export const SEED_CUSTOMERS: CustomerSeedData[] = [
  {
    customerId: 'CUST-001',
    defaultCurrency: 'USD',
    defaultUom: 'EA',
    separatorsInsignificant: false,
    configVersion: '1.0',
    aliases: [
      { aliasText: 'industrial widget', normalizedSku: 'SKU-001' },
    ],
  },
  {
    customerId: 'CUST-101',
    defaultCurrency: 'INR',
    defaultUom: 'EA',
    separatorsInsignificant: false,
    configVersion: '1.0',
    aliases: [
      { aliasText: 'laptop standard', normalizedSku: 'LAP-001' },
      { aliasText: 'optical mouse', normalizedSku: 'MOU-001' },
      { aliasText: 'wireless keyboard', normalizedSku: 'KEY-001' },
    ],
  },
  {
    customerId: 'CUST-FLEX',
    defaultCurrency: 'USD',
    defaultUom: 'PCS',
    separatorsInsignificant: true,
    configVersion: '1.0',
    aliases: [
      { aliasText: 'office chair', normalizedSku: 'CHR-100' },
    ],
  },
];

export function seedCustomerConfig(db: DatabaseType): void {
  const insertConfig = db.prepare(`
    INSERT OR IGNORE INTO customer_config (customer_id, default_currency, default_uom, separators_insignificant, config_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAlias = db.prepare(`
    INSERT OR IGNORE INTO product_aliases (id, customer_id, alias_text, normalized_sku, config_version, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertSenderMapping = db.prepare(`
    INSERT OR IGNORE INTO sender_mappings (id, sender_pattern, customer_id, is_domain, config_version, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();

  for (const cust of SEED_CUSTOMERS) {
    insertConfig.run(
      cust.customerId,
      cust.defaultCurrency,
      cust.defaultUom,
      cust.separatorsInsignificant ? 1 : 0,
      cust.configVersion,
      now,
      now
    );

    for (let i = 0; i < cust.aliases.length; i++) {
      const alias = cust.aliases[i];
      insertAlias.run(
        `alias-${cust.customerId}-${i + 1}`,
        cust.customerId,
        alias.aliasText.toLowerCase().trim(),
        alias.normalizedSku.trim().toUpperCase(),
        cust.configVersion,
        now
      );
    }
  }

  insertSenderMapping.run('sm-seed-1', '@acme.com', 'CUST-001', 1, '1.0', now);
  insertSenderMapping.run('sm-seed-2', 'orders@techcorp.com', 'CUST-101', 0, '1.0', now);
}

