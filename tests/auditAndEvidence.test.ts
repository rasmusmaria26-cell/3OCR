import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { Database as DatabaseType } from 'better-sqlite3';
import { createDatabase } from '../src/db/database.js';
import { createExpressApp } from '../src/api/app.js';
import { caseRepo, documentRepo, reviewRepo } from '../src/db/repositories/index.js';
import { highlightEvidenceSnippet, getVerificationBadges } from '../src/core/evidence/evidenceHighlighter.js';
import { Evidence } from '../src/core/schema/stageA.schema.js';

describe('Audit History & Evidence Highlighting (Phase 3)', () => {
  let db: DatabaseType;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    const app = createExpressApp(db);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  describe('Evidence Highlighter', () => {
    it('generates contextual text with highlighted matched snippet and surrounding context', () => {
      const documentText = 'Vendor Invoice Inc.\nPO Reference: PO-9988\nTotal Payable Amount: $1,250.00 USD\nThank you for your business!';
      const evidence: Evidence = {
        fieldPath: 'amounts.grandTotal',
        rawValue: '1,250.00',
        snippet: 'Total Payable Amount: $1,250.00 USD',
        page: 1,
        charStart: 42,
        charEnd: 77,
        jsonPath: null,
        extractionMethod: 'REGEX',
      };

      const result = highlightEvidenceSnippet({
        documentText,
        evidence,
        contextPadding: 15,
      });

      expect(result.matchedSnippet).toBe('Total Payable Amount: $1,250.00 USD');
      expect(result.prefixContext).toContain('PO-9988');
      expect(result.suffixContext).toContain('Thank you');
      expect(result.highlightedSnippetHtml).toContain('<mark');
      expect(result.highlightedSnippetHtml).toContain('Total Payable Amount: $1,250.00 USD');
    });

    it('generates metadata badges indicating verification status', () => {
      const documentText = 'Order PO-100 Item SKU-42 Quantity 50 Unit Price 20.00 Total 1000.00';
      const evidence: Evidence = {
        fieldPath: 'lineItems[0].quantity',
        rawValue: '50',
        snippet: 'Quantity 50',
        page: 1,
        charStart: 34,
        charEnd: 45,
        jsonPath: null,
        extractionMethod: 'REGEX',
      };

      const badges = getVerificationBadges({
        documentText,
        evidence,
        candidateValue: '50.00', // Decimal equivalent to '50'
      });

      expect(badges).toContain('EXACT_SUBSTRING_VERIFIED');
      expect(badges).toContain('TOKEN_BOUNDARY_VERIFIED');
      expect(badges).toContain('DECIMAL_EQUIVALENT_VERIFIED');
    });
  });

  describe('Audit History Endpoint & Superseded Decision Trail', () => {
    it('returns 404 for non-existent case on GET /api/cases/:id/audit', async () => {
      const res = await fetch(`${baseUrl}/api/cases/non-existent-case/audit`);
      expect(res.status).toBe(404);
      const json = (await res.json()) as any;
      expect(json.error).toBe('Case not found');
    });

    it('returns chronological audit logs for case and its linked documents via GET /api/cases/:id/audit', async () => {
      const caseId = 'case-audit-101';
      db.prepare(`
        INSERT INTO processing_cases (id, customer_id, po_number, status, expected_sources, created_at, updated_at)
        VALUES ('${caseId}', 'CUST-AUDIT', 'PO-AUDIT-1', 'OPEN', '["PDF","EMAIL"]', '2026-11-11T10:00:00.000Z', '2026-11-11T10:00:00.000Z')
      `).run();

      // Ingest document linked to case (which triggers LINK_CASE in audit_logs)
      const docId = 'doc-audit-1';
      documentRepo.insert(db, {
        id: docId,
        caseId,
        sourceType: 'PDF',
        status: 'VALID',
        receivedAt: '2026-11-11T10:01:00.000Z',
      });

      // Add a case-level audit log entry
      db.prepare(`
        INSERT INTO audit_logs (id, entity_type, entity_id, action, details_json, performed_by, created_at)
        VALUES ('audit-c1', 'CASE', '${caseId}', 'RECONCILIATION_RUN', '{"status":"MISMATCH"}', 'SYSTEM', '2026-11-11T10:02:00.000Z')
      `).run();

      const res = await fetch(`${baseUrl}/api/cases/${caseId}/audit`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.caseId).toBe(caseId);
      expect(Array.isArray(data.auditLogs)).toBe(true);
      expect(data.auditLogs.length).toBeGreaterThanOrEqual(2);

      // Verify chronological order
      const timestamps = data.auditLogs.map((l: any) => new Date(l.created_at).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
      }

      // Check details is parsed
      const runLog = data.auditLogs.find((l: any) => l.action === 'RECONCILIATION_RUN');
      expect(runLog).toBeDefined();
      expect(runLog.details.status).toBe('MISMATCH');
    });

    it('tracks superseded review decision trail with superseded_by attribution', async () => {
      const caseId = 'case-review-trail';
      db.prepare(`
        INSERT INTO processing_cases (id, customer_id, po_number, status, expected_sources, created_at, updated_at)
        VALUES ('${caseId}', 'CUST-AUDIT', 'PO-REV-1', 'OPEN', '["PDF"]', '2026-11-11T10:00:00.000Z', '2026-11-11T10:00:00.000Z')
      `).run();

      const fp = 'fp-test-quantity-mismatch';

      // 1. Submit initial decision
      const res1 = await fetch(`${baseUrl}/api/cases/${caseId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueFingerprint: fp,
          field: 'quantity',
          previousValue: '15',
          selectedValue: '10',
          reason: 'Initial approval by agent',
          reviewer: 'Alice',
          documentVersionIds: ['doc-1'],
        }),
      });
      expect(res1.status).toBe(201);
      const json1 = (await res1.json()) as any;
      const firstDecisionId = json1.decisionId;

      // 2. Submit superseding decision for the same fingerprint
      const res2 = await fetch(`${baseUrl}/api/cases/${caseId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueFingerprint: fp,
          field: 'quantity',
          previousValue: '10',
          selectedValue: '12',
          reason: 'Corrected quantity based on revised customer note',
          reviewer: 'Bob',
          documentVersionIds: ['doc-1'],
        }),
      });
      expect(res2.status).toBe(201);
      const json2 = (await res2.json()) as any;
      const secondDecisionId = json2.decisionId;

      // Query case details
      const caseRes = await fetch(`${baseUrl}/api/cases/${caseId}`);
      expect(caseRes.status).toBe(200);
      const caseData = (await caseRes.json()) as any;

      // Active decisions should only contain the second decision
      expect(caseData.activeDecisions).toHaveLength(1);
      expect(caseData.activeDecisions[0].id).toBe(secondDecisionId);
      expect(caseData.activeDecisions[0].selected_value).toBe('12');

      // All decisions should contain both, with firstDecision having superseded_by = secondDecisionId
      expect(caseData.allDecisions).toBeDefined();
      expect(caseData.allDecisions).toHaveLength(2);
      const superseded = caseData.allDecisions.find((d: any) => d.id === firstDecisionId);
      expect(superseded).toBeDefined();
      expect(superseded.superseded_by).toBe(secondDecisionId);

      // 3. Submit a 3rd chained superseding decision (A -> B -> C)
      const res3 = await fetch(`${baseUrl}/api/cases/${caseId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueFingerprint: fp,
          field: 'quantity',
          previousValue: '12',
          selectedValue: '14',
          reason: 'Senior manager override',
          reviewer: 'Charlie',
          documentVersionIds: ['doc-1'],
        }),
      });
      expect(res3.status).toBe(201);
      const json3 = (await res3.json()) as any;
      const thirdDecisionId = json3.decisionId;

      // Query case details again
      const caseRes2 = await fetch(`${baseUrl}/api/cases/${caseId}`);
      expect(caseRes2.status).toBe(200);
      const caseData2 = (await caseRes2.json()) as any;

      expect(caseData2.activeDecisions).toHaveLength(1);
      expect(caseData2.activeDecisions[0].id).toBe(thirdDecisionId);
      expect(caseData2.activeDecisions[0].selected_value).toBe('14');

      expect(caseData2.allDecisions).toHaveLength(3);
      const d1 = caseData2.allDecisions.find((d: any) => d.id === firstDecisionId);
      const d2 = caseData2.allDecisions.find((d: any) => d.id === secondDecisionId);
      const d3 = caseData2.allDecisions.find((d: any) => d.id === thirdDecisionId);

      expect(d1?.superseded_by).toBe(secondDecisionId);
      expect(d2?.superseded_by).toBe(thirdDecisionId);
      expect(d3?.superseded_by).toBeNull();
    });
  });
});
