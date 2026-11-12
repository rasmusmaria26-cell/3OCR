import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from '../src/db/database.js';
import { Database as DatabaseType } from 'better-sqlite3';
import { detectDuplicates, computeSha256 } from '../src/core/linking/duplicateDetector.js';
import { documentRepo } from '../src/db/repositories/index.js';

describe('Duplicate Detection (duplicateDetector)', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = createDatabase(':memory:');
  });

  it('computes deterministic SHA-256 hashes for buffers and strings', () => {
    const hash1 = computeSha256(Buffer.from('hello world'));
    const hash2 = computeSha256('hello world');
    expect(hash1).toBe(hash2);
    expect(hash1).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('detects exact file_hash repeat for file uploads and flags DUPLICATE_FILE without overwriting', () => {
    const fileBuffer = Buffer.from('%PDF-1.4 sample invoice content');
    const fileHash = computeSha256(fileBuffer);

    // Initial document arrival
    documentRepo.insert(db, {
      id: 'doc-orig',
      sourceType: 'PDF',
      status: 'VALID',
      fileHash,
      receivedAt: '2026-11-11T10:00:00Z',
    });

    const result = detectDuplicates(db, {
      fileBuffer,
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.status).toBe('DUPLICATE_FILE');
    expect(result.duplicateOfId).toBe('doc-orig');
    expect(result.duplicateType).toBe('FILE_HASH');
    expect(result.computedFileHash).toBe(fileHash);
  });

  it('detects exact message_id repeat for emails and flags DUPLICATE_FILE', () => {
    const messageId = '<msg-12345@domain.com>';

    // Initial document arrival
    documentRepo.insert(db, {
      id: 'doc-email-orig',
      sourceType: 'EMAIL',
      status: 'VALID',
      messageId,
      receivedAt: '2026-11-11T10:00:00Z',
    });

    const result = detectDuplicates(db, {
      messageId,
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.status).toBe('DUPLICATE_FILE');
    expect(result.duplicateOfId).toBe('doc-email-orig');
    expect(result.duplicateType).toBe('MESSAGE_ID');
  });

  it('flags content_hash match as duplicate candidate flag when file hash/message id differs', () => {
    const rawText = 'Purchase Order PO-9988 for ACME Corp';
    const contentHash = computeSha256(rawText);

    // Initial document with contentHash
    documentRepo.insert(db, {
      id: 'doc-content-orig',
      sourceType: 'EMAIL',
      status: 'VALID',
      contentHash,
      messageId: '<msg-first@acme.com>',
      receivedAt: '2026-11-11T10:00:00Z',
    });

    // New document with different messageId but identical content text
    const result = detectDuplicates(db, {
      messageId: '<msg-second@acme.com>',
      rawText,
    });

    expect(result.isDuplicate).toBe(false); // Not hard duplicate_file because message_id is new
    expect(result.status).toBe('VALID');
    expect(result.isContentCandidate).toBe(true);
    expect(result.candidateOfId).toBe('doc-content-orig');
    expect(result.computedContentHash).toBe(contentHash);
  });

  it('returns valid non-duplicate result when no previous matches exist', () => {
    const fileBuffer = Buffer.from('brand new document buffer');
    const result = detectDuplicates(db, {
      fileBuffer,
      messageId: '<unique-msg-id@acme.com>',
      rawText: 'brand new document buffer',
    });

    expect(result.isDuplicate).toBe(false);
    expect(result.status).toBe('VALID');
    expect(result.duplicateOfId).toBeNull();
    expect(result.isContentCandidate).toBe(false);
    expect(result.candidateOfId).toBeNull();
  });
});
