import { Database as DatabaseType } from 'better-sqlite3';

export interface SenderMappingRecord {
  id: string;
  sender_pattern: string;
  customer_id: string;
  is_domain: number;
  config_version: string;
  created_at: string;
}

export interface SenderMappingInput {
  id: string;
  senderPattern: string;
  customerId: string;
  isDomain?: boolean | number;
  configVersion?: string;
  createdAt?: string;
}

export const senderMappingRepo = {
  insert(db: DatabaseType, mapping: SenderMappingInput) {
    const now = mapping.createdAt || new Date().toISOString();
    const isDomain = mapping.isDomain ? 1 : 0;
    const configVersion = mapping.configVersion || '1.0';
    const pattern = mapping.senderPattern.trim().toLowerCase();

    return db.prepare(`
      INSERT INTO sender_mappings (id, sender_pattern, customer_id, is_domain, config_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(mapping.id, pattern, mapping.customerId, isDomain, configVersion, now);
  },

  findById(db: DatabaseType, id: string): SenderMappingRecord | null {
    const row = db.prepare('SELECT * FROM sender_mappings WHERE id = ?').get(id) as SenderMappingRecord | undefined;
    return row || null;
  },

  findBySenderPattern(db: DatabaseType, pattern: string): SenderMappingRecord | null {
    const normalized = pattern.trim().toLowerCase();
    const row = db.prepare('SELECT * FROM sender_mappings WHERE lower(sender_pattern) = ?').get(normalized) as SenderMappingRecord | undefined;
    return row || null;
  },

  findMatch(db: DatabaseType, email: string): { id: string; customerId: string; isDomain: number; pattern: string } | null {
    if (!email) return null;
    const normalizedEmail = email.trim().toLowerCase();

    // 1. Exact match first (where is_domain = 0)
    const exact = db.prepare(`
      SELECT id, sender_pattern, customer_id, is_domain
      FROM sender_mappings
      WHERE is_domain = 0 AND lower(sender_pattern) = ?
    `).get(normalizedEmail) as SenderMappingRecord | undefined;

    if (exact) {
      return {
        id: exact.id,
        customerId: exact.customer_id,
        isDomain: exact.is_domain,
        pattern: exact.sender_pattern,
      };
    }

    // 2. Domain fallback (e.g. "@acme.com" or "acme.com")
    const atIndex = normalizedEmail.lastIndexOf('@');
    if (atIndex !== -1) {
      const domainWithAt = normalizedEmail.slice(atIndex); // e.g. "@acme.com"
      const domainWithoutAt = normalizedEmail.slice(atIndex + 1); // e.g. "acme.com"

      const domainMatch = db.prepare(`
        SELECT id, sender_pattern, customer_id, is_domain
        FROM sender_mappings
        WHERE is_domain = 1 AND (lower(sender_pattern) = ? OR lower(sender_pattern) = ?)
      `).get(domainWithAt, domainWithoutAt) as SenderMappingRecord | undefined;

      if (domainMatch) {
        return {
          id: domainMatch.id,
          customerId: domainMatch.customer_id,
          isDomain: domainMatch.is_domain,
          pattern: domainMatch.sender_pattern,
        };
      }
    }

    return null;
  },

  findAll(db: DatabaseType): SenderMappingRecord[] {
    return db.prepare('SELECT * FROM sender_mappings ORDER BY created_at DESC').all() as SenderMappingRecord[];
  },

  delete(db: DatabaseType, id: string) {
    return db.prepare('DELETE FROM sender_mappings WHERE id = ?').run(id);
  },
};
