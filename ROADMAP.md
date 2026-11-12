# 3OCR Engineering Roadmap & Backlog

This document tracks active engineering milestones, completed phases, and explicitly deferred backlog tasks.

---

## Milestone 1: OCR-01 — Tesseract OCR Integration

Status: `COMPLETED`  
Priority: `HIGH`  
Target: Add scanned-PDF and mixed-PDF support via Tesseract OCR without breaking digital PDF extraction, deterministic evidence verification, or reconciliation.

### Completed Tasks
- [x] Phase 0: Baseline Survey & Code Inspection (`ROADMAP_AUDIT_REPORT.md`, clean working tree, baseline 28 test suites / 178 tests passing)
- [x] Phase 1: OCR Provider Architecture (`src/ocr/ocrProvider.ts`, `src/ocr/tesseractProvider.ts`, `src/ocr/ocrResult.schema.ts`)
- [x] Phase 2: PDF Page Text Detection & Rendering (`src/ocr/pdfPreprocessor.ts`, `src/ocr/ocrService.ts`)
- [x] Phase 3: Stage A Evidence & Schema Integration (`src/core/schema/stageA.schema.ts`, `src/extractors/pdfExtractor.ts`)
- [x] Phase 4: OCR Quality Gating & Failure Handling (`src/ocr/ocrQualityChecker.ts`, `src/core/verification/evidenceVerifier.ts`)
- [x] Phase 5: Comprehensive Testing & Zero-Regression Verification (`tests/ocr.test.ts` 9/9 passing, 29 test suites / 187 tests passing total)

---

## Milestone 2: SEC-01 — API Authentication & RBAC Middleware

Status: `COMPLETED`  
Priority: `HIGH`  
Target: Protect sensitive API endpoints with token-based authentication and role-based access control.

### Completed Tasks
- [x] Auth Module & Token Registry (`src/api/auth/types.ts`, `src/api/auth/tokenRegistry.ts`)
- [x] Express Authentication & Role Middleware (`src/api/auth/authMiddleware.ts`, `src/api/auth/index.ts`)
- [x] Route Security & Role Gating (`src/api/app.ts`):
  - Ingestion & Case Linking (`/api/documents`, `/api/documents/:id/link`): requires `OPERATOR` or `ADMIN`.
  - Reconcile & Queue Resolution (`/api/cases/:id/reconcile`, `/api/queues/:id/resolve`): requires `OPERATOR` or `ADMIN`.
  - Review Overrides (`/api/cases/:id/review`): requires `OPERATOR` or `ADMIN` (AUDITOR blocked with 403).
  - Audit Trail (`/api/cases/:id/audit`): restricted to `AUDITOR` and `ADMIN`.
  - Case & Ingestion Inspection (`/api/cases`, `/api/cases/:id`, `/api/ingestions/:id`): accessible to `OPERATOR`, `AUDITOR`, and `ADMIN`.
  - Public Dashboard UI (`/`, `/dashboard`): accessible without auth.
- [x] Unit & Integration Tests (`tests/auth.test.ts` 9/9 passing, 30 test suites / 196 tests passing total).

---

## Explicitly Deferred Backlog Tasks

The following tasks are deliberately postponed, NOT cancelled. They must remain preserved in the backlog.

### DEFERRED — EMAIL WEBHOOK AUTHENTICATION
- Verify inbound email webhook authenticity.
- Validate provider signatures using trusted verification mechanisms.
- Never trust SPF/DKIM status supplied directly in an unverified request body.
- Add replay protection where appropriate.
- Add webhook-specific tests.
Status: NOT_STARTED  
Priority: DEFERRED  

### DEFERRED — SAP / ERP EXPORT INTEGRATION
- Implement SAP RFC / OData export adapter for reconciled order confirmations.
- Support bidirectional synchronization of PO status with enterprise ERP backends.
- Add retry policies, dead-letter queues, and ERP export transaction auditing.
Status: NOT_STARTED  
Priority: DEFERRED  

---

## Historical Phase Summary

- **Phase 0 (Foundation & Baseline):** [COMPLETED] 28 test suites, 178 tests passing.
- **Phase 1 (Canonical Schema & Document Model):** [COMPLETED] Stage A Document schema, multi-document lifecycle.
- **Phase 2 (Deterministic Evidence Verification):** [COMPLETED] Token boundary verification, exact substring verification, decimal equivalence.
- **Phase 3 (Deterministic Reconciliation):** [COMPLETED] SKU matching, header arithmetic, GST/tax validation, order-independent reconciliation.
- **Milestone 1 (OCR-01 Tesseract Integration):** [COMPLETED] 29 test suites, 187 tests passing (zero regressions, 9 new OCR tests).
- **Milestone 2 (SEC-01 API Auth & RBAC Middleware):** [COMPLETED] 30 test suites, 196 tests passing (zero regressions, 9 new auth tests).
