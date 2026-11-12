import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const db = new Database('reconciliation.db');

// List triggers
const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all() as any[];
console.log(`Found ${triggers.length} triggers. Dropping triggers temporarily for clean reset...`);
for (const t of triggers) {
  db.exec(`DROP TRIGGER IF EXISTS "${t.name}"`);
}

const deleteTables = [
  'reconciliation_results',
  'reconciliation_runs',
  'review_decisions',
  'header_adjustments',
  'line_items',
  'extraction_issues',
  'extracted_fields',
  'extracted_text',
  'audit_logs',
  'queues',
  'documents',
  'processing_cases'
];

db.pragma('foreign_keys = OFF');

db.transaction(() => {
  for (const table of deleteTables) {
    try {
      const info = db.prepare(`DELETE FROM ${table}`).run();
      console.log(`Deleted ${info.changes} rows from ${table}`);
    } catch (err: any) {
      console.warn(`Could not clear table ${table}:`, err.message);
    }
  }
})();

db.pragma('foreign_keys = ON');

// Re-apply schema.sql to restore all triggers, indexes, and tables
const schemaPath = path.resolve(process.cwd(), 'src', 'db', 'schema.sql');
const schemaSql = fs.readFileSync(schemaPath, 'utf8');
db.exec(schemaSql);

// Re-seed default customer configs, aliases, tax rates
import { seedCustomerConfig } from '../src/config/customerConfig.js';
seedCustomerConfig(db);

db.exec('VACUUM');

console.log('Database cleanly reset with all triggers, configurations, and zero test cases!');
