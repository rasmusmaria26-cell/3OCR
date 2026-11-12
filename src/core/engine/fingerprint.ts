import crypto from 'node:crypto';

export interface FingerprintParams {
  issueType: string;
  field: string;
  normalizedSku?: string | null;
  docVersionIds: string[];
}

export function computeIssueFingerprint(params: FingerprintParams): string {
  const { issueType, field, normalizedSku, docVersionIds } = params;

  // Canonical components
  const cleanType = issueType.trim().toUpperCase();
  const cleanField = field.trim();
  const cleanSku = (normalizedSku || '').trim().toUpperCase();
  const sortedDocIds = [...docVersionIds].map((id) => id.trim()).sort().join(',');

  const canonicalString = `${cleanType}|${cleanField}|${cleanSku}|${sortedDocIds}`;

  return crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
}

