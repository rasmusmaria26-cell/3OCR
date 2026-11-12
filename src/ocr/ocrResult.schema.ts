import { z } from 'zod';
import { BoundingBoxSchema } from '../core/schema/stageA.schema.js';

export { BoundingBoxSchema };
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;

export const OCRWordSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(100),
  bbox: BoundingBoxSchema,
  lineNum: z.number().int().nonnegative().optional(),
  wordNum: z.number().int().nonnegative().optional(),
  charStart: z.number().int().nonnegative().optional(),
  charEnd: z.number().int().nonnegative().optional(),
});
export type OCRWord = z.infer<typeof OCRWordSchema>;

export const OCRLineSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(100),
  bbox: BoundingBoxSchema,
  words: z.array(OCRWordSchema).default([]),
});
export type OCRLine = z.infer<typeof OCRLineSchema>;

export const OCRPageResultSchema = z.object({
  pageNumber: z.number().int().positive(),
  text: z.string(),
  confidence: z.number().min(0).max(100),
  lines: z.array(OCRLineSchema).default([]),
  words: z.array(OCRWordSchema).default([]),
  isScanned: z.boolean().default(true),
});
export type OCRPageResult = z.infer<typeof OCRPageResultSchema>;

export const OCRResultSchema = z.object({
  fullText: z.string(),
  pages: z.array(OCRPageResultSchema),
  averageConfidence: z.number().min(0).max(100),
  pageBreakOffsets: z.array(z.number().int().nonnegative()),
  provider: z.string().default('tesseract'),
  metadata: z.record(z.any()).optional(),
});
export type OCRResult = z.infer<typeof OCRResultSchema>;

export const OCRInputSchema = z.object({
  buffer: z.instanceof(Buffer),
  pageNumber: z.number().int().positive().default(1),
  language: z.string().default('eng'),
  options: z.record(z.any()).optional(),
});
export type OCRInput = z.infer<typeof OCRInputSchema>;
