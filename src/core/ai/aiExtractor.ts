/**
 * 3OCR Multimodal AI Document Extractor
 * Uses Gemini to extract canonical purchase order structures from complex or damaged documents.
 * All extracted fields must still pass evidence verification.
 */

import { defaultGeminiClient, GeminiClient } from './geminiClient.js';
import { StageADocument } from '../schema/stageA.schema.js';

export interface AiExtractionParams {
  rawText?: string;
  buffer?: Buffer;
  mimeType?: string;
  documentId: string;
  sourceType: 'PDF' | 'EMAIL' | 'JSON';
  receivedAt?: string;
}

export interface AiExtractionResult {
  stageA: Partial<StageADocument>;
  rawExtractedText: string;
  isAiSuccess: boolean;
  error?: string;
}

export async function extractDocumentWithAi(
  params: AiExtractionParams,
  client: GeminiClient = defaultGeminiClient
): Promise<AiExtractionResult> {
  const { rawText, buffer, mimeType = 'application/pdf', documentId, sourceType, receivedAt = new Date().toISOString() } = params;

  if (!client.isAvailable()) {
    return {
      stageA: {},
      rawExtractedText: rawText || '',
      isAiSuccess: false,
      error: 'GEMINI_API_KEY is not configured',
    };
  }

  try {
    const parts: any[] = [];

    if (buffer) {
      parts.push({
        inlineData: {
          mimeType,
          data: buffer.toString('base64'),
        },
      });
    }

    const textContent = rawText ? `Document Raw Text:\n${rawText}\n\n` : '';
    parts.push(
      `${textContent}Extract purchase order data from this ${sourceType} document. 
Return ONLY valid JSON with this exact structure:
{
  "poNumber": "string or null",
  "customerId": "string or null",
  "customerName": "string or null",
  "currency": "string or null",
  "lineItems": [
    {
      "lineReference": "string",
      "productCode": "string",
      "description": "string or null",
      "quantity": "string",
      "unitOfMeasure": "string or null",
      "unitPrice": "string",
      "lineTotal": "string",
      "snippet": "exact verbatim string from document"
    }
  ],
  "amounts": {
    "subtotal": "string or null",
    "grandTotal": "string or null"
  }
}`
    );

    const response = await client.generateContent(parts, {
      systemInstruction: 'You are an accurate optical document extractor. Extract all line items and order header numbers faithfully. Never invent lines or guess missing prices. Provide exact text snippets matching the source.',
      temperature: 0.1,
    });

    const cleaned = response.replace(/```json\s*|\s*```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const stageA: Partial<StageADocument> = {
      schemaVersion: '1.0',
      source: {
        documentId,
        sourceType,
        receivedAt,
        fileHash: null,
        messageId: null,
        contentHash: null,
        senderEmail: null,
        extractedTextId: null,
      },
      order: {
        poNumber: parsed.poNumber || null,
        poDate: null,
        customerId: parsed.customerId || null,
        customerName: parsed.customerName || null,
        currency: parsed.currency || null,
      },
      lineItems: (parsed.lineItems || []).map((li: any, idx: number) => ({
        lineReference: li.lineReference || `${idx + 1}`,
        productCode: li.productCode || null,
        description: li.description || null,
        quantity: li.quantity != null ? String(li.quantity) : null,
        unitOfMeasure: li.unitOfMeasure || null,
        unitPrice: li.unitPrice != null ? String(li.unitPrice) : null,
        discountAmount: null,
        taxableAmount: li.lineTotal != null ? String(li.lineTotal) : null,
        taxes: [],
        lineTotal: li.lineTotal != null ? String(li.lineTotal) : null,
      })),
      amounts: {
        subtotal: parsed.amounts?.subtotal != null ? String(parsed.amounts.subtotal) : null,
        discountTotal: null,
        taxTotal: null,
        freight: null,
        roundingAdjustment: null,
        grandTotal: parsed.amounts?.grandTotal != null ? String(parsed.amounts.grandTotal) : null,
      },
      headerAdjustments: [],
      evidence: [],
    };

    return {
      stageA,
      rawExtractedText: rawText || JSON.stringify(parsed, null, 2),
      isAiSuccess: true,
    };
  } catch (err: any) {
    return {
      stageA: {},
      rawExtractedText: rawText || '',
      isAiSuccess: false,
      error: err.message,
    };
  }
}
