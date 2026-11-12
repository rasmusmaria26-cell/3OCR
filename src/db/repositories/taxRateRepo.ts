import { Database as DatabaseType } from 'better-sqlite3';

export type TaxType = 'CGST' | 'SGST' | 'IGST' | 'UTGST' | 'VAT' | 'SALES_TAX' | 'OTHER';

export interface TaxRateRecord {
  id: string;
  tax_type: TaxType;
  rate: string;
  description: string | null;
  created_at: string;
}

export interface TaxRateInput {
  id: string;
  taxType: TaxType;
  rate: string;
  description?: string | null;
  createdAt?: string;
}

export const taxRateRepo = {
  insert(db: DatabaseType, item: TaxRateInput) {
    const now = item.createdAt || new Date().toISOString();
    return db.prepare(`
      INSERT INTO tax_rates (id, tax_type, rate, description, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      item.id,
      item.taxType,
      item.rate,
      item.description || null,
      now
    );
  },

  findById(db: DatabaseType, id: string): TaxRateRecord | null {
    const row = db.prepare('SELECT * FROM tax_rates WHERE id = ?').get(id) as TaxRateRecord | undefined;
    return row || null;
  },

  findAll(db: DatabaseType): TaxRateRecord[] {
    return db.prepare('SELECT * FROM tax_rates ORDER BY tax_type ASC, rate ASC').all() as TaxRateRecord[];
  },

  findByType(db: DatabaseType, taxType: TaxType | string): TaxRateRecord[] {
    return db.prepare('SELECT * FROM tax_rates WHERE tax_type = ? ORDER BY rate ASC').all(taxType) as TaxRateRecord[];
  },
};

