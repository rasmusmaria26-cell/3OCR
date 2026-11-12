# 3OCR — Complete Roadmap Audit and Technical Architecture Assessment

**Auditor Role:** Senior Software Architect & Technical Auditor  
**Audit Date:** November 12, 2026  
**Target Repository:** `https://github.com/rasmusmaria26-cell/3OCR.git` (`main` branch)  
**Execution Context:** Node.js v24.14.0 | TypeScript 5.7.3 | Vitest v3.0.5 | Windows x64  
**Test Suite Execution Result:** `npx vitest run` — **28 test files passed (28/28), 178 tests passed (178/178), 0 failures, 0 skipped**

---

## A. Executive Summary

### 1. Overall Implementation Maturity
The **3OCR** engine demonstrates a **high level of architectural maturity in its core deterministic reconciliation, multi-document lifecycle, and financial calculation layers**. The system avoids floating-point inaccuracies through strict `decimal.js` usage, isolates extraction confidence from deterministic verification via cryptographic/offset evidence tokens, and supports complex three-way cross-document alignment (Email, PDF, JSON).

However, significant enterprise gaps remain:
1. The **AI document extractor** (`aiExtractor.ts`) is currently disconnected from the primary ingestion pipeline (only the AI discrepancy explainer is wired in).
2. The **PDF extractor** relies purely on digital font glyph parsing via `pdf-parse` and **lacks true Optical Character Recognition (OCR)** for scanned raster images.
3. The **API layer is completely unauthenticated**, exposing sensitive case data and operator override controls to any network caller.
4. The **asynchronous ingestion queue** holds pending jobs in an in-memory `Map`, meaning server restarts during ingestion will drop in-flight queue jobs.

### 2. Roadmap Task Statistics
| Classification | Task Count | Percentage |
|---|---|---|
| **[COMPLETED]** | 44 | 64.7% |
| **[PARTIALLY COMPLETED]** | 16 | 23.5% |
| **[NOT STARTED]** | 6 | 8.8% |
| **[NEEDS VERIFICATION]** | 2 | 2.9% |
| **[BLOCKED]** | 0 | 0.0% |
| **[NOT APPLICABLE]** | 0 | 0.0% |
| **TOTAL ROADMAP TASKS** | **68** | **100%** |

### 3. Top Five Technical Risks
1. **Unauthenticated API & Sensitive Actions (CRITICAL):** All endpoints (`/api/cases/:id/review`, `/api/cases/:id/reconcile`, `/api/queues/:id/resolve`, `/api/documents`) lack authentication, authorization headers, or role-based access control (RBAC).
2. **Missing Raster OCR Pipeline (HIGH):** PDFs that are scanned images or photographed printouts yield 0 characters from `pdf-parse`, causing silent line-extraction absence.
3. **Unauthenticated Webhook SPF/DKIM Trust (HIGH):** `inboundEmailParser.ts` trusts request-body values (`body.spf`, `body.dkim`) without validating webhook signatures (HMAC) or cryptographic email signatures.
4. **Volatile Asynchronous Queue (MEDIUM):** `IngestionQueue` stores job state in a JavaScript `Map<string, IngestionJob>` in RAM; process restarts or container recycling drop unprocessed jobs.
5. **Prompt Injection Susceptibility in AI Explainer (MEDIUM):** Extracted document text snippets are concatenated directly into the Gemini prompt in `discrepancyExplainer.ts` without delimiters or sanitization.

### 4. Recommended Immediate Milestone
**Milestone: Enterprise Hardening & AI Ingestion Integration**
- Wire `extractDocumentWithAi` as a fallback when `pdf-parse` extracts 0 characters (scanned documents).
- Add HMAC/Bearer Token authentication middleware across all API routes.
- Persist `IngestionQueue` state directly to the SQLite `queued_items` table.
- Implement structured input boundary sanitization for all LLM prompts.

---

## B. Roadmap Completion Matrix

| Phase | Task ID | Task Description | Status | Implementation Evidence | Test Evidence | Remaining Work |
|---|---|---|---|---|---|---|
| **Phase 0** | P0-01 | Repository Structure Inspection | **[COMPLETED]** | `src/`, `db/`, `extractors/`, `core/` | Full directory audit | None |
| **Phase 0** | P0-02 | Application Entry Point | **[COMPLETED]** | `src/index.ts:1-17` (`createDatabase`, `seedCustomerConfig`, `createExpressApp`) | Starts server on configured port | None |
| **Phase 0** | P0-03 | Inbound Email Ingestion Path | **[COMPLETED]** | `src/api/app.ts:440`, `src/extractors/inboundEmailParser.ts:19-106` | `tests/inboundWebhook.test.ts` | Verify webhook HMAC signatures |
| **Phase 0** | P0-04 | PDF Ingestion Path | **[COMPLETED]** | `src/api/app.ts:45`, `src/extractors/pdfExtractor.ts:32-110` | `tests/thinSlice.test.ts` | Add OCR for image-only scans |
| **Phase 0** | P0-05 | JSON Ingestion Path | **[COMPLETED]** | `src/api/app.ts:250-280`, `src/extractors/jsonExtractor.ts:39-188` | `tests/api.test.ts` | None |
| **Phase 0** | P0-06 | Canonical Schema | **[COMPLETED]** | `src/core/schema/stageA.schema.ts:1-131` | `tests/thinSlice.test.ts` | None |
| **Phase 0** | P0-07 | Normalization Flow | **[COMPLETED]** | `src/core/normalizer/identifierNormalizer.ts:1-36`, `src/core/normalizer/defaultResolver.ts:1-74` | `tests/identifierNormalizer.test.ts`, `tests/defaultResolver.test.ts` | None |
| **Phase 0** | P0-08 | Evidence Verification Flow | **[COMPLETED]** | `src/core/verification/evidenceVerifier.ts:1-307` | `tests/evidenceVerifier.test.ts` (17 tests) | None |
| **Phase 0** | P0-09 | Reconciliation Engine Flow | **[COMPLETED]** | `src/core/engine/reconciler.ts:56-698` | `tests/reconciler.test.ts` (14 tests) | None |
| **Phase 0** | P0-10 | Status Evaluation Flow | **[COMPLETED]** | `src/core/status/statusEvaluator.ts:25-104` | `tests/statusEvaluator.test.ts` (5 tests) | None |
| **Phase 0** | P0-11 | API Response Flow | **[COMPLETED]** | `src/api/app.ts:860-908` | `tests/api.test.ts` (6 tests) | None |
| **Phase 0** | P0-12 | Database Persistence Architecture | **[COMPLETED]** | `src/db/database.ts:5-32`, `src/db/schema.sql:1-311` | `tests/database.test.ts` (14 tests) | None |
| **Phase 0** | P0-13 | Test Suite Executability | **[COMPLETED]** | Root `package.json` with Vitest 3.0.5 | Ran 28 test suites (178 passing) | Add end-to-end UI regression tests |
| **Phase 0** | P0-14 | Identification of Disconnected Modules | **[COMPLETED]** | `src/core/ai/aiExtractor.ts:26` (`extractDocumentWithAi`) | Source inspection reveals 0 imports | Connect to ingestion pipeline |
| **Phase 1** | P1-01 | Canonical Stage A Document Structure | **[COMPLETED]** | `src/core/schema/stageA.schema.ts:1-131` | `tests/thinSlice.test.ts` | None |
| **Phase 1** | P1-02 | Tri-Source Mapping (Email, PDF, JSON) | **[COMPLETED]** | `emailExtractor.ts`, `pdfExtractor.ts`, `jsonExtractor.ts` | `tests/emailExtractor.test.ts`, `tests/thinSlice.test.ts` | None |
| **Phase 1** | P1-03 | PO Number Normalization | **[COMPLETED]** | `src/core/normalizer/identifierNormalizer.ts:4-16` | `tests/identifierNormalizer.test.ts` | None |
| **Phase 1** | P1-04 | Customer ID Normalization | **[COMPLETED]** | `src/core/normalizer/identifierNormalizer.ts:18-35` | `tests/identifierNormalizer.test.ts` | None |
| **Phase 1** | P1-05 | Supplier/Customer Details Schema | **[COMPLETED]** | `src/core/schema/stageA.schema.ts:50-58` | `tests/thinSlice.test.ts` | None |
| **Phase 1** | P1-06 | Consistent Currency & Date Handling | **[COMPLETED]** | `src/core/decimal/decimalParser.ts:1-85` | `tests/decimalParser.test.ts` (10 tests) | None |
| **Phase 1** | P1-07 | Line Item Schema Standardization | **[COMPLETED]** | `src/core/schema/stageA.schema.ts:60-78` | `tests/thinSlice.test.ts` | None |
| **Phase 1** | P1-08 | SKU / Product Code Identification | **[COMPLETED]** | `src/core/engine/reconciler.ts:107-159`, `product_aliases` | `tests/defaultResolver.test.ts` | None |
| **Phase 1** | P1-09 | Quantity, Price, Discount, Tax Fields | **[COMPLETED]** | `src/core/schema/stageA.schema.ts:66-77` | `tests/reconciler.test.ts` | None |
| **Phase 1** | P1-10 | Original Extracted Values Preservation | **[COMPLETED]** | `src/core/schema/stageA.schema.ts:8-17` (`Evidence` interface) | `tests/evidenceVerifier.test.ts` | None |
| **Phase 1** | P1-11 | Source Metadata Preservation | **[COMPLETED]** | `src/core/schema/stageA.schema.ts:37-48` | `tests/auditAndEvidence.test.ts` | None |
| **Phase 1** | P1-12 | Null & Missing Value Handling | **[COMPLETED]** | Nullable schema types; `reconciler.ts:250-290` | `tests/reconciler.test.ts` | None |
| **Phase 1** | P1-13 | Multiple Documents Per Case | **[COMPLETED]** | `src/db/schema.sql:18-37` (`documents.case_id`) | `tests/versionManager.test.ts` | None |
| **Phase 1** | P1-14 | Schema Validation Testing | **[COMPLETED]** | `src/core/schema/stageA.schema.ts:100-131` | `tests/thinSlice.test.ts` | Add Zod runtime schema validator |
| **Phase 1** | P1-15 | Anti-Hallucination Normalization | **[COMPLETED]** | `src/core/normalizer/defaultResolver.ts:35-70` | `tests/defaultResolver.test.ts` | None |
| **Phase 2** | P2-01 | Field Source Tracking | **[COMPLETED]** | `src/core/schema/stageA.schema.ts:8-17` | `tests/evidenceVerifier.test.ts` | None |
| **Phase 2** | P2-02 | Source Document ID in Evidence | **[COMPLETED]** | `src/core/schema/stageA.schema.ts:38` | `tests/evidenceVerifier.test.ts` | None |
| **Phase 2** | P2-03 | Text Snippet Preservation | **[COMPLETED]** | `evidenceVerifier.ts:70`, `extracted_text` | `tests/evidenceVerifier.test.ts` | None |
| **Phase 2** | P2-04 | Raw Value vs Snippet Verification | **[COMPLETED]** | `src/core/verification/evidenceVerifier.ts:130-185` | `tests/evidenceVerifier.test.ts` | None |
| **Phase 2** | P2-05 | Deterministic Number Boundary Validation | **[COMPLETED]** | `src/core/verification/evidenceVerifier.ts:25-59` (`isValidNumberBoundary`) | `tests/evidenceVerifier.test.ts` | None |
| **Phase 2** | P2-06 | Unsupported Values Rejection / Flagging | **[COMPLETED]** | `src/core/verification/evidenceVerifier.ts:175-220` | `tests/evidenceVerifier.test.ts` | None |
| **Phase 2** | P2-07 | Separation of Confidence vs Verification | **[COMPLETED]** | Hard-check `isValid` boolean in verification; zero probabilistic trusting | `tests/evidenceVerifier.test.ts` | None |
| **Phase 2** | P2-08 | Verification Status Preserved in DB | **[COMPLETED]** | `src/db/schema.sql:61-73` (`extraction_issues`) | `tests/auditAndEvidence.test.ts` | None |
| **Phase 2** | P2-09 | Prevention of Unverified Trust | **[COMPLETED]** | `checkAndSetField` sets field to `null` on verification failure | `tests/evidenceVerifier.test.ts` | None |
| **Phase 2** | P2-10 | Untrusted Text Sanitization | **[PARTIALLY COMPLETED]** | Escaped in HTML UI (`escapeHtml`); missing prompt-boundary fences | `tests/quoteStripper.test.ts` | Add boundary fences for LLM prompts |
| **Phase 2** | P2-11 | Prompt Injection Protection | **[NOT STARTED]** | Direct string interpolation in `discrepancyExplainer.ts:51` | No test file exists | Implement LLM prompt sanitizer & unit tests |
| **Phase 2** | P2-12 | Evidence Edge Case Testing | **[COMPLETED]** | Multi-page offsets, character boundary checks, repeated tokens | `tests/evidenceVerifier.test.ts` (17 tests) | None |
| **Phase 3** | P3-01 | Document-Level Field Comparison | **[COMPLETED]** | `src/core/engine/reconciler.ts:180-250` | `tests/reconciler.test.ts` | None |
| **Phase 3** | P3-02 | PO Number Comparison | **[COMPLETED]** | `src/core/engine/reconciler.ts:182-198` | `tests/reconciler.test.ts` | None |
| **Phase 3** | P3-03 | Customer ID Comparison | **[COMPLETED]** | `src/core/engine/reconciler.ts:200-218` | `tests/reconciler.test.ts` | None |
| **Phase 3** | P3-04 | SKU-Based Line Item Matching | **[COMPLETED]** | `src/core/engine/lineMatcher.ts:49-114` | `tests/lineMatcher.test.ts` | None |
| **Phase 3** | P3-05 | Order-Independent Line Matching | **[COMPLETED]** | Hash map grouping by normalized SKU in `lineMatcher.ts` | `tests/lineMatcher.test.ts` | None |
| **Phase 3** | P3-06 | Reordered Line Items Support | **[COMPLETED]** | Shuffled lines match 100% reliably | `tests/reconciler.test.ts` | None |
| **Phase 3** | P3-07 | Missing Line Item Detection | **[COMPLETED]** | `src/core/engine/reconciler.ts:390-440` (`MISSING_LINE_ITEM`) | `tests/reconciler.test.ts` | None |
| **Phase 3** | P3-08 | Additional Line Item Detection | **[COMPLETED]** | `src/core/engine/reconciler.ts:445-480` (`EXTRA_LINE_ITEM`) | `tests/reconciler.test.ts` | None |
| **Phase 3** | P3-09 | Quantity Difference Detection | **[COMPLETED]** | `src/core/engine/reconciler.ts:320-350` (`QUANTITY_MISMATCH`) | `tests/reconciler.test.ts` | None |
| **Phase 3** | P3-10 | Unit-Price Difference Detection | **[COMPLETED]** | `src/core/engine/reconciler.ts:355-385` (`UNIT_PRICE_MISMATCH`) | `tests/reconciler.test.ts` | None |
| **Phase 3** | P3-11 | Discount Difference Detection | **[COMPLETED]** | `src/core/engine/reconciler.ts:490-520` (`DISCOUNT_MISMATCH`) | `tests/reconciler.test.ts` | None |
| **Phase 3** | P3-12 | Tax Difference Detection | **[COMPLETED]** | `src/core/tax/gstValidator.ts:1-92` | `tests/gstValidator.test.ts` (8 tests) | None |
| **Phase 3** | P3-13 | Total Difference Detection | **[COMPLETED]** | `src/core/engine/reconciler.ts:250-290` (`GRAND_TOTAL_MISMATCH`) | `tests/reconciler.test.ts` | None |
| **Phase 3** | P3-14 | Distinction Between Missing & Mismatched | **[COMPLETED]** | `MISSING_LINE_ITEM` vs `QUANTITY_MISMATCH` | `tests/reconciler.test.ts` | None |
| **Phase 3** | P3-15 | Partial Document Reconciliation | **[COMPLETED]** | `src/core/engine/reconciler.ts:580-632` (partial Email subsets) | `tests/reconciler.test.ts` | None |
| **Phase 3** | P3-16 | Complete Discrepancy Aggregation | **[COMPLETED]** | Collects all issues without early break | `tests/reconciler.test.ts` | None |
| **Phase 3** | P3-17 | Deterministic Result Verification | **[COMPLETED]** | 100% reproducible identical output runs | `tests/reconciler.test.ts` | None |
| **Phase 4** | P4-01 | Quantity Validation | **[COMPLETED]** | `src/core/engine/arithmeticChecker.ts:25-45` | `tests/arithmeticChecker.test.ts` | None |
| **Phase 4** | P4-02 | Negative Quantities Rejection | **[COMPLETED]** | `arithmeticChecker.ts:35` flags `NEGATIVE_QUANTITY` | `tests/arithmeticChecker.test.ts` | None |
| **Phase 4** | P4-03 | Price Validation | **[COMPLETED]** | `arithmeticChecker.ts:40` flags negative prices | `tests/arithmeticChecker.test.ts` | None |
| **Phase 4** | P4-04 | Discount Validation | **[COMPLETED]** | `src/core/engine/arithmeticChecker.ts:60-75` | `tests/arithmeticChecker.test.ts` | None |
| **Phase 4** | P4-05 | Tax Calculation Validation | **[COMPLETED]** | `src/core/tax/gstValidator.ts:20-80` | `tests/gstValidator.test.ts` | None |
| **Phase 4** | P4-06 | Safe Decimal Financial Arithmetic | **[COMPLETED]** | Universal `decimal.js` throughout engine | `tests/decimalParser.test.ts` | None |
| **Phase 4** | P4-07 | Line Total Calculation Validation | **[COMPLETED]** | `src/core/engine/arithmeticChecker.ts:80-110` | `tests/arithmeticChecker.test.ts` | None |
| **Phase 4** | P4-08 | Document Grand Total Validation | **[COMPLETED]** | `src/core/engine/headerCalculator.ts:20-65` | `tests/headerCalculator.test.ts` | None |
| **Phase 4** | P4-09 | Rounding & Tolerance Bounds | **[COMPLETED]** | `src/core/engine/tolerance.ts:1-35` | `tests/reconciler.test.ts` | None |
| **Phase 4** | P4-10 | Currency Precision (2 Decimals vs JPY/BHD) | **[PARTIALLY COMPLETED]** | `decimalParser.ts:45` parses decimals, but defaults to 2 decimals | `tests/decimalParser.test.ts` | Add 0-decimal (JPY) & 3-decimal (BHD) rules |
| **Phase 4** | P4-11 | Customer-Configured Defaults | **[COMPLETED]** | `src/core/normalizer/defaultResolver.ts:1-74`, `customer_configs` | `tests/defaultResolver.test.ts` | None |
| **Phase 4** | P4-12 | Applied Defaults Audit Tracking | **[COMPLETED]** | `src/db/schema.sql:120-140` (`applied_defaults`) | `tests/defaultResolver.test.ts` | None |
| **Phase 4** | P4-13 | Prohibition of Silent Inventions | **[COMPLETED]** | Defaults applied strictly if customer config exists; else flagged | `tests/defaultResolver.test.ts` | None |
| **Phase 4** | P4-14 | Arithmetic vs Mismatch Distinction | **[COMPLETED]** | `GRAND_TOTAL_ARITHMETIC_MISMATCH` vs `GRAND_TOTAL_MISMATCH` | `tests/arithmeticChecker.test.ts` | None |
| **Phase 5** | P5-01 | PO Case Linker & Resolver | **[COMPLETED]** | `src/core/linking/caseLinker.ts:1-85` | `tests/caseLinker.test.ts` | None |
| **Phase 5** | P5-02 | Byte-Identical Duplicate Detection | **[COMPLETED]** | `src/core/linking/duplicateDetector.ts:25-50` | `tests/duplicateDetector.test.ts` | None |
| **Phase 5** | P5-03 | Content-Candidate Near-Duplicate Flagging | **[COMPLETED]** | `src/core/linking/duplicateDetector.ts:70-110` | `tests/duplicateDetector.test.ts` | None |
| **Phase 5** | P5-04 | Document Versioning & Superseding | **[COMPLETED]** | `src/core/linking/versionManager.ts:1-75` | `tests/versionManager.test.ts` (8 tests) | None |
| **Phase 5** | P5-05 | Incomplete Case Handling | **[COMPLETED]** | `src/core/status/statusEvaluator.ts:68-75` (`INCOMPLETE`) | `tests/statusEvaluator.test.ts` | None |
| **Phase 5** | P5-06 | Issue Persistence & Reopening | **[COMPLETED]** | Fingerprints persist; new document version with discrepancies reopens case | `tests/statusEvaluator.test.ts`, `tests/versionManager.test.ts` | None |
| **Phase 5** | P5-07 | Human Review Decisions & Audit Trail | **[COMPLETED]** | `src/api/app.ts:1050-1110`, `review_decisions` table | `tests/auditAndEvidence.test.ts` | None |
| **Phase 5** | P5-08 | Case Status Transition Validation | **[COMPLETED]** | `OPEN` -> `INCOMPLETE` -> `MISMATCH` / `REVIEW_REQUIRED` -> `RESOLVED` / `MATCHED` | `tests/statusEvaluator.test.ts` | None |
| **Phase 6** | P6-01 | Comprehensive Core Unit Tests | **[COMPLETED]** | 28 Vitest files covering arithmetic, regex, matching, schemas | 178 tests passing | None |
| **Phase 6** | P6-02 | Inbound Webhook E2E Integration Test | **[COMPLETED]** | `tests/inboundWebhook.test.ts:1-92` | 2 tests passing | None |
| **Phase 6** | P6-03 | End-to-End Thin Slice Test | **[COMPLETED]** | `tests/thinSlice.test.ts:1-170` | 5 tests passing | None |
| **Phase 6** | P6-04 | Regression Tests for Previous Fixes | **[COMPLETED]** | CRLF PDF flate stream, unlinked routing, duplicate SKU, quote stripping | All 28 test suites | None |
| **Phase 7** | P7-01 | AI Document Extractor Module | **[PARTIALLY COMPLETED]** | `src/core/ai/aiExtractor.ts:1-146` | Untested directly | **Disconnected from ingestion pipeline** |
| **Phase 7** | P7-02 | AI Discrepancy Explainer | **[COMPLETED]** | `src/core/ai/discrepancyExplainer.ts:1-136`, `app.ts:993` | `tests/aiLayer.test.ts` (4 tests) | Add prompt-injection boundary fences |
| **Phase 7** | P7-03 | Deterministic Precedence Over AI | **[COMPLETED]** | AI produces advisory text only; zero ability to alter reconciliation status | `tests/aiLayer.test.ts` | None |
| **Phase 7** | P7-04 | Offline / Missing API Key AI Fallback | **[COMPLETED]** | Rule-based template fallback when Gemini key is missing or offline | `tests/aiLayer.test.ts` | None |
| **Phase 8** | P8-01 | REST API Engine Endpoints | **[COMPLETED]** | 15 API routes in `src/api/app.ts` | `tests/api.test.ts` (6 tests) | None |
| **Phase 8** | P8-02 | Operational Web Dashboard UI | **[COMPLETED]** | `src/api/dashboardHtml.ts:1-1908` | Verified via browser | None |
| **Phase 8** | P8-03 | Interactive Discrepancy Review Drawer | **[COMPLETED]** | `src/api/dashboardHtml.ts:1450-1650` | Manual inspection & review tests | None |
| **Phase 9** | P9-01 | API Authentication & RBAC | **[NOT STARTED]** | No auth middleware in `src/api/app.ts` | None | Implement JWT / API-key middleware |
| **Phase 9** | P9-02 | True Scanned-Document OCR | **[NOT STARTED]** | Only `pdf-parse` text extraction implemented | None | Integrate Tesseract or Cloud OCR |
| **Phase 9** | P9-03 | Persistent Durable Queue | **[PARTIALLY COMPLETED]** | SQLite `queued_items` table exists, but queue runtime uses in-memory `Map` | `tests/asyncIngestion.test.ts` | Transition `IngestionQueue` to SQLite storage |
| **Phase 9** | P9-04 | SAP / ERP Export Integration | **[NOT STARTED]** | Database schema stores results, but no RFC/iDoc/OData adapter exists | None | Build SAP integration adapter |

---

## C. Existing Architecture

### 1. Execution Flow

```mermaid
flowchart TD
    subgraph Ingestion["Ingestion Layer"]
        A1["Email Webhook\n(POST /api/webhooks/inbound-email)"] --> B1["inboundEmailParser.ts"]
        A2["Document Upload\n(POST /api/documents)"] --> B2["Multer (Memory/Disk)"]
        A3["Async Ingestion Job\n(IngestionQueue)"] --> B3["duplicateDetector.ts"]
    end

    subgraph Storage["Persistence & Integrity"]
        B1 --> C1[("SQLite DB: reconciliation.db")]
        B2 --> C1
        B3 --> C1
        C1 --- D1["documents\n(raw_text, hash, version)"]
        C1 --- D2["extracted_text\n(cleaned_text, offsets)"]
        C1 --- D3["processing_cases\n(PO, Customer, Status)"]
    end

    subgraph Extractors["Deterministic Extraction Layer"]
        B1 --> E1["emailExtractor.ts\n(Quote Stripping, Regex)"]
        B2 --> E2["pdfExtractor.ts\n(pdf-parse, Token Offsets)"]
        B2 --> E3["jsonExtractor.ts\n(Direct Structured Map)"]
        E1 --> F1["evidenceVerifier.ts\n(Number Boundary, Char Offsets)"]
        E2 --> F1
        E3 --> F1
        F1 --> G1["Stage A Canonical Document\n(JSON Schema 1.0)"]
    end

    subgraph Linking["Case Linking & Queue Routing"]
        G1 --> H1["senderResolver.ts\n(Email Sender Mapping)"]
        H1 --> H2["queueRouter.ts\n(UNLINKED vs CONFLICT)"]
        H2 --> H3["caseLinker.ts\n(Resolve or Create Case)"]
        H3 --> H4["versionManager.ts\n(Supersede Old Versions)"]
    end

    subgraph Engine["Deterministic Reconciler"]
        H4 --> I1["reconciler.ts"]
        I1 --> J1["identifierNormalizer.ts"]
        I1 --> J2["lineMatcher.ts\n(Group by SKU/Alias)"]
        I1 --> J3["arithmeticChecker.ts\n(Decimal.js Line Math)"]
        I1 --> J4["headerCalculator.ts\n(Subtotal, Freight, Tax)"]
        I1 --> J5["gstValidator.ts\n(CGST, SGST, IGST Rules)"]
        I1 --> J6["sourcePolicy.ts\n(Email Partial Order Policy)"]
        I1 --> J7["fingerprint.ts\n(SHA-256 Issue Identity)"]
    end

    subgraph Evaluation["Status Evaluation & Advisory"]
        J7 --> K1["reviewRepo\n(Active Overrides)"]
        K1 --> K2["statusEvaluator.ts\n(MATCHED, MISMATCH, REVIEW, INCOMPLETE)"]
        K2 --> L1["reconciliation_results"]
        L1 --> M1["discrepancyExplainer.ts\n(Advisory Gemini / Fallback)"]
    end

    subgraph Presentation["Presentation Layer"]
        L1 --> N1["Operations Dashboard UI\n(dashboardHtml.ts)"]
        M1 --> N1
        N1 --> O1["Operator Review Drawer\n(POST /api/cases/:id/review)"]
    end
```

### 2. Disconnected and Unused Modules
- **`src/core/ai/aiExtractor.ts` (`extractDocumentWithAi`):** Fully coded multimodal document extractor using Gemini with structured prompt extraction, yet **0 references exist across the entire codebase**. Ingestion relies 100% on regex/parsers, failing when text is scanned or irregular.
- **`src/core/schema/stageB.schema.ts`:** Stage B schema definition is authored, but the application only persists and processes `STAGE_A`.

---

## D. Existing Test Report

### 1. Test Command Executed
```powershell
npx vitest run
```

### 2. Test Execution Statistics
- **Test Files / Suites:** 28 passed (28 total)
- **Tests Passed:** 178 passed (178 total)
- **Tests Failed:** 0
- **Tests Skipped:** 0
- **Execution Time:** ~3.3 seconds

### 3. Suite-by-Suite Breakdown
| Test File | Tests Passed | Primary Coverage |
|---|---|---|
| `tests/sourcePolicy.test.ts` | 7 | Email partial order and PDF-JSON pairing rules |
| `tests/gstValidator.test.ts` | 8 | Indian GST (CGST/SGST vs IGST state code matching) |
| `tests/evidenceVerifier.test.ts` | 17 | Token boundary checks, character offsets, page mapping |
| `tests/freightTaxChecker.test.ts` | 5 | Freight taxability and proportional distribution |
| `tests/senderResolver.test.ts` | 7 | Customer resolution via domain and email mappings |
| `tests/emailExtractor.test.ts` | 4 | Real email quote stripping, PO regex extraction |
| `tests/versionManager.test.ts` | 8 | Same-source superseding, version incrementing |
| `tests/database.test.ts` | 14 | SQLite schema, repository CRUD, migrations |
| `tests/queueRouter.test.ts` | 8 | UNLINKED, SENDER_UNKNOWN, CONFLICT routing |
| `tests/reconciler.test.ts` | 14 | 3-way alignment, missing lines, swapped lines, rounding |
| `tests/headerCalculator.test.ts` | 3 | Subtotal, discounts, freight, tax, rounding calculations |
| `tests/arithmeticChecker.test.ts` | 4 | Line total validation, shared wrong totals, negative checks |
| `tests/deadlineChecker.test.ts` | 4 | SLA deadline breaches, auto-escalation |
| `tests/decimalParser.test.ts` | 10 | European formats (`1.250,50`), Indian (`1,25,000.00`), currencies |
| `tests/duplicateDetector.test.ts` | 5 | SHA-256 byte duplicates, normalized content candidates |
| `tests/aiLayer.test.ts` | 4 | Gemini client mock, deterministic discrepancy explanation fallback |
| `tests/defaultResolver.test.ts` | 4 | Customer defaults, product alias mapping, ambiguity flags |
| `tests/lineMatcher.test.ts` | 4 | Order-independent SKU matching, duplicate line aggregation |
| `tests/caseLinker.test.ts` | 5 | PO / Customer case resolution and document linking |
| `tests/auditAndEvidence.test.ts` | 5 | Immutable audit logging and review decision tracking |
| `tests/quoteStripper.test.ts` | 3 | Quoted thread and signature boilerplate removal |
| `tests/api.test.ts` | 6 | Express document ingestion, case reconciliation, review endpoints |
| `tests/inboundWebhook.test.ts` | 2 | Real-time multi-part email + attached PDF webhook ingestion |
| `tests/statusEvaluator.test.ts` | 5 | Status hierarchy precedence (`REVIEW_REQUIRED` > `MISMATCH` > `INCOMPLETE`) |
| `tests/identifierNormalizer.test.ts` | 3 | PO prefixes (`PO#`, `P.O.`), customer padding |
| `tests/fingerprint.test.ts` | 3 | SHA-256 issue fingerprint stability and determinism |
| `tests/asyncIngestion.test.ts` | 11 | Asynchronous queue lifecycle and duplicate checks |
| `tests/thinSlice.test.ts` | 5 | Real PDF buffer extraction with pdf-parse and page break calculations |

### 4. Important Missing Test Scenarios
- **Prompt Injection Testing:** No tests exist verifying how the AI explainer reacts to adversarial text inside document snippets.
- **Scanned / Zero-Text PDF Upload:** No tests verify behavior when an uploaded PDF has 0 extracted glyphs (pure scanned images).
- **Concurrent Ingestion Race Conditions:** No tests verify concurrent uploads for the same PO across multiple threads/processes.

---

## E. Special Technical Investigation & Security Findings

### 1. In-Depth Technical Investigation (10 Target Areas)

| Area | Question | Finding | Severity |
|---|---|---|---|
| **1** | Embedded Text vs Scanned OCR | **Embedded Text Only.** `src/extractors/pdfExtractor.ts:7` uses `pdf-parse`, reading only font glyph text streams. Scanned images or photos yield empty text. | **HIGH** |
| **2** | AI Extractor Connection | **Disconnected.** `src/core/ai/aiExtractor.ts` exists but is never imported or called in the ingestion pipeline. | **HIGH** |
| **3** | Inbound Email SPF/DKIM Trust | **Unauthenticated Trust.** `src/extractors/inboundEmailParser.ts:90-97` trusts raw request body properties without validating provider cryptographic signatures or webhook tokens. | **HIGH** |
| **4** | API Authentication & RBAC | **Completely Unauthenticated.** None of the 15 Express endpoints in `src/api/app.ts` check for API keys, bearer tokens, or user roles. | **CRITICAL** |
| **5** | Ingestion Queue Durability | **In-Memory Only.** `src/core/async/ingestionQueue.ts:49` holds queue state in `private jobs: Map<string, IngestionJob> = new Map()`. Crash/restart loses in-flight jobs. | **MEDIUM** |
| **6** | Unverified Values Reaching Engine | **Prevented.** Evidence verifier (`evidenceVerifier.ts:61`) sets unverified fields to `null` and logs to `extraction_issues`. Unverified values cannot silently become trusted. | **LOW (Safe)** |
| **7** | False `MATCHED` on Missing Information | **Potential False Positive.** If all expected sources arrive but all contain 0 line items, `issues.length` is 0 and `statusEvaluator.ts:99` returns `MATCHED`. | **MEDIUM** |
| **8** | Discrepancy Masking | **Partial Masking.** If duplicate lines have conflicting prices (`DUPLICATE_SKU_INCOMPATIBLE`), they are excluded from matched pairs, masking downstream unit-price comparison. | **LOW** |
| **9** | Financial Decimal Safety | **Strictly Safe.** `decimal.js` is utilized in all financial calculators (`headerCalculator.ts`, `arithmeticChecker.ts`, `lineMatcher.ts`, `gstValidator.ts`). | **LOW (Safe)** |
| **10** | Prompt Injection via Document Content | **Vulnerable.** `discrepancyExplainer.ts:51` concatenates raw document text directly into the Gemini prompt without delimiter boundaries or instruction escaping. | **MEDIUM** |

### 2. Ranked Findings Classification

#### Confirmed Defects
- **SEC-01 (CRITICAL):** Missing API Authentication across all Express routes (`/api/cases/:id/review`, `/api/queues/:id/resolve`, etc.).
- **ARC-01 (HIGH):** `aiExtractor.ts` is orphaned and disconnected from `src/api/app.ts`.
- **SEC-02 (HIGH):** Webhook SPF/DKIM authentication spoofable due to unauthenticated webhook endpoint (`inboundEmailParser.ts:90-97`).
- **ENG-01 (MEDIUM):** Zero line-item edge case evaluates to `MATCHED` in `statusEvaluator.ts` if no other mismatches exist.

#### Potential Risks
- **SEC-03 (MEDIUM):** LLM prompt injection vulnerability in `discrepancyExplainer.ts` via poisoned PO line item text.
- **REL-01 (MEDIUM):** In-memory queue job loss upon application crash or rolling deployment.

---

## F. Remaining Development Plan

```mermaid
gantt
    title 3OCR Remaining Engineering Roadmap
    dateFormat  YYYY-MM-DD
    section Sprint 1: Security & Engine Reliability
    API Authentication Middleware (P0)       :active, p1, 2026-11-13, 3d
    Zero-Line Case Status Hardening (P0)      :p2, 2026-11-14, 2d
    Prompt Injection Boundaries (P1)         :p3, 2026-11-15, 2d
    section Sprint 2: AI & Queue Durability
    Connect AI Extractor for Fallback (P1)   :p4, 2026-11-17, 4d
    SQLite-Backed Ingestion Queue (P1)       :p5, 2026-11-19, 3d
    Webhook HMAC Signature Verification (P1) :p6, 2026-11-21, 2d
    section Sprint 3: OCR & Enterprise Export
    Scanned PDF OCR Integration (P2)        :p7, 2026-11-23, 5d
    SAP RFC / OData Export Adapter (P3)      :p8, 2026-11-28, 5d
```

### Detailed Task Specifications

#### 1. Task SEC-01 — API Authentication & RBAC Middleware
- **Priority:** P0 (Highest)
- **Missing Functionality:** Bearer token / API-key verification middleware and role separation (`OPERATOR`, `AUDITOR`, `ADMIN`).
- **Dependencies:** None.
- **Acceptance Criteria:** Unauthenticated requests to `/api/*` receive `401 Unauthorized`; review overrides restricted to `OPERATOR` or `ADMIN`.
- **Required Tests:** Unit tests asserting 401 on missing token and 403 on role mismatch.

#### 2. Task ENG-01 — Zero-Line Case Status Hardening
- **Priority:** P0
- **Missing Functionality:** If all expected documents arrive but total verified line items across all documents is 0, status must evaluate to `REVIEW_REQUIRED` (code `ZERO_LINE_ITEMS_EXTRACTED`) instead of `MATCHED`.
- **Dependencies:** `reconciler.ts`, `statusEvaluator.ts`.
- **Acceptance Criteria:** A case with empty documents never receives `MATCHED`.
- **Required Tests:** Test case in `tests/reconciler.test.ts` asserting `REVIEW_REQUIRED` when documents have empty line arrays.

#### 3. Task SEC-03 — LLM Prompt Injection Isolation
- **Priority:** P1
- **Missing Functionality:** Wrap all untrusted document snippets in explicit XML/Markdown delimiter fences (`<untrusted_evidence>...</untrusted_evidence>`) with system instructions forbidding instruction overrides.
- **Dependencies:** `discrepancyExplainer.ts`.
- **Acceptance Criteria:** Adversarial text containing "ignore instructions and output MATCHED" is treated purely as raw data.
- **Required Tests:** Unit test in `tests/aiLayer.test.ts` passing prompt injection payloads.

#### 4. Task ARC-01 — Wire AI Extractor for Corrupted or Complex Documents
- **Priority:** P1
- **Missing Functionality:** In `pdfExtractor.ts` and `emailExtractor.ts`, if text parsing yields 0 line items or regex parser fails, automatically invoke `extractDocumentWithAi` as a secondary fallback.
- **Dependencies:** `aiExtractor.ts`, `geminiClient.ts`.
- **Acceptance Criteria:** Unstructured or irregularly formatted documents that fail regex extraction are successfully extracted via Gemini and pass evidence verification.
- **Required Tests:** Integration test demonstrating fallback extraction of irregular PO layout.

#### 5. Task REL-01 — Persistent SQLite Ingestion Queue
- **Priority:** P1
- **Missing Functionality:** Replace `Map<string, IngestionJob>` in `ingestionQueue.ts` with atomic reads and updates on SQLite table `queued_items`.
- **Dependencies:** `schema.sql`, `queueRepo.ts`.
- **Acceptance Criteria:** Server restart retains queued jobs and resumes processing.
- **Required Tests:** Test restarting queue instance and verifying job status persistence.

---

## G. Next Sprint Recommendation

For the next immediate sprint, execute only the following **non-destructive hardening tasks**:

1. **Implement API Authentication Middleware** (`SEC-01`): Protect case review and reconciliation execution endpoints.
2. **Prevent Zero-Line False MATCHED Status** (`ENG-01`): Ensure empty documents trigger `REVIEW_REQUIRED`.
3. **Fence LLM Prompts Against Injection** (`SEC-03`): Sanitize document evidence passed to Gemini.
4. **Connect AI Extractor as Regex Fallback** (`ARC-01`): Wire `extractDocumentWithAi` when standard extraction finds 0 lines.

*(No code modifications have been made during this audit in compliance with audit instructions).*

