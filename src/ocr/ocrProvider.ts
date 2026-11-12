import { OCRInput, OCRPageResult, OCRResult } from './ocrResult.schema.js';

export interface OCRProvider {
  readonly name: string;
  recognize(input: OCRInput): Promise<OCRPageResult>;
  recognizeDocument?(inputs: OCRInput[]): Promise<OCRResult>;
  terminate?(): Promise<void>;
}
