PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- 1. Processing Cases: Unique on (customer_id, po_number)
CREATE TABLE IF NOT EXISTS processing_cases (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    po_number TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('REVIEW_REQUIRED', 'MISMATCH', 'INCOMPLETE', 'OPEN', 'RESOLVED', 'MATCHED')),
    expected_sources TEXT NOT NULL, -- JSON array: e.g. ["EMAIL", "PDF", "JSON"]
    deadline TEXT,                  -- ISO timestamp
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CONSTRAINT uq_case_customer_po UNIQUE (customer_id, po_number)
);

-- 2. Documents: Immutable arrival events and versions with storage_path
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    case_id TEXT, -- Nullable if in unlinked queue
    source_type TEXT NOT NULL CHECK(source_type IN ('EMAIL', 'PDF', 'JSON')),
    status TEXT NOT NULL CHECK(status IN ('RECEIVED', 'VALID', 'INVALID', 'DUPLICATE_FILE')),
    storage_path TEXT, -- Local filesystem path to original file
    file_hash TEXT,
    message_id TEXT,
    content_hash TEXT,
    sender_email TEXT,
    spf_status TEXT CHECK(spf_status IS NULL OR spf_status IN ('PASS', 'FAIL', 'SOFTFAIL', 'NONE')),
    dkim_status TEXT CHECK(dkim_status IS NULL OR dkim_status IN ('PASS', 'FAIL', 'NONE')),
    version_number INTEGER NOT NULL DEFAULT 1,
    is_current_version INTEGER NOT NULL DEFAULT 1 CHECK(is_current_version IN (0, 1)),
    duplicate_of_id TEXT,
    received_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(case_id) REFERENCES processing_cases(id) ON DELETE RESTRICT,
    FOREIGN KEY(duplicate_of_id) REFERENCES documents(id) ON DELETE RESTRICT
);

-- 3. Extracted Text: Raw immutable document text, cleaned extraction text, and page break offsets
CREATE TABLE IF NOT EXISTS extracted_text (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL UNIQUE,
    raw_text TEXT NOT NULL,
    cleaned_text TEXT NOT NULL,
    page_break_offsets TEXT,   -- JSON array of character offsets marking page transitions [0, 1420, 2900, ...]
    quote_strip_metadata TEXT, -- JSON: { charsRemoved, ratio, largeChunkRemoved }
    created_at TEXT NOT NULL,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE RESTRICT
);

-- 4. Extracted Fields: Stores Stage A and Stage B payloads
CREATE TABLE IF NOT EXISTS extracted_fields (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    stage TEXT NOT NULL CHECK(stage IN ('STAGE_A', 'STAGE_B')),
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE RESTRICT
);

-- 5. Extraction Issues: Field-level extraction failures and verification blocks
CREATE TABLE IF NOT EXISTS extraction_issues (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    field_path TEXT NOT NULL,
    code TEXT NOT NULL,
    candidate_value TEXT,
    raw_value TEXT,
    snippet TEXT,
    is_blocking INTEGER NOT NULL CHECK(is_blocking IN (0, 1)),
    created_at TEXT NOT NULL,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE RESTRICT
);

-- 6. Line Items: Extracted per source document
CREATE TABLE IF NOT EXISTS line_items (
    id TEXT PRIMARY KEY,
    source_document_id TEXT NOT NULL,
    line_reference TEXT,
    product_code TEXT,
    normalized_product_code TEXT,
    description TEXT,
    quantity TEXT,            -- Decimal string, strictly positive
    unit_of_measure TEXT,
    normalized_uom TEXT,
    unit_price TEXT,          -- Decimal string
    discount_amount TEXT,     -- Decimal string
    taxable_amount TEXT,      -- Decimal string
    line_total TEXT,          -- Decimal string
    taxes_json TEXT,          -- JSON array [{type, rate, amount}]
    created_at TEXT NOT NULL,
    FOREIGN KEY(source_document_id) REFERENCES documents(id) ON DELETE RESTRICT
);

-- 7. Reconciliation Runs: Run history per case
CREATE TABLE IF NOT EXISTS reconciliation_runs (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
    document_version_ids TEXT NOT NULL, -- JSON array of document IDs used in this run
    initiated_by TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    error_message TEXT,
    FOREIGN KEY(case_id) REFERENCES processing_cases(id) ON DELETE RESTRICT
);

-- 8. Reconciliation Results: Output of a reconciliation run
CREATE TABLE IF NOT EXISTS reconciliation_results (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE,
    case_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('REVIEW_REQUIRED', 'MISMATCH', 'INCOMPLETE', 'OPEN', 'RESOLVED', 'MATCHED')),
    issues_json TEXT NOT NULL,   -- Complete JSON array of all issues with fingerprints & evidence
    summary_json TEXT NOT NULL,  -- Summary stats (lines checked, arithmetic status, doc comparisons)
    created_at TEXT NOT NULL,
    FOREIGN KEY(run_id) REFERENCES reconciliation_runs(id) ON DELETE RESTRICT,
    FOREIGN KEY(case_id) REFERENCES processing_cases(id) ON DELETE RESTRICT
);

-- 9. Review Decisions: Insert-only decision trail keyed by issue_fingerprint
CREATE TABLE IF NOT EXISTS review_decisions (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    issue_fingerprint TEXT NOT NULL, -- Deterministic fingerprint: issue_type + field + normalized_sku + doc_version_ids
    field TEXT NOT NULL,
    line_reference TEXT,
    previous_value TEXT,
    selected_value TEXT NOT NULL,
    reason TEXT NOT NULL,
    reviewer TEXT NOT NULL,
    document_version_ids TEXT NOT NULL, -- JSON array of document version IDs covered
    superseded_by TEXT,                 -- Points to new decision id if superseded (insert-only)
    created_at TEXT NOT NULL,
    FOREIGN KEY(case_id) REFERENCES processing_cases(id) ON DELETE RESTRICT,
    FOREIGN KEY(superseded_by) REFERENCES review_decisions(id) ON DELETE RESTRICT
);

-- 10. Queues: Routing for unlinked, possible matches, identity conflicts
CREATE TABLE IF NOT EXISTS queues (
    id TEXT PRIMARY KEY,
    queue_type TEXT NOT NULL CHECK(queue_type IN ('UNLINKED', 'POSSIBLE_MATCH', 'IDENTITY_CONFLICT')),
    document_id TEXT NOT NULL,
    candidate_case_id TEXT,
    reason TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0 CHECK(resolved IN (0, 1)),
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE RESTRICT,
    FOREIGN KEY(candidate_case_id) REFERENCES processing_cases(id) ON DELETE RESTRICT
);

-- 11. Customer Config (Master configuration)
CREATE TABLE IF NOT EXISTS customer_config (
    customer_id TEXT PRIMARY KEY,
    default_currency TEXT NOT NULL,
    default_uom TEXT NOT NULL,
    separators_insignificant INTEGER NOT NULL CHECK(separators_insignificant IN (0, 1)),
    config_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 12. Sender Mappings (Exact sender email or @domain pattern mapped to customer)
CREATE TABLE IF NOT EXISTS sender_mappings (
    id TEXT PRIMARY KEY,
    sender_pattern TEXT NOT NULL UNIQUE, -- e.g. "orders@acme.com" or "@acme.com"
    customer_id TEXT NOT NULL,
    is_domain INTEGER NOT NULL DEFAULT 0 CHECK(is_domain IN (0, 1)),
    config_version TEXT NOT NULL DEFAULT '1.0',
    created_at TEXT NOT NULL,
    FOREIGN KEY(customer_id) REFERENCES customer_config(customer_id) ON DELETE RESTRICT
);

-- 13. Product Aliases (Per-customer in Phase 1, lowercase & trimmed)
CREATE TABLE IF NOT EXISTS product_aliases (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    alias_text TEXT NOT NULL,      -- Stored lowercase and trimmed
    normalized_sku TEXT NOT NULL,
    config_version TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- 13. Audit Logs: Append-only event trail
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details_json TEXT NOT NULL,
    performed_by TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- 14. Header Adjustments: Document-level charges, packing, discounts, freight
CREATE TABLE IF NOT EXISTS header_adjustments (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('FREIGHT', 'PACKING', 'DISCOUNT', 'OTHER')),
    description TEXT,
    amount TEXT NOT NULL, -- Positive decimal string (before taxes)
    taxes_json TEXT,      -- JSON array of [{ type, rate, amount }]
    created_at TEXT NOT NULL,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE RESTRICT
);

-- 15. Tax Rates: Master tax rate configuration
CREATE TABLE IF NOT EXISTS tax_rates (
    id TEXT PRIMARY KEY,
    tax_type TEXT NOT NULL CHECK(tax_type IN ('CGST', 'SGST', 'IGST', 'UTGST', 'VAT', 'SALES_TAX', 'OTHER')),
    rate TEXT NOT NULL,   -- Decimal string, e.g. "0.00", "5.00", "12.00", "18.00", "28.00"
    description TEXT,
    created_at TEXT NOT NULL
);

-- -------------------------------------------------------------
-- Immutability Triggers (Prevent UPDATE and DELETE on immutable records)
-- -------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN
    SELECT RAISE(ABORT, 'audit_logs is append-only and immutable.');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN
    SELECT RAISE(ABORT, 'audit_logs is append-only and immutable.');
END;

CREATE TRIGGER IF NOT EXISTS trg_extracted_text_no_update BEFORE UPDATE ON extracted_text
BEGIN
    SELECT RAISE(ABORT, 'extracted_text is immutable.');
END;

CREATE TRIGGER IF NOT EXISTS trg_extracted_text_no_delete BEFORE DELETE ON extracted_text
BEGIN
    SELECT RAISE(ABORT, 'extracted_text is immutable.');
END;

CREATE TRIGGER IF NOT EXISTS trg_reconciliation_runs_no_update BEFORE UPDATE ON reconciliation_runs
BEGIN
    SELECT RAISE(ABORT, 'reconciliation_runs is immutable.');
END;

CREATE TRIGGER IF NOT EXISTS trg_reconciliation_runs_no_delete BEFORE DELETE ON reconciliation_runs
BEGIN
    SELECT RAISE(ABORT, 'reconciliation_runs is append-only.');
END;

CREATE TRIGGER IF NOT EXISTS trg_reconciliation_results_no_update BEFORE UPDATE ON reconciliation_results
BEGIN
    SELECT RAISE(ABORT, 'reconciliation_results is immutable.');
END;

CREATE TRIGGER IF NOT EXISTS trg_reconciliation_results_no_delete BEFORE DELETE ON reconciliation_results
BEGIN
    SELECT RAISE(ABORT, 'reconciliation_results is immutable.');
END;

CREATE TRIGGER IF NOT EXISTS trg_extraction_issues_no_update BEFORE UPDATE ON extraction_issues
BEGIN
    SELECT RAISE(ABORT, 'extraction_issues is immutable.');
END;

CREATE TRIGGER IF NOT EXISTS trg_extraction_issues_no_delete BEFORE DELETE ON extraction_issues
BEGIN
    SELECT RAISE(ABORT, 'extraction_issues is immutable.');
END;

CREATE TRIGGER IF NOT EXISTS trg_header_adjustments_no_update BEFORE UPDATE ON header_adjustments
BEGIN
    SELECT RAISE(ABORT, 'header_adjustments is immutable.');
END;

CREATE TRIGGER IF NOT EXISTS trg_header_adjustments_no_delete BEFORE DELETE ON header_adjustments
BEGIN
    SELECT RAISE(ABORT, 'header_adjustments is immutable.');
END;

-- Document Case Linking Audit Triggers (Capture both UPDATE and initial INSERT with case_id)
CREATE TRIGGER IF NOT EXISTS trg_documents_case_linking_insert_audit AFTER INSERT ON documents
WHEN NEW.case_id IS NOT NULL
BEGIN
    INSERT INTO audit_logs (id, entity_type, entity_id, action, details_json, performed_by, created_at)
    VALUES (
        hex(randomblob(16)),
        'DOCUMENT',
        NEW.id,
        'LINK_CASE',
        json_object('previous_case_id', NULL, 'new_case_id', NEW.case_id),
        'SYSTEM',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_documents_case_linking_audit AFTER UPDATE OF case_id ON documents
WHEN NEW.case_id IS NOT NULL AND (OLD.case_id IS NULL OR OLD.case_id != NEW.case_id)
BEGIN
    INSERT INTO audit_logs (id, entity_type, entity_id, action, details_json, performed_by, created_at)
    VALUES (
        hex(randomblob(16)),
        'DOCUMENT',
        NEW.id,
        'LINK_CASE',
        json_object('previous_case_id', OLD.case_id, 'new_case_id', NEW.case_id),
        'SYSTEM',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );
END;

