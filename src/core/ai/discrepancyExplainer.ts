/**
 * 3OCR Discrepancy Explainer
 * Generates plain-English root cause explanations and operator recommendations
 * using Gemini AI, with a deterministic fallback when offline or without API key.
 */

import { defaultGeminiClient, GeminiClient } from './geminiClient.js';
import { ReconcilerIssue } from '../engine/reconciler.js';

export interface ExplanationResult {
  issueFingerprint: string;
  summary: string;
  recommendation: string;
  isAiGenerated: boolean;
  modelUsed: string;
}

export interface DiscrepancyContext {
  poNumber: string;
  customerId: string;
  issue: ReconcilerIssue;
  documentSnippets?: Array<{
    sourceType: string;
    text: string;
  }>;
}

export async function explainDiscrepancy(
  context: DiscrepancyContext,
  client: GeminiClient = defaultGeminiClient
): Promise<ExplanationResult> {
  const { issue, poNumber, customerId, documentSnippets = [] } = context;

  // 1. If Gemini AI is available, call Gemini for rich situational analysis
  if (client.isAvailable()) {
    try {
      const systemInstruction = `You are an expert purchase-order reconciliation analyst for a modern enterprise ERP. 
Your task is to explain a cross-document discrepancy between PDF, Email, and JSON purchase orders in 2 concise sentences:
1. Explain what exactly caused the mismatch (the root cause across documents).
2. Recommend the specific action the human reviewer should take to resolve it.
Do not use markdown headers or bullet points. Output valid JSON with keys "summary" and "recommendation".`;

      const prompt = `Case PO: ${poNumber}
Customer: ${customerId}
Issue Type: ${issue.issueType}
Field: ${issue.field}
Line SKU: ${issue.normalizedSku || 'N/A'}
Message: ${issue.message}
Candidate Values: ${JSON.stringify(issue.candidateValues || {})}
Evidence Snippets:
${documentSnippets.map((s) => `[${s.sourceType}]: ${s.text}`).join('\n\n')}`;

      const rawResponse = await client.generateContent([prompt], {
        systemInstruction,
        temperature: 0.2,
      });

      // Parse JSON from response
      const cleaned = rawResponse.replace(/```json\s*|\s*```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (parsed.summary && parsed.recommendation) {
        return {
          issueFingerprint: issue.fingerprint,
          summary: parsed.summary,
          recommendation: parsed.recommendation,
          isAiGenerated: true,
          modelUsed: 'gemini-2.5-flash',
        };
      }
    } catch {
      // Fall through to deterministic explainer if AI call fails or throttles
    }
  }

  // 2. High-quality Deterministic Rule-Based Fallback
  return generateDeterministicExplanation(context);
}

function generateDeterministicExplanation(context: DiscrepancyContext): ExplanationResult {
  const { issue, poNumber } = context;
  const sku = issue.normalizedSku ? `SKU ${issue.normalizedSku}` : 'this item';

  let summary = issue.message;
  let recommendation = 'Review source documents and confirm correct value with customer purchasing agent.';

  switch (issue.issueType) {
    case 'ITEM_IN_EMAIL_MISSING_FROM_COMPLETE_PDF':
      summary = `${sku} was requested in the email correspondence but is completely absent from the official PDF purchase order for ${poNumber}.`;
      recommendation = `Verify if the customer added ${sku} in an email modification that was never reflected in the PDF, or confirm if the PDF is the final binding order.`;
      break;

    case 'MISSING_LINE_ITEM':
      summary = `${sku} is listed in one document source but missing from another.`;
      recommendation = `Check whether this line item was canceled or belongs to a different order batch.`;
      break;

    case 'GRAND_TOTAL_ARITHMETIC_MISMATCH':
      summary = `The printed grand total on the document does not equal the arithmetic sum of its individual line items.`;
      recommendation = `Check for unlisted charges, freight, or discounts, and adjust the line totals or request a revised invoice.`;
      break;

    case 'GRAND_TOTAL_MISMATCH':
      summary = `Different document sources state conflicting grand totals for PO ${poNumber}.`;
      recommendation = `Compare line quantities and unit prices across sources to identify which document contains the accurate total.`;
      break;

    case 'CURRENCY_MISMATCH':
      summary = `Conflicting currencies were detected across the documents.`;
      recommendation = `Confirm billing currency with the customer before processing to prevent exchange rate discrepancies.`;
      break;

    case 'QUANTITY_MISMATCH':
      summary = `Conflicting quantities were ordered for ${sku} across different document channels.`;
      recommendation = `Verify the intended delivery quantity with the customer and approve the correct line value.`;
      break;

    case 'UNIT_PRICE_MISMATCH':
      summary = `Unit price discrepancy detected for ${sku}.`;
      recommendation = `Check agreed contract pricing or price book to determine which quoted price is authorized.`;
      break;

    default:
      summary = issue.message;
      recommendation = 'Inspect the highlighted source lines in the evidence viewer and record an operator decision.';
      break;
  }

  return {
    issueFingerprint: issue.fingerprint,
    summary,
    recommendation,
    isAiGenerated: false,
    modelUsed: 'deterministic-rules',
  };
}
