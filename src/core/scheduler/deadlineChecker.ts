import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'node:crypto';
import { caseRepo, documentRepo } from '../../db/repositories/index.js';

export interface DeadlineEvaluationSummary {
  evaluatedCount: number;
  expiredIncompleteCount: number;
  incompleteCaseIds: string[];
  details: Array<{
    caseId: string;
    deadline: string;
    missingSources: string[];
    statusChangedTo: string;
  }>;
}

export function evaluateCaseDeadlines(db: DatabaseType, nowIsoString?: string): DeadlineEvaluationSummary {
  const now = nowIsoString ? new Date(nowIsoString) : new Date();
  const nowIso = now.toISOString();

  // Find all open cases with a deadline
  const openCases = db.prepare(`
    SELECT id, customer_id, po_number, status, expected_sources, deadline
    FROM processing_cases
    WHERE status = 'OPEN' AND deadline IS NOT NULL
  `).all() as Array<{
    id: string;
    customer_id: string;
    po_number: string;
    status: string;
    expected_sources: string;
    deadline: string;
  }>;

  const incompleteCaseIds: string[] = [];
  const details: DeadlineEvaluationSummary['details'] = [];

  for (const c of openCases) {
    const deadlineDate = new Date(c.deadline);
    if (now.getTime() > deadlineDate.getTime()) {
      // Overdue! Check expected sources vs arrived sources
      let expectedSources: string[] = [];
      try {
        expectedSources = JSON.parse(c.expected_sources || '[]');
      } catch {
        expectedSources = ['EMAIL', 'PDF', 'JSON'];
      }

      // Query valid arrived documents for this case
      const docs = documentRepo.findForCase(db, c.id);
      const arrivedSources = new Set<string>();
      for (const d of docs) {
        if (d.status === 'VALID' && d.is_current_version === 1) {
          arrivedSources.add(d.source_type);
        }
      }

      const missingSources = expectedSources.filter((s) => !arrivedSources.has(s));

      if (missingSources.length > 0) {
        // Flip status to INCOMPLETE
        caseRepo.updateStatus(db, c.id, 'INCOMPLETE');

        // Append-only audit log
        db.prepare(`
          INSERT INTO audit_logs (id, entity_type, entity_id, action, details_json, performed_by, created_at)
          VALUES (?, 'CASE', ?, 'DEADLINE_EXPIRED', ?, 'SCHEDULER', ?)
        `).run(
          crypto.randomUUID(),
          c.id,
          JSON.stringify({
            deadline: c.deadline,
            evaluatedAt: nowIso,
            missingSources,
            expectedSources,
          }),
          nowIso
        );

        incompleteCaseIds.push(c.id);
        details.push({
          caseId: c.id,
          deadline: c.deadline,
          missingSources,
          statusChangedTo: 'INCOMPLETE',
        });
      }
    }
  }

  return {
    evaluatedCount: openCases.length,
    expiredIncompleteCount: incompleteCaseIds.length,
    incompleteCaseIds,
    details,
  };
}
