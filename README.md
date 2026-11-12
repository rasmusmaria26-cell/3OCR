# 3OCR — Cross-Document Reconciliation Engine

A high-precision, deterministic Cross-Document Reconciliation Engine that automates 3-way matching of purchase orders and financial documents across **PDF**, **Email**, and **JSON**.

## Features

- **Multi-Source Ingestion & Extraction**:
  - **PDF**: Deterministic text and tabular data extraction with character offset and page boundary tracking.
  - **Email**: Strips forwarded threads, disclaimers, and signatures; extracts items with line references.
  - **JSON**: Structured API/ERP payload normalization.
- **Canonical Stage A / Stage B Data Model**:
  - Validated with Zod schemas.
  - Strict preservation of raw immutable strings alongside parsed values.
- **Arbitrary-Precision Financial Arithmetic**:
  - Powered by `decimal.js` (no floating-point rounding errors).
  - Validates line-level taxable amounts, taxes, line totals, and document grand totals against configurable tolerances.
  - Indian numbering format support (e.g. `₹5,00,000.00`) alongside US standard format.
- **Deterministic SKU & Line-Item Matching**:
  - Matches by normalized SKU identity, not row order.
  - Safe duplicate SKU aggregation and incompatible pricing detection.
  - Handles partial email lists vs complete PDF/JSON documents.
- **Sub-Token Evidence Verification**:
  - Verifies extracted snippets against raw document text with strict token boundary checks.
  - Any verification failure produces a blocking `REVIEW_REQUIRED` issue.
- **Interactive Minimalist Dashboard**:
  - Clean light-theme ops/finance UI.
  - 60/40 two-column split with reconciliation table and synchronized snippet evidence viewer.
  - Slide-over human review drawer for resolving discrepancies.

## Quick Start

### Installation

```bash
npm install
```

### Run Server

```bash
npm start
```
The server will start at `http://localhost:3000`.

### Run Unit Tests

```bash
npm test
```
Executes all 26 test suites (170+ unit tests) via Vitest.

### Run End-to-End Batch Scenarios

```bash
node scripts/generate_and_test_samples.mjs
```
Generates 10 test scenarios across PDF, Email, and JSON, reconciles them through the API, and outputs results to `test_results.csv`.
