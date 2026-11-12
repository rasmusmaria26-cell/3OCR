import { z } from 'zod';
import { StageADocumentSchema } from './stageA.schema.js';

export const ResolutionOriginSchema = z.enum([
  'DOCUMENT',
  'CUSTOMER_DEFAULT',
  'CUSTOMER_ALIAS',
  'UNKNOWN',
]);

export const ResolvedValueSchema = z.object({
  value: z.string().nullable(),
  origin: ResolutionOriginSchema,
  configVersion: z.string().nullable().default(null),
});

export const NormalizedLineItemSchema = z.object({
  originalIndex: z.number().int(),
  normalizedProductCode: z.string().nullable(),
  productCodeOrigin: ResolutionOriginSchema,
  normalizedUom: z.string().nullable(),
  uomOrigin: ResolutionOriginSchema,
  quantity: z.string().nullable(),
  unitPrice: z.string().nullable(),
  lineTotal: z.string().nullable(),
});

export const NormalizationLogEntrySchema = z.object({
  field: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  rule: z.string(),
  reason: z.string(),
});

export const StageBDocumentSchema = z.object({
  stageA: StageADocumentSchema,
  normalizedOrder: z.object({
    normalizedCustomerId: z.string(),
    normalizedPoNumber: z.string(),
    resolvedCurrency: ResolvedValueSchema,
  }),
  normalizedLineItems: z.array(NormalizedLineItemSchema),
  normalizationLogs: z.array(NormalizationLogEntrySchema).default([]),
});

export type StageBDocument = z.infer<typeof StageBDocumentSchema>;
export type NormalizedLineItem = z.infer<typeof NormalizedLineItemSchema>;
export type NormalizationLogEntry = z.infer<typeof NormalizationLogEntrySchema>;

