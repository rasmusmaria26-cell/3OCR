import { Database as DatabaseType } from 'better-sqlite3';
import Decimal from 'decimal.js';
import { StageADocument } from '../schema/stageA.schema.js';
import { normalizePoNumber } from '../normalizer/identifierNormalizer.js';
import { resolveProductAlias, resolveDefaults } from '../normalizer/defaultResolver.js';
import { validateSourcePolicy } from '../policy/sourcePolicy.js';
import { checkDocumentArithmetic, detectSharedWrongTotal } from './arithmeticChecker.js';
import { calculateDocumentGrandTotal } from './headerCalculator.js';
import { validateDocumentGst } from '../tax/gstValidator.js';
import { matchDocumentLines, LineForMatch } from './lineMatcher.js';
import { computeIssueFingerprint } from './fingerprint.js';
import { evaluateCaseStatus, CaseStatus } from '../status/statusEvaluator.js';
import { TOLERANCES, isWithinTolerance } from './tolerance.js';
import { headerAdjustmentRepo } from '../../db/repositories/index.js';

export interface ReconcilerIssue {
  fingerprint: string;
  issueType: string;
  field: string;
  lineReference?: string | null;
  normalizedSku?: string | null;
  docVersionIds: string[];
  candidateValues?: Record<string, string | null>;
  message: string;
  isBlocking: boolean;
  isResolvedByReview?: boolean;
}

export interface ReconcilerSummary {
  documentsCompared: string[];
  linesChecked: number;
  mismatchesCount: number;
  blockingIssuesCount: number;
  unresolvedIssuesCount: number;
  arithmeticStatus: 'VALID' | 'INVALID';
}

export interface ReconcilerResult {
  status: CaseStatus;
  isWaitingForJson: boolean;
  wasReopened: boolean;
  pendingSources: string[];
  issues: ReconcilerIssue[];
  summary: ReconcilerSummary;
}

export interface ReconcileCaseParams {
  db: DatabaseType;
  caseId?: string;
  customerId: string;
  poNumber: string;
  documents: StageADocument[];
  expectedSources?: string[];
}

export function reconcileCase(params: ReconcileCaseParams): ReconcilerResult {
  const { db, caseId, customerId, poNumber, documents, expectedSources = ['EMAIL', 'PDF', 'JSON'] } = params;

  const issues: ReconcilerIssue[] = [];
  const docIds = documents.map((d) => d.source.documentId).filter(Boolean);
  let totalLinesChecked = 0;
  let arithmeticValid = true;

  // 0. Load extraction issues from DB if present
  if (docIds.length > 0) {
    try {
      const placeholders = docIds.map(() => '?').join(',');
      const dbIssues = db.prepare(`
        SELECT id, document_id, field_path, code, candidate_value, raw_value, snippet, is_blocking
        FROM extraction_issues
        WHERE document_id IN (${placeholders})
      `).all(...docIds) as any[];

      for (const dIssue of dbIssues) {
        const fp = computeIssueFingerprint({
          issueType: dIssue.code,
          field: dIssue.field_path,
          normalizedSku: null,
          docVersionIds: [dIssue.document_id],
        });
        issues.push({
          fingerprint: fp,
          issueType: dIssue.code,
          field: dIssue.field_path,
          docVersionIds: [dIssue.document_id],
          candidateValues: {
            candidate: dIssue.candidate_value,
            raw: dIssue.raw_value,
            snippet: dIssue.snippet,
          },
          message: `Extraction verification failure on ${dIssue.field_path}: ${dIssue.code}`,
          isBlocking: dIssue.is_blocking === 1,
        });
      }
    } catch {
      // Graceful fallback if table does not exist in testing context
    }
  }

  // Normalized document views
  const normalizedDocs = documents.map((doc) => {
    const normPo = normalizePoNumber(doc.order.poNumber || '');
    const defaults = resolveDefaults(db, customerId, {
      currency: doc.order.currency,
    });

    const normLines = doc.lineItems.map((line, idx) => {
      let finalSku: string | null = null;
      if (line.productCode) {
        const aliasResult = resolveProductAlias(db, customerId, line.productCode);
        if (aliasResult.resolved && aliasResult.sku) {
          finalSku = aliasResult.sku.trim().toUpperCase();
        } else if (aliasResult.isAmbiguous) {
          const fp = computeIssueFingerprint({
            issueType: 'AMBIGUOUS_ALIAS',
            field: `lineItems[${idx}].productCode`,
            normalizedSku: null,
            docVersionIds: [doc.source.documentId],
          });
          issues.push({
            fingerprint: fp,
            issueType: 'AMBIGUOUS_ALIAS',
            field: `lineItems[${idx}].productCode`,
            lineReference: line.lineReference || `${idx + 1}`,
            normalizedSku: null,
            docVersionIds: [doc.source.documentId],
            candidateValues: { productCode: line.productCode },
            message: `Product code "${line.productCode}" ambiguously maps to multiple SKUs. Review required.`,
            isBlocking: true,
          });
        } else {
          finalSku = line.productCode.trim().toUpperCase();
        }
      } else if (line.description) {
        const aliasResult = resolveProductAlias(db, customerId, line.description);
        if (aliasResult.resolved && aliasResult.sku) {
          finalSku = aliasResult.sku.trim().toUpperCase();
        } else if (aliasResult.isAmbiguous) {
          // Phase 1 Fix 8: Ambiguous alias mapped to multiple SKUs
          const fp = computeIssueFingerprint({
            issueType: 'AMBIGUOUS_ALIAS',
            field: `lineItems[${idx}].productCode`,
            normalizedSku: null,
            docVersionIds: [doc.source.documentId],
          });
          issues.push({
            fingerprint: fp,
            issueType: 'AMBIGUOUS_ALIAS',
            field: `lineItems[${idx}].productCode`,
            lineReference: line.lineReference || `${idx + 1}`,
            normalizedSku: null,
            docVersionIds: [doc.source.documentId],
            candidateValues: { description: line.description },
            message: `Product description "${line.description}" ambiguously maps to multiple SKUs. Review required.`,
            isBlocking: true,
          });
        }
      }

      return {
        ...line,
        normalizedSku: finalSku,
        normalizedUom: line.unitOfMeasure || defaults.uom.value,
        resolvedCurrency: defaults.currency.value,
      };
    });

    return {
      rawDoc: doc,
      documentId: doc.source.documentId,
      sourceType: doc.source.sourceType,
      normalizedPo: normPo,
      resolvedCurrency: defaults.currency.value,
      normalizedLines: normLines,
    };
  });

  // 1. Source policy validation & single-document arithmetic
  for (const nd of normalizedDocs) {
    const policyResult = validateSourcePolicy(nd.rawDoc);
    if (!policyResult.isValid) {
      for (const pIssue of policyResult.issues) {
        const fp = computeIssueFingerprint({
          issueType: pIssue.code,
          field: pIssue.field,
          normalizedSku: null,
          docVersionIds: [nd.documentId],
        });
        issues.push({
          fingerprint: fp,
          issueType: pIssue.code,
          field: pIssue.field,
          docVersionIds: [nd.documentId],
          message: pIssue.message,
          isBlocking: pIssue.isBlocking,
        });
      }
    }

    const arithResult = checkDocumentArithmetic(nd.rawDoc);
    if (!arithResult.isValid) {
      arithmeticValid = false;
      for (const aIssue of arithResult.issues) {
        const fp = computeIssueFingerprint({
          issueType: aIssue.code,
          field: aIssue.field,
          normalizedSku: null,
          docVersionIds: [nd.documentId],
        });
        issues.push({
          fingerprint: fp,
          issueType: aIssue.code,
          field: aIssue.field,
          lineReference: aIssue.lineReference,
          docVersionIds: [nd.documentId],
          candidateValues: { expected: aIssue.expected, actual: aIssue.actual },
          message: aIssue.message,
          isBlocking: aIssue.isBlocking,
        });
      }
    }

    // Load header adjustments from DB if not already present on rawDoc
    if ((!nd.rawDoc.headerAdjustments || nd.rawDoc.headerAdjustments.length === 0) && db && nd.documentId) {
      try {
        const dbAdjs = headerAdjustmentRepo.findByDocumentId(db, nd.documentId);
        if (dbAdjs && dbAdjs.length > 0) {
          nd.rawDoc.headerAdjustments = dbAdjs.map((a: any) => ({
            type: a.type,
            description: a.description || undefined,
            amount: a.amount,
            taxes: a.taxes_json ? JSON.parse(a.taxes_json) : undefined,
          }));
        }
      } catch {
        // ignore
      }
    }

    // Phase 3: Full Header Adjustments & Grand Total Arithmetic
    const hasHeaderAdjs = nd.rawDoc.headerAdjustments && nd.rawDoc.headerAdjustments.length > 0;
    const hasPrintedFreight = nd.rawDoc.amounts?.freight && Number(nd.rawDoc.amounts.freight) !== 0;
    const hasPrintedDiscount = nd.rawDoc.amounts?.discountTotal && Number(nd.rawDoc.amounts.discountTotal) !== 0;

    if (hasHeaderAdjs || hasPrintedFreight || hasPrintedDiscount) {
      const headerArithResult = calculateDocumentGrandTotal(nd.rawDoc);
      if (!headerArithResult.isValid) {
        arithmeticValid = false;
        for (const hIssue of headerArithResult.issues) {
          const fp = computeIssueFingerprint({
            issueType: hIssue.code,
            field: hIssue.field,
            normalizedSku: null,
            docVersionIds: [nd.documentId],
          });
          issues.push({
            fingerprint: fp,
            issueType: hIssue.code,
            field: hIssue.field,
            lineReference: hIssue.lineReference,
            docVersionIds: [nd.documentId],
            candidateValues: { expected: hIssue.expected || null, actual: hIssue.actual || null },
            message: hIssue.message,
            isBlocking: hIssue.isBlocking,
          });
        }
      }
    }

    // Phase 3: GST Rate Validation
    const gstResult = validateDocumentGst(nd.rawDoc, { db });
    if (!gstResult.isValid) {
      arithmeticValid = false;
      for (const gIssue of gstResult.issues) {
        const fp = computeIssueFingerprint({
          issueType: gIssue.code,
          field: gIssue.field,
          normalizedSku: null,
          docVersionIds: [nd.documentId],
        });
        issues.push({
          fingerprint: fp,
          issueType: gIssue.code,
          field: gIssue.field,
          lineReference: gIssue.lineReference,
          docVersionIds: [nd.documentId],
          candidateValues: { expected: gIssue.expected || null, actual: gIssue.actual || null },
          message: gIssue.message,
          isBlocking: gIssue.isBlocking,
        });
      }
    }
  }

  // 2. Cross-document comparisons if at least 2 documents exist
  if (normalizedDocs.length >= 2) {
    // A. PO Number consistency
    const firstPo = normalizedDocs[0].normalizedPo;
    for (let i = 1; i < normalizedDocs.length; i++) {
      if (normalizedDocs[i].normalizedPo !== firstPo) {
        const fp = computeIssueFingerprint({
          issueType: 'PO_NUMBER_MISMATCH',
          field: 'order.poNumber',
          normalizedSku: null,
          docVersionIds: [normalizedDocs[0].documentId, normalizedDocs[i].documentId],
        });
        issues.push({
          fingerprint: fp,
          issueType: 'PO_NUMBER_MISMATCH',
          field: 'order.poNumber',
          docVersionIds: [normalizedDocs[0].documentId, normalizedDocs[i].documentId],
          candidateValues: {
            [normalizedDocs[0].documentId]: firstPo,
            [normalizedDocs[i].documentId]: normalizedDocs[i].normalizedPo,
          },
          message: `PO numbers differ between documents: "${firstPo}" vs "${normalizedDocs[i].normalizedPo}"`,
          isBlocking: true,
        });
      }
    }

    // B. Currency consistency ($500 never equals ₹500)
    const currencies = normalizedDocs
      .filter((d) => d.resolvedCurrency)
      .map((d) => ({ docId: d.documentId, currency: d.resolvedCurrency }));

    if (currencies.length >= 2) {
      const baseCurr = currencies[0].currency;
      for (let i = 1; i < currencies.length; i++) {
        if (currencies[i].currency !== baseCurr) {
          const fp = computeIssueFingerprint({
            issueType: 'CURRENCY_MISMATCH',
            field: 'order.currency',
            normalizedSku: null,
            docVersionIds: [currencies[0].docId, currencies[i].docId],
          });
          issues.push({
            fingerprint: fp,
            issueType: 'CURRENCY_MISMATCH',
            field: 'order.currency',
            docVersionIds: [currencies[0].docId, currencies[i].docId],
            candidateValues: {
              [currencies[0].docId]: baseCurr,
              [currencies[i].docId]: currencies[i].currency,
            },
            message: `Currencies differ between documents: ${baseCurr} vs ${currencies[i].currency}`,
            isBlocking: true,
          });
        }
      }
    }

    // C. Shared wrong total check
    const rawDocs = normalizedDocs.map((nd) => nd.rawDoc);
    const sharedWrong = detectSharedWrongTotal(rawDocs);
    if (sharedWrong.isSharedWrongTotal) {
      const fp = computeIssueFingerprint({
        issueType: 'SHARED_WRONG_TOTAL',
        field: 'amounts.grandTotal',
        normalizedSku: null,
        docVersionIds: docIds,
      });
      issues.push({
        fingerprint: fp,
        issueType: 'SHARED_WRONG_TOTAL',
        field: 'amounts.grandTotal',
        docVersionIds: docIds,
        candidateValues: {
          printedTotal: sharedWrong.printedTotal || null,
          computedTotal: sharedWrong.computedTotal || null,
        },
        message: sharedWrong.message || 'All documents share a wrong grand total',
        isBlocking: false,
      });
    }

    // D. Grand total consistency across complete documents (PDF and JSON) (if no header adjustments)
    const docsWithGrandTotals = normalizedDocs.filter(
      (d) => d.sourceType !== 'EMAIL' && d.rawDoc.amounts.grandTotal && (!d.rawDoc.headerAdjustments || d.rawDoc.headerAdjustments.length === 0)
    );
    if (docsWithGrandTotals.length >= 2) {
      const baseTotal = docsWithGrandTotals[0].rawDoc.amounts.grandTotal!;
      for (let i = 1; i < docsWithGrandTotals.length; i++) {
        const compareTotal = docsWithGrandTotals[i].rawDoc.amounts.grandTotal!;
        if (!isWithinTolerance(baseTotal, compareTotal, TOLERANCES.GRAND_TOTAL)) {
          const fp = computeIssueFingerprint({
            issueType: 'GRAND_TOTAL_MISMATCH',
            field: 'amounts.grandTotal',
            normalizedSku: null,
            docVersionIds: [docsWithGrandTotals[0].documentId, docsWithGrandTotals[i].documentId],
          });
          issues.push({
            fingerprint: fp,
            issueType: 'GRAND_TOTAL_MISMATCH',
            field: 'amounts.grandTotal',
            docVersionIds: [docsWithGrandTotals[0].documentId, docsWithGrandTotals[i].documentId],
            candidateValues: {
              [docsWithGrandTotals[0].documentId]: baseTotal,
              [docsWithGrandTotals[i].documentId]: compareTotal,
            },
            message: `Grand totals differ: ${baseTotal} vs ${compareTotal}`,
            isBlocking: false,
          });
        }
      }
    }

    // E. Line item matching and comparison across complete documents (PDF and JSON)
    const pdfDoc = normalizedDocs.find((d) => d.sourceType === 'PDF');
    const jsonDoc = normalizedDocs.find((d) => d.sourceType === 'JSON');
    const emailDoc = normalizedDocs.find((d) => d.sourceType === 'EMAIL');

    if (pdfDoc && jsonDoc) {
      const linesA: LineForMatch[] = pdfDoc.normalizedLines
        .filter((l) => l.normalizedSku)
        .map((l) => ({
          sku: l.normalizedSku!,
          qty: l.quantity || '0',
          unitPrice: l.unitPrice,
          uom: l.normalizedUom,
          lineReference: l.lineReference,
        }));

      const linesB: LineForMatch[] = jsonDoc.normalizedLines
        .filter((l) => l.normalizedSku)
        .map((l) => ({
          sku: l.normalizedSku!,
          qty: l.quantity || '0',
          unitPrice: l.unitPrice,
          uom: l.normalizedUom,
          lineReference: l.lineReference,
        }));

      const matchRes = matchDocumentLines(linesA, linesB);
      totalLinesChecked += matchRes.matchedPairs.length;

      // Duplicate SKU issues
      for (const rIssue of matchRes.reviewIssues) {
        const fp = computeIssueFingerprint({
          issueType: rIssue.code,
          field: 'lineItems',
          normalizedSku: rIssue.sku,
          docVersionIds: [pdfDoc.documentId, jsonDoc.documentId],
        });
        issues.push({
          fingerprint: fp,
          issueType: rIssue.code,
          field: 'lineItems',
          normalizedSku: rIssue.sku,
          docVersionIds: [pdfDoc.documentId, jsonDoc.documentId],
          message: rIssue.message,
          isBlocking: rIssue.isBlocking,
        });
      }

      // Missing in JSON
      for (const unA of matchRes.unmatchedA) {
        const fp = computeIssueFingerprint({
          issueType: 'MISSING_LINE_ITEM',
          field: 'lineItems',
          normalizedSku: unA.sku,
          docVersionIds: [pdfDoc.documentId, jsonDoc.documentId],
        });
        issues.push({
          fingerprint: fp,
          issueType: 'MISSING_LINE_ITEM',
          field: 'lineItems',
          lineReference: unA.lineReference,
          normalizedSku: unA.sku,
          docVersionIds: [pdfDoc.documentId, jsonDoc.documentId],
          message: `SKU ${unA.sku} present in PDF is missing in JSON order`,
          isBlocking: false,
        });
      }

      // Missing in PDF
      for (const unB of matchRes.unmatchedB) {
        const fp = computeIssueFingerprint({
          issueType: 'MISSING_LINE_ITEM',
          field: 'lineItems',
          normalizedSku: unB.sku,
          docVersionIds: [pdfDoc.documentId, jsonDoc.documentId],
        });
        issues.push({
          fingerprint: fp,
          issueType: 'MISSING_LINE_ITEM',
          field: 'lineItems',
          lineReference: unB.lineReference,
          normalizedSku: unB.sku,
          docVersionIds: [pdfDoc.documentId, jsonDoc.documentId],
          message: `SKU ${unB.sku} present in JSON order is missing in PDF`,
          isBlocking: false,
        });
      }

      // Check matched line values
      for (const pair of matchRes.matchedPairs) {
        const dQtyA = new Decimal(pair.lineA.qty);
        const dQtyB = new Decimal(pair.lineB.qty);
        if (!dQtyA.equals(dQtyB)) {
          const fp = computeIssueFingerprint({
            issueType: 'QUANTITY_MISMATCH',
            field: 'quantity',
            normalizedSku: pair.sku,
            docVersionIds: [pdfDoc.documentId, jsonDoc.documentId],
          });
          issues.push({
            fingerprint: fp,
            issueType: 'QUANTITY_MISMATCH',
            field: 'quantity',
            lineReference: pair.lineA.lineReference || pair.lineB.lineReference,
            normalizedSku: pair.sku,
            docVersionIds: [pdfDoc.documentId, jsonDoc.documentId],
            candidateValues: {
              [pdfDoc.documentId]: pair.lineA.qty,
              [jsonDoc.documentId]: pair.lineB.qty,
            },
            message: `Quantity mismatch for SKU ${pair.sku}: PDF=${pair.lineA.qty}, JSON=${pair.lineB.qty}`,
            isBlocking: false,
          });
        }

        if (pair.lineA.unitPrice && pair.lineB.unitPrice) {
          const dPriceA = new Decimal(pair.lineA.unitPrice);
          const dPriceB = new Decimal(pair.lineB.unitPrice);
          if (!dPriceA.equals(dPriceB)) {
            const fp = computeIssueFingerprint({
              issueType: 'PRICE_MISMATCH',
              field: 'unitPrice',
              normalizedSku: pair.sku,
              docVersionIds: [pdfDoc.documentId, jsonDoc.documentId],
            });
            issues.push({
              fingerprint: fp,
              issueType: 'PRICE_MISMATCH',
              field: 'unitPrice',
              lineReference: pair.lineA.lineReference || pair.lineB.lineReference,
              normalizedSku: pair.sku,
              docVersionIds: [pdfDoc.documentId, jsonDoc.documentId],
              candidateValues: {
                [pdfDoc.documentId]: pair.lineA.unitPrice,
                [jsonDoc.documentId]: pair.lineB.unitPrice,
              },
              message: `Price mismatch for SKU ${pair.sku}: PDF=${pair.lineA.unitPrice}, JSON=${pair.lineB.unitPrice}`,
              isBlocking: false,
            });
          }
        }
      }
    }

    // F. Email vs Complete Document (PDF, or JSON if PDF not yet present)
    const completeDocForEmail = pdfDoc || jsonDoc;
    if (emailDoc && completeDocForEmail) {
      const emailLines: LineForMatch[] = emailDoc.normalizedLines
        .filter((l) => l.normalizedSku)
        .map((l) => ({
          sku: l.normalizedSku!,
          qty: l.quantity || '0',
          unitPrice: l.unitPrice,
          uom: l.normalizedUom,
          lineReference: l.lineReference,
        }));

      const compLines: LineForMatch[] = completeDocForEmail.normalizedLines
        .filter((l) => l.normalizedSku)
        .map((l) => ({
          sku: l.normalizedSku!,
          qty: l.quantity || '0',
          unitPrice: l.unitPrice,
          uom: l.normalizedUom,
          lineReference: l.lineReference,
        }));

      const matchRes = matchDocumentLines(emailLines, compLines);
      totalLinesChecked += matchRes.matchedPairs.length;

      // Completeness rule: Item in Email missing in complete document is MISMATCH
      for (const unEmail of matchRes.unmatchedA) {
        const fp = computeIssueFingerprint({
          issueType: completeDocForEmail.sourceType === 'PDF'
            ? 'ITEM_IN_EMAIL_MISSING_FROM_COMPLETE_PDF'
            : 'ITEM_IN_EMAIL_MISSING_FROM_COMPLETE_JSON',
          field: 'lineItems',
          normalizedSku: unEmail.sku,
          docVersionIds: [emailDoc.documentId, completeDocForEmail.documentId],
        });
        issues.push({
          fingerprint: fp,
          issueType: completeDocForEmail.sourceType === 'PDF'
            ? 'ITEM_IN_EMAIL_MISSING_FROM_COMPLETE_PDF'
            : 'ITEM_IN_EMAIL_MISSING_FROM_COMPLETE_JSON',
          field: 'lineItems',
          lineReference: unEmail.lineReference,
          normalizedSku: unEmail.sku,
          docVersionIds: [emailDoc.documentId, completeDocForEmail.documentId],
          message: `SKU ${unEmail.sku} ordered in email is missing from complete ${completeDocForEmail.sourceType}`,
          isBlocking: false,
        });
      }

      // Check matched line values between email and complete doc
      for (const pair of matchRes.matchedPairs) {
        if (pair.lineA.qty && pair.lineB.qty) {
          const dQtyA = new Decimal(pair.lineA.qty);
          const dQtyB = new Decimal(pair.lineB.qty);
          if (!dQtyA.equals(dQtyB)) {
            const fp = computeIssueFingerprint({
              issueType: 'QUANTITY_MISMATCH',
              field: 'quantity',
              normalizedSku: pair.sku,
              docVersionIds: [emailDoc.documentId, completeDocForEmail.documentId],
            });
            issues.push({
              fingerprint: fp,
              issueType: 'QUANTITY_MISMATCH',
              field: 'quantity',
              lineReference: pair.lineA.lineReference || pair.lineB.lineReference,
              normalizedSku: pair.sku,
              docVersionIds: [emailDoc.documentId, completeDocForEmail.documentId],
              candidateValues: {
                [emailDoc.documentId]: pair.lineA.qty,
                [completeDocForEmail.documentId]: pair.lineB.qty,
              },
              message: `Quantity mismatch between Email (${pair.lineA.qty}) and ${completeDocForEmail.sourceType} (${pair.lineB.qty}) for SKU ${pair.sku}`,
              isBlocking: false,
            });
          }
        }
      }
    }
  }

  // 3. Review Decisions Resolution Check (Fix 3 & Fix 5)
  let activeDecisions: Array<{ issue_fingerprint: string }> = [];
  let previousCaseStatus: string | null = null;

  if (caseId) {
    const caseRow = db.prepare('SELECT status FROM processing_cases WHERE id = ?').get(caseId) as any;
    if (caseRow) {
      previousCaseStatus = caseRow.status;
    }

    // Active review decisions: insert-only, superseded_by IS NULL
    activeDecisions = db.prepare(`
      SELECT issue_fingerprint
      FROM review_decisions
      WHERE case_id = ? AND superseded_by IS NULL
    `).all(caseId) as Array<{ issue_fingerprint: string }>;
  }

  const activeFingerprints = new Set(activeDecisions.map((d) => d.issue_fingerprint));

  for (const issue of issues) {
    if (activeFingerprints.has(issue.fingerprint)) {
      issue.isResolvedByReview = true;
    } else {
      issue.isResolvedByReview = false;
    }
  }

  // 4. Case Status Evaluation
  const receivedSources = new Set(documents.map((d) => d.source.sourceType));
  const pendingSources = expectedSources.filter((s) => !receivedSources.has(s as any));
  const hasPendingSources = pendingSources.length > 0;

  const unresolvedBlocking = issues.some((i) => i.isBlocking && !i.isResolvedByReview);
  const unresolvedMismatches = issues.some((i) => !i.isResolvedByReview);
  const wasPreviouslyResolved = previousCaseStatus === 'RESOLVED';
  const allResolvedByReview = issues.length > 0 && issues.every((i) => i.isResolvedByReview);

  const statusResult = evaluateCaseStatus({
    hasBlockingIssues: unresolvedBlocking,
    hasMismatches: unresolvedMismatches,
    hasPendingExpectedSources: hasPendingSources,
    pendingSources,
    isResolved: allResolvedByReview || wasPreviouslyResolved,
    hasDocuments: documents.length > 0,
  });

  const summary: ReconcilerSummary = {
    documentsCompared: docIds,
    linesChecked: totalLinesChecked,
    mismatchesCount: issues.length,
    blockingIssuesCount: issues.filter((i) => i.isBlocking).length,
    unresolvedIssuesCount: issues.filter((i) => !i.isResolvedByReview).length,
    arithmeticStatus: arithmeticValid ? 'VALID' : 'INVALID',
  };

  return {
    status: statusResult.status,
    isWaitingForJson: statusResult.isWaitingForJson,
    wasReopened: statusResult.wasReopened,
    pendingSources,
    issues,
    summary,
  };
}
