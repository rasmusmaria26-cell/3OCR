import { StageADocument, LineItem, Evidence } from '../core/schema/stageA.schema.js';
import { parseDecimal } from '../core/decimal/decimalParser.js';
import { verifyEvidence, VerificationIssue, getPageForOffset } from '../core/verification/evidenceVerifier.js';

// @ts-ignore
import pdfParseFn from 'pdf-parse/lib/pdf-parse.js';
const pdfParse: (dataBuffer: Buffer, options?: any) => Promise<any> =
  (pdfParseFn as any)?.default || pdfParseFn;

export interface PdfExtractionParams {
  rawText: string;
  documentId: string;
  receivedAt: string;
  pageBreakOffsets?: number[];
  storagePath?: string;
}

export interface PdfBufferExtractionParams {
  buffer: Buffer;
  documentId: string;
  receivedAt: string;
  storagePath?: string;
}

export interface PdfExtractionResult {
  stageA: StageADocument;
  rawText: string;
  pageBreakOffsets: number[];
  issues: VerificationIssue[];
}

export async function extractPdfBufferToStageA(params: PdfBufferExtractionParams): Promise<PdfExtractionResult> {
  const { buffer, documentId, receivedAt, storagePath } = params;

  const pageBreakOffsets: number[] = [0];
  let curLen = 0;
  let parsedText = '';
  let parsingFailed = false;

  // Pass 1: Custom page-render to capture pageBreakOffsets
  try {
    const parsed = await pdfParse(buffer, {
      pagerender: (pageData: any) => {
        const render_options = {
          normalizeWhitespace: false,
          disableCombineTextItems: false,
        };
        return pageData.getTextContent(render_options).then((textContent: any) => {
          let lastY: any;
          let pageText = '';
          for (const item of textContent.items) {
            if (lastY === item.transform[5] || !lastY) {
              pageText += item.str;
            } else {
              pageText += '\n' + item.str;
            }
            lastY = item.transform[5];
          }
          if (curLen > 0) {
            pageBreakOffsets.push(curLen);
          }
          curLen += ('\n\n' + pageText).length;
          return pageText;
        });
      },
    });
    parsedText = parsed.text || '';
  } catch (err: any) {
    // Pass 2: Fallback to default pdf-parse without custom pagerender
    try {
      const defaultParsed = await pdfParse(buffer);
      parsedText = defaultParsed.text || '';
    } catch (fallbackErr: any) {
      parsingFailed = true;
      // Pass 3: Extract raw strings if binary has uncompressed content streams
      try {
        const latin = buffer.toString('latin1');
        const matches = latin.match(/\(([^)]+)\)\s*Tj/g);
        if (matches && matches.length > 0) {
          parsedText = matches.map((m: string) => m.replace(/^\(|\)\s*Tj$/g, '')).join(' ');
        }
      } catch {
        // ignore
      }
    }
  }

  if (parsingFailed && (!parsedText || parsedText.trim().length === 0)) {
    throw new Error('PDF_PARSE_STREAM_CORRUPT: Corrupted or unreadable PDF stream');
  }

  const result = extractPdfTextToStageA({
    rawText: parsedText,
    documentId,
    receivedAt,
    pageBreakOffsets,
    storagePath,
  });

  return result;
}

export function extractPdfTextToStageA(params: PdfExtractionParams): PdfExtractionResult {
  const { rawText, documentId, receivedAt, pageBreakOffsets = [0], storagePath } = params;

  const issues: VerificationIssue[] = [];
  const evidenceList: Evidence[] = [];

  function checkAndSetField(opts: {
    fieldPath: string;
    candidateValue: string | null | undefined;
    rawValue: string | null | undefined;
    snippet: string | null | undefined;
    isNumeric: boolean;
    isBlocking: boolean;
    onSuccess: (val: string, verifiedCurrency?: string | null) => void;
    onFailure: () => void;
  }) {
    if (!opts.candidateValue || !opts.rawValue || !opts.snippet) {
      opts.onFailure();
      return;
    }

    const verification = verifyEvidence({
      documentText: rawText,
      snippet: opts.snippet,
      rawValue: opts.rawValue,
      expectedValue: opts.candidateValue,
      isNumeric: opts.isNumeric,
      fieldPath: opts.fieldPath,
      isBlockingField: opts.isBlocking,
      pageBreakOffsets,
    });

    if (verification.isValid) {
      let verifiedCurrency: string | null = null;
      if (opts.isNumeric) {
        const parsed = parseDecimal(opts.rawValue);
        verifiedCurrency = parsed?.currency || null;
      }

      opts.onSuccess(opts.candidateValue, verifiedCurrency);

      evidenceList.push({
        fieldPath: opts.fieldPath,
        rawValue: opts.rawValue,
        snippet: opts.snippet,
        page: verification.page || 1,
        charStart: verification.charStart || null,
        charEnd: verification.charEnd || null,
        jsonPath: null,
        extractionMethod: 'PDF_PARSE',
      });
    } else {
      opts.onFailure();
      if (verification.issue) {
        issues.push(verification.issue);
      }
    }
  }

  const stageA: StageADocument = {
    schemaVersion: '1.0',
    source: {
      documentId,
      sourceType: 'PDF',
      receivedAt,
      fileHash: null,
      messageId: null,
      contentHash: null,
      senderEmail: null,
      extractedTextId: null,
    },
    order: {
      poNumber: null,
      poDate: null,
      customerId: null,
      customerName: null,
      currency: null,
    },
    lineItems: [],
    amounts: {
      subtotal: null,
      discountTotal: null,
      taxTotal: null,
      freight: null,
      roundingAdjustment: null,
      grandTotal: null,
    },
    headerAdjustments: [],
    evidence: [],
  };

  let capturedCurrency: string | null = null;
  let currencyEvidence: { snippet: string; rawValue: string } | null = null;

  // Extract PO Number
  const poMatch = /(?:PO(?:\s*(?:Number|#|No\.?))?|Purchase\s*Order(?:\s*(?:Number|#|No\.?))?)(?:[:\s#]+(?=[A-Z0-9_-]*\d)|\s*[:#]\s*)([A-Za-z0-9_-]+)/i.exec(rawText);
  if (poMatch) {
    checkAndSetField({
      fieldPath: 'order.poNumber',
      candidateValue: poMatch[1],
      rawValue: poMatch[1],
      snippet: poMatch[0],
      isNumeric: false,
      isBlocking: true,
      onSuccess: (val) => { stageA.order.poNumber = val; },
      onFailure: () => { stageA.order.poNumber = null; },
    });
  }

  // Extract Customer ID
  const custIdMatch = /(?:Customer(?:\s*(?:ID|Code|No\.?|Number))?|Client(?:\s*(?:ID|Code|No\.?))?|Account(?:\s*(?:No\.?|Number|ID))?)[:\s]+([A-Za-z0-9_-]+)/i.exec(rawText);
  if (custIdMatch) {
    checkAndSetField({
      fieldPath: 'order.customerId',
      candidateValue: custIdMatch[1],
      rawValue: custIdMatch[1],
      snippet: custIdMatch[0],
      isNumeric: false,
      isBlocking: false,
      onSuccess: (val) => { stageA.order.customerId = val; },
      onFailure: () => { stageA.order.customerId = null; },
    });
  }

  // Extract Customer Name
  const custNameMatch = /(?:Customer(?:\s*Name)?|Client(?:\s*Name)?|Bill\s*To)[:\s]+([A-Za-z0-9\s.,&-]+?)(?:\r?\n|$)/i.exec(rawText);
  if (custNameMatch) {
    stageA.order.customerName = custNameMatch[1].trim();
  }

  // Extract Lines: Table pattern or structured lines
  // Standard format: Line 1: SKU  Qty  UnitPrice  LineTotal
  const lineRegex = /(?:^|\n)\s*(\d+)?\s+([A-Za-z0-9_-]{3,})\s+([\w\s-]+?)\s+([\d,.]+)\s+([A-Za-z]{2,3})?\s+([₹$€£\w\s,.]+?)\s+([₹$€£\w\s,.]+)(?=\r?\n|$)/g;
  let match: RegExpExecArray | null;
  let lineIdx = 0;

  while ((match = lineRegex.exec(rawText)) !== null) {
    const fullSnippet = match[0].trim();
    const lineRef = match[1] || `${lineIdx + 1}`;
    const rawSku = match[2];
    const rawDesc = match[3].trim();
    const rawQty = match[4];
    const rawUom = match[5]?.trim() || null;
    const rawPrice = match[6].trim();
    const rawLineTotal = match[7].trim();

    const parsedQty = parseDecimal(rawQty);
    const parsedPrice = parseDecimal(rawPrice);
    const parsedTotal = parseDecimal(rawLineTotal);

    let verifiedSku: string | null = null;
    let verifiedQty: string | null = null;
    let verifiedPrice: string | null = null;
    let verifiedTotal: string | null = null;

    // Verify SKU
    checkAndSetField({
      fieldPath: `lineItems[${lineIdx}].productCode`,
      candidateValue: rawSku,
      rawValue: rawSku,
      snippet: fullSnippet,
      isNumeric: false,
      isBlocking: true,
      onSuccess: (val) => { verifiedSku = val; },
      onFailure: () => { verifiedSku = null; },
    });

    // Verify Quantity
    checkAndSetField({
      fieldPath: `lineItems[${lineIdx}].quantity`,
      candidateValue: parsedQty?.value || null,
      rawValue: rawQty,
      snippet: fullSnippet,
      isNumeric: true,
      isBlocking: true,
      onSuccess: (val) => { verifiedQty = val; },
      onFailure: () => { verifiedQty = null; },
    });

    // Verify Unit Price
    if (parsedPrice) {
      checkAndSetField({
        fieldPath: `lineItems[${lineIdx}].unitPrice`,
        candidateValue: parsedPrice.value,
        rawValue: rawPrice,
        snippet: fullSnippet,
        isNumeric: true,
        isBlocking: true, // required for PDF
        onSuccess: (val, curr) => {
          verifiedPrice = val;
          if (curr && !capturedCurrency) {
            capturedCurrency = curr;
            currencyEvidence = { snippet: fullSnippet, rawValue: rawPrice };
          }
        },
        onFailure: () => { verifiedPrice = null; },
      });
    }

    // Verify Line Total
    if (parsedTotal) {
      checkAndSetField({
        fieldPath: `lineItems[${lineIdx}].lineTotal`,
        candidateValue: parsedTotal.value,
        rawValue: rawLineTotal,
        snippet: fullSnippet,
        isNumeric: true,
        isBlocking: false,
        onSuccess: (val) => { verifiedTotal = val; },
        onFailure: () => { verifiedTotal = null; },
      });
    }

    stageA.lineItems.push({
      lineReference: lineRef,
      productCode: verifiedSku,
      description: rawDesc || null,
      quantity: verifiedQty,
      unitOfMeasure: rawUom,
      unitPrice: verifiedPrice,
      discountAmount: null,
      taxableAmount: verifiedTotal,
      taxes: [],
      lineTotal: verifiedTotal,
    });

    lineIdx++;
  }

  // Extract Grand Total
  const grandTotalMatch = /(?:Grand\s*Total|Total\s*Amount|Total)[:\s]+([₹$€£\w\s,.]+)/i.exec(rawText);
  if (grandTotalMatch) {
    const rawTotal = grandTotalMatch[1].trim();
    const parsedTotal = parseDecimal(rawTotal);
    if (parsedTotal) {
      checkAndSetField({
        fieldPath: 'amounts.grandTotal',
        candidateValue: parsedTotal.value,
        rawValue: rawTotal,
        snippet: grandTotalMatch[0],
        isNumeric: true,
        isBlocking: true, // required for PDF
        onSuccess: (val, curr) => {
          stageA.amounts.grandTotal = val;
          if (curr && !capturedCurrency) {
            capturedCurrency = curr;
            currencyEvidence = { snippet: grandTotalMatch[0], rawValue: rawTotal };
          }
        },
        onFailure: () => { stageA.amounts.grandTotal = null; },
      });
    }
  }

  if (capturedCurrency) {
    stageA.order.currency = capturedCurrency;
    if (currencyEvidence) {
      const currEv: any = currencyEvidence;
      let charStart: number | null = null;
      let charEnd: number | null = null;
      let page = 1;

      const sIdx = rawText.indexOf(currEv.snippet);
      if (sIdx !== -1) {
        const valIdx = currEv.snippet.indexOf(currEv.rawValue);
        if (valIdx !== -1) {
          const numStart: number = sIdx + valIdx;
          charStart = numStart;
          charEnd = numStart + currEv.rawValue.length;
          page = getPageForOffset(numStart, pageBreakOffsets);
        }
      }

      evidenceList.push({
        fieldPath: 'order.currency',
        rawValue: currEv.rawValue,
        snippet: currEv.snippet,
        page,
        charStart,
        charEnd,
        jsonPath: null,
        extractionMethod: 'PDF_PARSE',
      });
    }
  }

  stageA.evidence = evidenceList;

  return {
    stageA,
    rawText,
    pageBreakOffsets,
    issues,
  };
}

