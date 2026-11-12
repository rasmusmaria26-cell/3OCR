import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function createDatabase(dbPath: string = ':memory:'): DatabaseType {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  // Load and execute schema
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);

  // Apply migrations for existing tables if needed
  try {
    const docCols = db.prepare('PRAGMA table_info(documents)').all().map((c: any) => c.name);
    if (docCols.length > 0) {
      if (!docCols.includes('spf_status')) db.exec('ALTER TABLE documents ADD COLUMN spf_status TEXT');
      if (!docCols.includes('dkim_status')) db.exec('ALTER TABLE documents ADD COLUMN dkim_status TEXT');
      if (!docCols.includes('version_number')) db.exec('ALTER TABLE documents ADD COLUMN version_number INTEGER NOT NULL DEFAULT 1');
      if (!docCols.includes('is_current_version')) db.exec('ALTER TABLE documents ADD COLUMN is_current_version INTEGER NOT NULL DEFAULT 1');
      if (!docCols.includes('duplicate_of_id')) db.exec('ALTER TABLE documents ADD COLUMN duplicate_of_id TEXT');
    }
  } catch {
    // Ignore migration errors on in-memory or already up-to-date databases
  }

  return db;
}

