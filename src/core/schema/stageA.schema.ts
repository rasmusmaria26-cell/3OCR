import { z } from 'zod';
import { nullableTrimmedString, decimalString, positiveDecimalString } from './common.schema.js';

export const TaxDetailSchema = z.object({
  type: nullableTrimmedString,
  rate: decimalString,
  amount: decimalString,
});

export const LineItemSchema = z.object({
  lineReference: nullableTrimmedString,
  productCode: nullableTrimmedString,
  description: nullableTrimmedString,
  quantity: positiveDecimalString,
  unitOfMeasure: nullableTrimmedString,
  unitPrice: decimalString,
  discountAmount: decimalString,
  taxableAmount: decimalString,
  taxes: z.array(TaxDetailSchema).default([]),
  lineTotal: decimalString,
});

export const AmountsSchema = z.object({
  subtotal: decimalString.default(null),
  discountTotal: decimalString.default(null),
  taxTotal: decimalString.default(null),
  freight: decimalString.default(null),
  roundingAdjustment: decimalString.default(null),
  grandTotal: decimalString.default(null),
});

export const HeaderAdjustmentSchema = z.object({
  type: z.enum(['FREIGHT', 'PACKING', 'DISCOUNT', 'OTHER']),
  description: nullableTrimmedString,
  amount: positiveDecimalString,
  taxes: z.array(TaxDetailSchema).default([]),
});

export const EvidenceSchema = z.object({
  fieldPath: z.string(),
  rawValue: z.string(),
  snippet: z.string(),
  page: z.number().int().positive().nullable().default(null),
  charStart: z.number().int().nonnegative().nullable().default(null),
  charEnd: z.number().int().nonnegative().nullable().default(null),
  jsonPath: nullableTrimmedString.default(null),
  extractionMethod: z.enum(['LLM', 'REGEX', 'PDF_PARSE', 'JSON_PARSE']),
});

export const SourceMetadataSchema = z.object({
  documentId: z.string(),
  sourceType: z.enum(['EMAIL', 'PDF', 'JSON']),
  receivedAt: z.string(),
  fileHash: nullableTrimmedString.default(null),
  messageId: nullableTrimmedString.default(null),
  contentHash: nullableTrimmedString.default(null),
  senderEmail: nullableTrimmedString.default(null),
  extractedTextId: nullableTrimmedString.default(null),
});

export const OrderHeaderSchema = z.object({
  poNumber: nullableTrimmedString,
  poDate: nullableTrimmedString,
  customerId: nullableTrimmedString,
  customerName: nullableTrimmedString,
  currency: nullableTrimmedString,
});

export const StageADocumentSchema = z.object({
  schemaVersion: z.literal('1.0'),
  source: SourceMetadataSchema,
  order: OrderHeaderSchema,
  lineItems: z.array(LineItemSchema).default([]),
  amounts: AmountsSchema.default({
    subtotal: null,
    discountTotal: null,
    taxTotal: null,
    freight: null,
    roundingAdjustment: null,
    grandTotal: null,
  }),
  headerAdjustments: z.array(HeaderAdjustmentSchema).default([]),
  evidence: z.array(EvidenceSchema).default([]),
});

export type StageADocument = z.infer<typeof StageADocumentSchema>;
export type LineItem = z.infer<typeof LineItemSchema>;
export type TaxDetail = z.infer<typeof TaxDetailSchema>;
export type Amounts = z.infer<typeof AmountsSchema>;
export type HeaderAdjustment = z.infer<typeof HeaderAdjustmentSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;

