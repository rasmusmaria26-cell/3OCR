import { StageADocument, LineItem, Evidence } from '../core/schema/stageA.schema.js';
import { parseDecimal } from '../core/decimal/decimalParser.js';

export interface JsonOrderPayload {
  orderId?: string;
  poNumber: string;
  poDate?: string;
  customerId: string;
  customerName?: string;
  currency?: string;
  lineItems: Array<{
    lineReference?: string;
    productCode: string;
    description?: string;
    quantity: number | string;
    unitOfMeasure?: string;
    unitPrice: number | string;
    discountAmount?: number | string;
    taxableAmount?: number | string;
    taxes?: Array<{ type?: string; rate?: number | string; amount?: number | string }>;
    lineTotal?: number | string;
  }>;
  amounts?: {
    subtotal?: number | string;
    discountTotal?: number | string;
    taxTotal?: number | string;
    freight?: number | string;
    roundingAdjustment?: number | string;
    grandTotal: number | string;
  };
}

export interface JsonExtractionParams {
  payload: JsonOrderPayload;
  documentId: string;
  receivedAt: string;
}

export function extractJsonToStageA(params: JsonExtractionParams): StageADocument {
  const { payload, documentId, receivedAt } = params;

  const rawJsonText = JSON.stringify(payload, null, 2);
  const evidenceList: Evidence[] = [];

  // Helper for decimal parsing of number or string
  const toDecimalString = (val: number | string | undefined | null): string | null => {
    if (val === undefined || val === null) return null;
    const str = String(val);
    const parsed = parseDecimal(str);
    return parsed?.value || null;
  };

  // PO number evidence
  evidenceList.push({
    fieldPath: 'order.poNumber',
    rawValue: payload.poNumber,
    snippet: `"poNumber": "${payload.poNumber}"`,
    page: 1,
    charStart: null,
    charEnd: null,
    jsonPath: '$.poNumber',
    extractionMethod: 'JSON_PARSE',
  });

  // Customer ID evidence
  if (payload.customerId) {
    evidenceList.push({
      fieldPath: 'order.customerId',
      rawValue: payload.customerId,
      snippet: `"customerId": "${payload.customerId}"`,
      page: 1,
      charStart: null,
      charEnd: null,
      jsonPath: '$.customerId',
      extractionMethod: 'JSON_PARSE',
    });
  }

  // Currency evidence (Fix 2: Capture currency as evidence for order.currency)
  if (payload.currency) {
    evidenceList.push({
      fieldPath: 'order.currency',
      rawValue: payload.currency,
      snippet: `"currency": "${payload.currency}"`,
      page: 1,
      charStart: null,
      charEnd: null,
      jsonPath: '$.currency',
      extractionMethod: 'JSON_PARSE',
    });
  }

  // Lines
  const lineItems: LineItem[] = (payload.lineItems || []).map((item, idx) => {
    const qtyStr = toDecimalString(item.quantity);
    const priceStr = toDecimalString(item.unitPrice);
    const lineTotalStr = toDecimalString(item.lineTotal);

    if (qtyStr) {
      evidenceList.push({
        fieldPath: `lineItems[${idx}].quantity`,
        rawValue: String(item.quantity),
        snippet: `"quantity": ${JSON.stringify(item.quantity)}`,
        page: 1,
        charStart: null,
        charEnd: null,
        jsonPath: `$.lineItems[${idx}].quantity`,
        extractionMethod: 'JSON_PARSE',
      });
    }

    if (priceStr) {
      evidenceList.push({
        fieldPath: `lineItems[${idx}].unitPrice`,
        rawValue: String(item.unitPrice),
        snippet: `"unitPrice": ${JSON.stringify(item.unitPrice)}`,
        page: 1,
        charStart: null,
        charEnd: null,
        jsonPath: `$.lineItems[${idx}].unitPrice`,
        extractionMethod: 'JSON_PARSE',
      });
    }

    return {
      lineReference: item.lineReference || `${idx + 1}`,
      productCode: item.productCode?.trim() || null,
      description: item.description?.trim() || null,
      quantity: qtyStr,
      unitOfMeasure: item.unitOfMeasure?.trim() || null,
      unitPrice: priceStr,
      discountAmount: toDecimalString(item.discountAmount),
      taxableAmount: toDecimalString(item.taxableAmount),
      taxes: (item.taxes || []).map((t) => ({
        type: t.type?.trim() || null,
        rate: toDecimalString(t.rate),
        amount: toDecimalString(t.amount),
      })),
      lineTotal: lineTotalStr,
    };
  });

  const grandTotalStr = toDecimalString(payload.amounts?.grandTotal);
  if (grandTotalStr) {
    evidenceList.push({
      fieldPath: 'amounts.grandTotal',
      rawValue: String(payload.amounts?.grandTotal),
      snippet: `"grandTotal": ${JSON.stringify(payload.amounts?.grandTotal)}`,
      page: 1,
      charStart: null,
      charEnd: null,
      jsonPath: '$.amounts.grandTotal',
      extractionMethod: 'JSON_PARSE',
    });
  }

  return {
    schemaVersion: '1.0',
    source: {
      documentId,
      sourceType: 'JSON',
      receivedAt,
      fileHash: null,
      messageId: null,
      contentHash: null,
      senderEmail: null,
      extractedTextId: null,
    },
    order: {
      poNumber: payload.poNumber?.trim() || null,
      poDate: payload.poDate?.trim() || null,
      customerId: payload.customerId?.trim() || null,
      customerName: payload.customerName?.trim() || null,
      currency: payload.currency?.trim() || null,
    },
    lineItems,
    amounts: {
      subtotal: toDecimalString(payload.amounts?.subtotal),
      discountTotal: toDecimalString(payload.amounts?.discountTotal),
      taxTotal: toDecimalString(payload.amounts?.taxTotal),
      freight: toDecimalString(payload.amounts?.freight),
      roundingAdjustment: toDecimalString(payload.amounts?.roundingAdjustment),
      grandTotal: grandTotalStr,
    },
    headerAdjustments: [],
    evidence: evidenceList,
  };
}

