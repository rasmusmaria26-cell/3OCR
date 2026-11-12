import crypto from 'node:crypto';
import { Database as DatabaseType } from 'better-sqlite3';
import { documentRepo } from '../../db/repositories/index.js';

export interface DuplicateCheckInput {
  fileBuffer?: Buffer | null;
  fileHash?: string | null;
  messageId?: string | null;
  rawText?: string | null;
  contentHash?: string | null;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  duplicateType: 'FILE_HASH' | 'MESSAGE_ID' | null;
  status: 'DUPLICATE_FILE' | 'VALID';
  duplicateOfId: string | null;
  isContentCandidate: boolean;
  candidateOfId: string | null;
  computedFileHash: string | null;
  computedContentHash: string | null;
}

export function computeSha256(data: Buffer | string): string {
  const hash = crypto.createHash('sha256');
  if (typeof data === 'string') {
    hash.update(data, 'utf8');
  } else {
    hash.update(data);
  }
  return hash.digest('hex');
}

export function detectDuplicates(db: DatabaseType, input: DuplicateCheckInput): DuplicateCheckResult {
  let computedFileHash: string | null = input.fileHash || null;
  if (!computedFileHash && input.fileBuffer) {
    computedFileHash = computeSha256(input.fileBuffer);
  }

  let computedContentHash: string | null = input.contentHash || null;
  if (!computedContentHash && input.rawText !== undefined && input.rawText !== null) {
    computedContentHash = computeSha256(input.rawText);
  }

  // 1. Check exact file_hash repeat
  if (computedFileHash) {
    const existing = documentRepo.findByFileHash(db, computedFileHash);
    if (existing) {
      return {
        isDuplicate: true,
        duplicateType: 'FILE_HASH',
        status: 'DUPLICATE_FILE',
        duplicateOfId: existing.id,
        isContentCandidate: false,
        candidateOfId: null,
        computedFileHash,
        computedContentHash,
      };
    }
  }

  // 2. Check exact message_id repeat
  if (input.messageId) {
    const cleanMessageId = input.messageId.trim();
    if (cleanMessageId.length > 0) {
      const existing = documentRepo.findByMessageId(db, cleanMessageId);
      if (existing) {
        return {
          isDuplicate: true,
          duplicateType: 'MESSAGE_ID',
          status: 'DUPLICATE_FILE',
          duplicateOfId: existing.id,
          isContentCandidate: false,
          candidateOfId: null,
          computedFileHash,
          computedContentHash,
        };
      }
    }
  }

  // 3. Content fallback: SHA-256 content_hash match -> candidate flag in metadata
  let isContentCandidate = false;
  let candidateOfId: string | null = null;
  if (computedContentHash) {
    const existing = documentRepo.findByContentHash(db, computedContentHash);
    if (existing) {
      isContentCandidate = true;
      candidateOfId = existing.id;
    }
  }

  return {
    isDuplicate: false,
    duplicateType: null,
    status: 'VALID',
    duplicateOfId: null,
    isContentCandidate,
    candidateOfId,
    computedFileHash,
    computedContentHash,
  };
}
