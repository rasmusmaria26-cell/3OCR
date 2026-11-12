import { StageADocument } from '../schema/stageA.schema.js';

export interface PolicyViolation {
  field: string;
  code: string;
  message: string;
  isBlocking: boolean;
}

export interface PolicyValidationResult {
  isValid: boolean;
  issues: PolicyViolation[];
}

export function validateSourcePolicy(doc: StageADocument): PolicyValidationResult {
  const issues: PolicyViolation[] = [];
  const sourceType = doc.source.sourceType;

  // 1. Required for all: poNumber
  if (!doc.order.poNumber) {
    issues.push({
      field: 'order.poNumber',
      code: 'REQUIRED_FIELD_MISSING',
      message: 'PO number is required for all document sources',
      isBlocking: true,
    });
  }

  // 2. Required for all: at least one line
  if (!doc.lineItems || doc.lineItems.length === 0) {
    issues.push({
      field: 'lineItems',
      code: 'NO_LINE_ITEMS',
      message: 'At least one line item is required',
      isBlocking: true,
    });
  } else {
    // 3. For each line: productCode or description, and quantity
    doc.lineItems.forEach((item, idx) => {
      if (!item.productCode && !item.description) {
        issues.push({
          field: `lineItems[${idx}].productCode`,
          code: 'PRODUCT_IDENTIFIER_MISSING',
          message: `Line ${idx} must have product code or description`,
          isBlocking: true,
        });
      }

      if (!item.quantity) {
        issues.push({
          field: `lineItems[${idx}].quantity`,
          code: 'QUANTITY_MISSING',
          message: `Line ${idx} must have a quantity`,
          isBlocking: true,
        });
      }

      // 4. Required for PDF and JSON only: unitPrice
      if ((sourceType === 'PDF' || sourceType === 'JSON') && !item.unitPrice) {
        issues.push({
          field: `lineItems[${idx}].unitPrice`,
          code: 'UNIT_PRICE_MISSING',
          message: `Unit price is required for ${sourceType} lines`,
          isBlocking: true,
        });
      }
    });
  }

  // 5. Required for PDF and JSON only: grandTotal
  if ((sourceType === 'PDF' || sourceType === 'JSON') && !doc.amounts.grandTotal) {
    issues.push({
      field: 'amounts.grandTotal',
      code: 'GRAND_TOTAL_MISSING',
      message: `Grand total is required for ${sourceType}`,
      isBlocking: true,
    });
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}

export interface CompletenessMismatch {
  sku: string;
  reason: 'ITEM_IN_EMAIL_MISSING_FROM_COMPLETE_PDF' | 'PDF_AND_JSON_ITEM_COUNT_MISMATCH';
}

export function compareSourceCompleteness(params: {
  emailSkus?: string[];
  pdfSkus?: string[];
  jsonSkus?: string[];
}): { mismatches: CompletenessMismatch[] } {
  const mismatches: CompletenessMismatch[] = [];
  const { emailSkus, pdfSkus, jsonSkus } = params;

  // Rule: Item in email but missing from complete PDF = mismatch
  if (emailSkus && pdfSkus) {
    const pdfSet = new Set(pdfSkus);
    emailSkus.forEach((sku) => {
      if (!pdfSet.has(sku)) {
        mismatches.push({
          sku,
          reason: 'ITEM_IN_EMAIL_MISSING_FROM_COMPLETE_PDF',
        });
      }
    });
  }

  // Rule: Item in PDF but missing from JSON (or reverse) = mismatch
  if (pdfSkus && jsonSkus) {
    const pdfSet = new Set(pdfSkus);
    const jsonSet = new Set(jsonSkus);

    pdfSkus.forEach((sku) => {
      if (!jsonSet.has(sku)) {
        mismatches.push({
          sku,
          reason: 'PDF_AND_JSON_ITEM_COUNT_MISMATCH',
        });
      }
    });

    jsonSkus.forEach((sku) => {
      if (!pdfSet.has(sku) && !mismatches.some((m) => m.sku === sku)) {
        mismatches.push({
          sku,
          reason: 'PDF_AND_JSON_ITEM_COUNT_MISMATCH',
        });
      }
    });
  }

  return { mismatches };
}

