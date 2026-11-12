import { Database as DatabaseType } from 'better-sqlite3';
import { senderMappingRepo } from '../../db/repositories/index.js';

export interface SenderResolutionInput {
  db: DatabaseType;
  senderEmail?: string | null;
  spfStatus?: 'PASS' | 'FAIL' | 'SOFTFAIL' | 'NONE' | null;
  dkimStatus?: 'PASS' | 'FAIL' | 'NONE' | null;
  payloadCustomerId?: string | null;
}

export interface SenderResolutionResult {
  mappedCustomerId: string | null;
  isVerifiedSender: boolean;
  unverifiedReason: string | null;
  matchType: 'EXACT' | 'DOMAIN' | null;
  senderPattern: string | null;
  hasIdentityConflict: boolean;
  identityConflictReason: string | null;
  routeToQueue: 'IDENTITY_CONFLICT' | 'UNLINKED' | null;
}

export function resolveSenderIdentity(input: SenderResolutionInput): SenderResolutionResult {
  const { db, senderEmail, spfStatus, dkimStatus, payloadCustomerId } = input;

  // 1. SPF / DKIM verification check
  let isVerifiedSender = true;
  const unverifiedReasons: string[] = [];

  if (spfStatus === 'FAIL' || spfStatus === 'SOFTFAIL') {
    isVerifiedSender = false;
    unverifiedReasons.push(`SPF failed (${spfStatus})`);
  }
  if (dkimStatus === 'FAIL') {
    isVerifiedSender = false;
    unverifiedReasons.push(`DKIM failed (${dkimStatus})`);
  }

  const unverifiedReason = unverifiedReasons.length > 0 ? unverifiedReasons.join('; ') : null;

  // 2. Sender mapping resolution (exact first, domain fallback)
  let mappedCustomerId: string | null = null;
  let matchType: 'EXACT' | 'DOMAIN' | null = null;
  let senderPattern: string | null = null;

  if (senderEmail) {
    const match = senderMappingRepo.findMatch(db, senderEmail);
    if (match) {
      mappedCustomerId = match.customerId;
      matchType = match.isDomain === 1 ? 'DOMAIN' : 'EXACT';
      senderPattern = match.pattern;
    }
  }

  // 3. Identity Conflict checking
  let hasIdentityConflict = false;
  let identityConflictReason: string | null = null;
  let routeToQueue: 'IDENTITY_CONFLICT' | 'UNLINKED' | null = null;

  const cleanPayloadCustId = payloadCustomerId?.trim();

  // Condition A: Document payload customer ID differs from mapped sender customer ID
  if (mappedCustomerId && cleanPayloadCustId && mappedCustomerId !== cleanPayloadCustId) {
    hasIdentityConflict = true;
    identityConflictReason = `Payload customer ID '${cleanPayloadCustId}' differs from mapped sender customer ID '${mappedCustomerId}'`;
    routeToQueue = 'IDENTITY_CONFLICT';
  } else if (!isVerifiedSender && cleanPayloadCustId && mappedCustomerId && mappedCustomerId !== cleanPayloadCustId) {
    hasIdentityConflict = true;
    identityConflictReason = `Unverified sender (${unverifiedReason}) with conflicting customer ID '${cleanPayloadCustId}' vs mapped '${mappedCustomerId}'`;
    routeToQueue = 'IDENTITY_CONFLICT';
  } else if (!isVerifiedSender && cleanPayloadCustId && mappedCustomerId === null && senderEmail) {
    // Unverified sender from external domain attempting to set a customer ID
    hasIdentityConflict = true;
    identityConflictReason = `Unverified sender (${unverifiedReason}) for sender '${senderEmail}'`;
    routeToQueue = 'IDENTITY_CONFLICT';
  }

  return {
    mappedCustomerId,
    isVerifiedSender,
    unverifiedReason,
    matchType,
    senderPattern,
    hasIdentityConflict,
    identityConflictReason,
    routeToQueue,
  };
}
