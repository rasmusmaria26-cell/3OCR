import { describe, it, expect } from 'vitest';
import { evaluateCaseStatus } from '../src/core/status/statusEvaluator.js';

describe('Case Status Evaluator', () => {
  it('gives REVIEW_REQUIRED highest precedence if any blocking issue exists', () => {
    const status = evaluateCaseStatus({
      hasBlockingIssues: true,
      hasMismatches: true,
      hasPendingExpectedSources: true,
      isResolved: false,
    });
    expect(status.status).toBe('REVIEW_REQUIRED');
  });

  it('shows MISMATCH even while JSON is pending (with waiting for JSON indicator)', () => {
    const status = evaluateCaseStatus({
      hasBlockingIssues: false,
      hasMismatches: true,
      hasPendingExpectedSources: true,
      pendingSources: ['JSON'],
      isResolved: false,
    });
    expect(status.status).toBe('MISMATCH');
    expect(status.isWaitingForJson).toBe(true);
    expect(status.pendingSources).toEqual(['JSON']);
  });

  it('shows INCOMPLETE when no mismatches but sources are still pending', () => {
    const status = evaluateCaseStatus({
      hasBlockingIssues: false,
      hasMismatches: false,
      hasPendingExpectedSources: true,
      pendingSources: ['JSON'],
      isResolved: false,
    });
    expect(status.status).toBe('INCOMPLETE');
  });

  it('shows MATCHED when all expected sources arrived and 0 issues exist', () => {
    const status = evaluateCaseStatus({
      hasBlockingIssues: false,
      hasMismatches: false,
      hasPendingExpectedSources: false,
      pendingSources: [],
      isResolved: false,
    });
    expect(status.status).toBe('MATCHED');
  });

  it('reopens case to MISMATCH when a new mismatching document arrives after RESOLVED', () => {
    const status = evaluateCaseStatus({
      hasBlockingIssues: false,
      hasMismatches: true, // new mismatch introduced by newly arrived document
      hasPendingExpectedSources: false,
      pendingSources: [],
      isResolved: true, // was previously resolved
    });
    expect(status.status).toBe('MISMATCH');
    expect(status.wasReopened).toBe(true);
  });
});

