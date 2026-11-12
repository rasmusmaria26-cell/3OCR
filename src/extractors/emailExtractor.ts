import { StageADocument, Evidence } from '../core/schema/stageA.schema.js';
import { stripEmailQuotes, QuoteStripResult } from '../core/email/quoteStripper.js';
import { verifyEvidence, VerificationIssue } from '../core/verification/evidenceVerifier.js';
import { parseDecimal } from '../core/decimal/decimalParser.js';

export interface LlmClientInterface {
  extractFromEmail(text: string): Promise<any>;
}

export interface EmailExtractionParams {
  rawText: string;
  documentId: string;
  receivedAt: string;
  senderEmail?: string | null;
  llmClient?: LlmClientInterface;
}

export interface EmailExtractionResult {
  stageA: StageADocument;
  quoteStripResult: QuoteStripResult;
  issues: VerificationIssue[];
}

export async function extractEmailToStageA(params: EmailExtractionParams): Promise<EmailExtractionResult> {
  const { rawText, documentId, receivedAt, senderEmail, llmClient } = params;

  // 1. Strip quotes & boilerplate
  const quoteStripResult = stripEmailQuotes(rawText);
  const cleanedText = quoteStripResult.cleanedText;

  const issues: VerificationIssue[] = [];
  const evidenceList: Evidence[] = [];

  // Helper to verify and populate a field
  function checkAndSetField<T>(opts: {
    fieldPath: string;
    candidateValue: string | null | undefined;
    rawValue: string | null | undefined;
    snippet: string | null | undefined;
    isNumeric: boolean;
    isBlocking: boolean;
    method: 'LLM' | 'REGEX';
    onSuccess: (val: string, verifiedCurrency?: string | null) => void;
    onFailure: () => void;
  }) {
    if (!opts.candidateValue || !opts.rawValue || !opts.snippet) {
      opts.onFailure();
      return;
    }

    const verification = verifyEvidence({
      documentText: cleanedText,
      snippet: opts.snippet,
      rawValue: opts.rawValue,
      expectedValue: opts.candidateValue,
      isNumeric: opts.isNumeric,
      fieldPath: opts.fieldPath,
      isBlockingField: opts.isBlocking,
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
        extractionMethod: opts.method,
      });
    } else {
      opts.onFailure();
      if (verification.issue) {
        issues.push(verification.issue);
      }
    }
  }

  // Base Stage A document structure
  const stageA: StageADocument = {
    schemaVersion: '1.0',
    source: {
      documentId,
      sourceType: 'EMAIL',
      receivedAt,
      fileHash: null,
      messageId: null,
      contentHash: null,
      senderEmail: senderEmail || null,
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
  let currencyEvidenceSnippet: { snippet: string; rawValue: string } | null = null;
  const currentMethod: 'LLM' | 'REGEX' = llmClient ? 'LLM' : 'REGEX';

  if (llmClient) {
    // LLM Extraction Path
    const llmOutput = await llmClient.extractFromEmail(cleanedText);

    // Order level
    if (llmOutput.poNumber) {
      const snippet = llmOutput.evidenceSnippets?.poNumber?.snippet || llmOutput.poNumber;
      const rawValue = llmOutput.evidenceSnippets?.poNumber?.rawValue || llmOutput.poNumber;
      checkAndSetField({
        fieldPath: 'order.poNumber',
        candidateValue: llmOutput.poNumber,
        rawValue,
        snippet,
        isNumeric: false,
        isBlocking: true,
        method: 'LLM',
        onSuccess: (val) => { stageA.order.poNumber = val; },
        onFailure: () => { stageA.order.poNumber = null; },
      });
    }

    if (llmOutput.poDate) {
      const snippet = llmOutput.evidenceSnippets?.poDate?.snippet || llmOutput.poDate;
      const rawValue = llmOutput.evidenceSnippets?.poDate?.rawValue || llmOutput.poDate;
      checkAndSetField({
        fieldPath: 'order.poDate',
        candidateValue: llmOutput.poDate,
        rawValue,
        snippet,
        isNumeric: false,
        isBlocking: false,
        method: 'LLM',
        onSuccess: (val) => { stageA.order.poDate = val; },
        onFailure: () => { stageA.order.poDate = null; },
      });
    }

    if (llmOutput.customerId) {
      const snippet = llmOutput.evidenceSnippets?.customerId?.snippet || llmOutput.customerId;
      const rawValue = llmOutput.evidenceSnippets?.customerId?.rawValue || llmOutput.customerId;
      checkAndSetField({
        fieldPath: 'order.customerId',
        candidateValue: llmOutput.customerId,
        rawValue,
        snippet,
        isNumeric: false,
        isBlocking: false,
        method: 'LLM',
        onSuccess: (val) => { stageA.order.customerId = val; },
        onFailure: () => { stageA.order.customerId = null; },
      });
    }

    if (llmOutput.customerName) {
      const snippet = llmOutput.evidenceSnippets?.customerName?.snippet || llmOutput.customerName;
      const rawValue = llmOutput.evidenceSnippets?.customerName?.rawValue || llmOutput.customerName;
      checkAndSetField({
        fieldPath: 'order.customerName',
        candidateValue: llmOutput.customerName,
        rawValue,
        snippet,
        isNumeric: false,
        isBlocking: false,
        method: 'LLM',
        onSuccess: (val) => { stageA.order.customerName = val; },
        onFailure: () => { stageA.order.customerName = null; },
      });
    }

    if (llmOutput.currency) {
      const snippet = llmOutput.evidenceSnippets?.currency?.snippet || llmOutput.currency;
      const rawValue = llmOutput.evidenceSnippets?.currency?.rawValue || llmOutput.currency;
      checkAndSetField({
        fieldPath: 'order.currency',
        candidateValue: llmOutput.currency,
        rawValue,
        snippet,
        isNumeric: false,
        isBlocking: false,
        method: 'LLM',
        onSuccess: (val) => {
          stageA.order.currency = val;
          capturedCurrency = val;
          currencyEvidenceSnippet = { snippet, rawValue };
        },
        onFailure: () => { stageA.order.currency = null; },
      });
    }

    if (llmOutput.lineItems && Array.isArray(llmOutput.lineItems)) {
      llmOutput.lineItems.forEach((item: any, idx: number) => {
        let verifiedQty: string | null = null;
        let verifiedCode: string | null = null;
        let verifiedPrice: string | null = null;
        let verifiedTotal: string | null = null;
        let verifiedUom: string | null = null;

        const lineIndex = idx;
        const qtyCandidate = item.quantity;
        const qtyRaw = item.rawValue || item.quantity;
        const qtySnippet = item.snippet || item.quantity;

        checkAndSetField({
          fieldPath: `lineItems[${lineIndex}].quantity`,
          candidateValue: qtyCandidate,
          rawValue: qtyRaw,
          snippet: qtySnippet,
          isNumeric: true,
          isBlocking: true,
          method: 'LLM',
          onSuccess: (val) => { verifiedQty = val; },
          onFailure: () => { verifiedQty = null; },
        });

        if (item.productCode) {
          checkAndSetField({
            fieldPath: `lineItems[${lineIndex}].productCode`,
            candidateValue: item.productCode,
            rawValue: item.productCode,
            snippet: item.snippet || item.productCode,
            isNumeric: false,
            isBlocking: true,
            method: 'LLM',
            onSuccess: (val) => { verifiedCode = val; },
            onFailure: () => { verifiedCode = null; },
          });
        }

        if (item.unitPrice) {
          const parsedP = parseDecimal(item.unitPrice);
          if (parsedP) {
            checkAndSetField({
              fieldPath: `lineItems[${lineIndex}].unitPrice`,
              candidateValue: parsedP.value,
              rawValue: item.unitPrice,
              snippet: item.snippet || item.unitPrice,
              isNumeric: true,
              isBlocking: false,
              method: 'LLM',
              onSuccess: (val, curr) => {
                verifiedPrice = val;
                if (curr && !capturedCurrency) {
                  capturedCurrency = curr;
                  currencyEvidenceSnippet = { snippet: item.snippet || item.unitPrice, rawValue: item.unitPrice };
                }
              },
              onFailure: () => { verifiedPrice = null; },
            });
          }
        }

        if (item.unitOfMeasure) {
          checkAndSetField({
            fieldPath: `lineItems[${lineIndex}].unitOfMeasure`,
            candidateValue: item.unitOfMeasure,
            rawValue: item.unitOfMeasure,
            snippet: item.snippet || item.unitOfMeasure,
            isNumeric: false,
            isBlocking: false,
            method: 'LLM',
            onSuccess: (val) => { verifiedUom = val; },
            onFailure: () => { verifiedUom = null; },
          });
        }

        if (item.lineTotal) {
          const parsedT = parseDecimal(item.lineTotal);
          if (parsedT) {
            checkAndSetField({
              fieldPath: `lineItems[${lineIndex}].lineTotal`,
              candidateValue: parsedT.value,
              rawValue: item.lineTotal,
              snippet: item.snippet || item.lineTotal,
              isNumeric: true,
              isBlocking: false,
              method: 'LLM',
              onSuccess: (val) => { verifiedTotal = val; },
              onFailure: () => { verifiedTotal = null; },
            });
          }
        }

        stageA.lineItems.push({
          lineReference: `${idx + 1}`,
          productCode: verifiedCode || item.productCode || null,
          description: item.description || null,
          quantity: verifiedQty,
          unitOfMeasure: verifiedUom || null,
          unitPrice: verifiedPrice,
          discountAmount: null,
          taxableAmount: null,
          taxes: [],
          lineTotal: verifiedTotal,
        });
      });
    }

    if (llmOutput.amounts?.grandTotal) {
      const parsedTotal = parseDecimal(llmOutput.amounts.grandTotal);
      if (parsedTotal) {
        const totalSnippet = llmOutput.amounts.snippet || llmOutput.amounts.grandTotal;
        const totalRaw = llmOutput.amounts.rawValue || llmOutput.amounts.grandTotal;
        checkAndSetField({
          fieldPath: 'amounts.grandTotal',
          candidateValue: parsedTotal.value,
          rawValue: totalRaw,
          snippet: totalSnippet,
          isNumeric: true,
          isBlocking: false,
          method: 'LLM',
          onSuccess: (val, curr) => {
            stageA.amounts.grandTotal = val;
            if (curr && !capturedCurrency) {
              capturedCurrency = curr;
              currencyEvidenceSnippet = { snippet: totalSnippet, rawValue: totalRaw };
            }
          },
          onFailure: () => { stageA.amounts.grandTotal = null; },
        });
      }
    }
  } else {
    // Regex Fallback Extraction Path
    // 1. PO Number
    const poMatch = /(?:PO(?:\s*(?:Number|#|No\.?))?|Purchase\s*Order(?:\s*(?:Number|#|No\.?))?)(?:[:\s#]+(?=[A-Z0-9_-]*\d)|\s*[:#]\s*)([A-Za-z0-9_-]+)/i.exec(cleanedText);
    if (poMatch) {
      checkAndSetField({
        fieldPath: 'order.poNumber',
        candidateValue: poMatch[1],
        rawValue: poMatch[1],
        snippet: poMatch[0],
        isNumeric: false,
        isBlocking: true,
        method: 'REGEX',
        onSuccess: (val) => { stageA.order.poNumber = val; },
        onFailure: () => { stageA.order.poNumber = null; },
      });
    }

    // 2. Customer ID
    const custIdMatch = /Customer\s*ID[:\s]+([A-Za-z0-9_-]+)/i.exec(cleanedText);
    if (custIdMatch) {
      checkAndSetField({
        fieldPath: 'order.customerId',
        candidateValue: custIdMatch[1],
        rawValue: custIdMatch[1],
        snippet: custIdMatch[0],
        isNumeric: false,
        isBlocking: false,
        method: 'REGEX',
        onSuccess: (val) => { stageA.order.customerId = val; },
        onFailure: () => { stageA.order.customerId = null; },
      });
    }

    // 3. Customer Name
    const custNameMatch = /Customer(?:\s*Name)?[:\s]+([A-Za-z0-9\s]+?)(?:\n|$)/i.exec(cleanedText);
    if (custNameMatch) {
      stageA.order.customerName = custNameMatch[1].trim();
    }

    // 4. Line items regex (Item: ..., Qty: ..., Price: ...)
    const itemRegex = /Item[:\s]+([A-Za-z0-9_-]+)(?:[\r\n\s]+.*?)*?(?:Qty|Quantity)[:\s]+([\d,.]+)(?:[\r\n\s]+.*?)?(?:Price|Unit\s*Price)?[:\s]*([^\r\n]+)?/gi;
    let match: RegExpExecArray | null;
    let lineIdx = 0;

    while ((match = itemRegex.exec(cleanedText)) !== null) {
      const fullMatch = match[0];
      const rawSku = match[1];
      const rawQty = match[2];
      const rawPrice = match[3]?.trim();

      const parsedQty = parseDecimal(rawQty);
      const parsedPrice = rawPrice ? parseDecimal(rawPrice) : null;

      let verifiedQty: string | null = null;
      let verifiedPrice: string | null = null;
      let verifiedSku: string | null = null;
      let verifiedDesc: string | null = null;

      // Check Description if present
      const descMatch = /Description[:\s]+([^\r\n]+)/i.exec(fullMatch);
      const rawDesc = descMatch ? descMatch[1].trim() : null;
      if (rawDesc) {
        checkAndSetField({
          fieldPath: `lineItems[${lineIdx}].description`,
          candidateValue: rawDesc,
          rawValue: rawDesc,
          snippet: fullMatch,
          isNumeric: false,
          isBlocking: false,
          method: 'REGEX',
          onSuccess: (val) => { verifiedDesc = val; },
          onFailure: () => { verifiedDesc = null; },
        });
      }

      // Verify SKU
      checkAndSetField({
        fieldPath: `lineItems[${lineIdx}].productCode`,
        candidateValue: rawSku,
        rawValue: rawSku,
        snippet: fullMatch,
        isNumeric: false,
        isBlocking: true,
        method: 'REGEX',
        onSuccess: (val) => { verifiedSku = val; },
        onFailure: () => { verifiedSku = null; },
      });

      // Verify Quantity
      checkAndSetField({
        fieldPath: `lineItems[${lineIdx}].quantity`,
        candidateValue: parsedQty?.value || null,
        rawValue: rawQty,
        snippet: fullMatch,
        isNumeric: true,
        isBlocking: true,
        method: 'REGEX',
        onSuccess: (val) => { verifiedQty = val; },
        onFailure: () => { verifiedQty = null; },
      });

      // Verify Price
      if (parsedPrice) {
        checkAndSetField({
          fieldPath: `lineItems[${lineIdx}].unitPrice`,
          candidateValue: parsedPrice.value,
          rawValue: rawPrice!,
          snippet: fullMatch,
          isNumeric: true,
          isBlocking: false,
          method: 'REGEX',
          onSuccess: (val, curr) => {
            verifiedPrice = val;
            if (curr && !capturedCurrency) {
              capturedCurrency = curr;
              currencyEvidenceSnippet = { snippet: fullMatch, rawValue: rawPrice! };
            }
          },
          onFailure: () => { verifiedPrice = null; },
        });
      }

      stageA.lineItems.push({
        lineReference: `${lineIdx + 1}`,
        productCode: verifiedSku,
        description: verifiedDesc || null,
        quantity: verifiedQty,
        unitOfMeasure: null,
        unitPrice: verifiedPrice,
        discountAmount: null,
        taxableAmount: null,
        taxes: [],
        lineTotal: null,
      });

      lineIdx++;
    }

    // 5. Total
    const totalMatch = /Total[:\s]+([₹$€£\w\s,.]+)/i.exec(cleanedText);
    if (totalMatch) {
      const parsedTotal = parseDecimal(totalMatch[1]);
      if (parsedTotal) {
        checkAndSetField({
          fieldPath: 'amounts.grandTotal',
          candidateValue: parsedTotal.value,
          rawValue: totalMatch[1].trim(),
          snippet: totalMatch[0],
          isNumeric: true,
          isBlocking: false,
          method: 'REGEX',
          onSuccess: (val, curr) => {
            stageA.amounts.grandTotal = val;
            if (curr && !capturedCurrency) {
              capturedCurrency = curr;
              currencyEvidenceSnippet = { snippet: totalMatch[0], rawValue: totalMatch[1].trim() };
            }
          },
          onFailure: () => { stageA.amounts.grandTotal = null; },
        });
      }
    }
  }

  // Currency capture (Fix 2: Capture currency as evidence for order.currency)
  if (capturedCurrency) {
    stageA.order.currency = capturedCurrency;
    if (currencyEvidenceSnippet) {
      const evSnippet: any = currencyEvidenceSnippet;
      let charStart: number | null = null;
      let charEnd: number | null = null;

      const sIdx = cleanedText.indexOf(evSnippet.snippet);
      if (sIdx !== -1) {
        const valIdx = evSnippet.snippet.indexOf(evSnippet.rawValue);
        if (valIdx !== -1) {
          charStart = sIdx + valIdx;
          charEnd = charStart + evSnippet.rawValue.length;
        }
      }

      evidenceList.push({
        fieldPath: 'order.currency',
        rawValue: evSnippet.rawValue,
        snippet: evSnippet.snippet,
        page: 1,
        charStart,
        charEnd,
        jsonPath: null,
        extractionMethod: currentMethod,
      });
    }
  }

  stageA.evidence = evidenceList;

  return {
    stageA,
    quoteStripResult,
    issues,
  };
}
