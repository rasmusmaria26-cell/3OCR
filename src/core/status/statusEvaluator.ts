export type CaseStatus =
  | 'REVIEW_REQUIRED'
  | 'MISMATCH'
  | 'INCOMPLETE'
  | 'OPEN'
  | 'RESOLVED'
  | 'MATCHED';

export interface StatusEvaluationParams {
  hasBlockingIssues: boolean;
  hasMismatches: boolean;
  hasPendingExpectedSources: boolean;
  pendingSources?: string[];
  isResolved?: boolean;
  hasDocuments?: boolean;
}

export interface StatusEvaluationResult {
  status: CaseStatus;
  isWaitingForJson: boolean;
  pendingSources: string[];
  wasReopened: boolean;
}

export function evaluateCaseStatus(params: {
  hasBlockingIssues: boolean;
  hasMismatches: boolean;
  hasPendingExpectedSources: boolean;
  pendingSources?: string[];
  isResolved?: boolean;
  hasDocuments?: boolean;
}): StatusEvaluationResult {
  const {
    hasBlockingIssues,
    hasMismatches,
    hasPendingExpectedSources,
    pendingSources = [],
    isResolved = false,
    hasDocuments = true,
  } = params;

  const isWaitingForJson = pendingSources.includes('JSON');
  let wasReopened = false;

  // 1. REVIEW_REQUIRED: highest precedence
  if (hasBlockingIssues) {
    if (isResolved) wasReopened = true;
    return {
      status: 'REVIEW_REQUIRED',
      isWaitingForJson,
      pendingSources,
      wasReopened,
    };
  }

  // 2. MISMATCH: next highest precedence, even if JSON is still pending
  if (hasMismatches) {
    if (isResolved) wasReopened = true;
    return {
      status: 'MISMATCH',
      isWaitingForJson,
      pendingSources,
      wasReopened,
    };
  }

  // 3. INCOMPLETE: no errors or mismatches, but awaiting expected sources
  if (hasPendingExpectedSources) {
    return {
      status: 'INCOMPLETE',
      isWaitingForJson,
      pendingSources,
      wasReopened: false,
    };
  }

  // 4. OPEN: initial empty case
  if (!hasDocuments) {
    return {
      status: 'OPEN',
      isWaitingForJson,
      pendingSources,
      wasReopened: false,
    };
  }

  // 5. RESOLVED: previously resolved issues without new mismatches
  if (isResolved) {
    return {
      status: 'RESOLVED',
      isWaitingForJson,
      pendingSources,
      wasReopened: false,
    };
  }

  // 6. MATCHED: everything clean and matched
  return {
    status: 'MATCHED',
    isWaitingForJson,
    pendingSources,
    wasReopened: false,
  };
}

