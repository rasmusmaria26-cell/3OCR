import { createWorker, Worker } from 'tesseract.js';
import { OCRProvider } from './ocrProvider.js';
import {
  OCRInput,
  OCRInputSchema,
  OCRPageResult,
  OCRResult,
  OCRWord,
  OCRLine,
} from './ocrResult.schema.js';

export interface TesseractProviderOptions {
  language?: string;
  maxWorkers?: number;
  logger?: (arg: any) => void;
}

export class TesseractProvider implements OCRProvider {
  public readonly name = 'tesseract';
  private readonly language: string;
  private readonly maxWorkers: number;
  private readonly logger?: (arg: any) => void;

  private idleWorkers: Worker[] = [];
  private activeCount = 0;
  private isTerminated = false;
  private waitingQueue: Array<{
    resolve: (worker: Worker) => void;
    reject: (err: any) => void;
  }> = [];

  constructor(options?: TesseractProviderOptions) {
    this.language = options?.language || 'eng';
    this.maxWorkers = Math.max(1, options?.maxWorkers || 2);
    this.logger = options?.logger;
  }

  private async createSingleWorker(): Promise<Worker> {
    const worker = await createWorker(this.language, 1, {
      errorHandler: (err) => {
        if (this.logger) {
          this.logger({ level: 'error', message: 'Tesseract worker internal error', error: err });
        }
      },
    });
    return worker;
  }

  private async acquireWorker(): Promise<Worker> {
    if (this.isTerminated) {
      throw new Error('TesseractProvider has been terminated');
    }

    if (this.idleWorkers.length > 0) {
      this.activeCount++;
      return this.idleWorkers.pop()!;
    }

    if (this.activeCount < this.maxWorkers) {
      this.activeCount++;
      try {
        const worker = await this.createSingleWorker();
        return worker;
      } catch (err) {
        this.activeCount--;
        throw err;
      }
    }

    return new Promise<Worker>((resolve, reject) => {
      this.waitingQueue.push({ resolve, reject });
    });
  }

  private async releaseWorker(worker: Worker, isHealthy = true): Promise<void> {
    if (this.isTerminated || !isHealthy) {
      try {
        await worker.terminate();
      } catch {
        // ignore termination errors on unhealthy worker
      }
      this.activeCount = Math.max(0, this.activeCount - 1);
    } else {
      if (this.waitingQueue.length > 0) {
        const next = this.waitingQueue.shift()!;
        next.resolve(worker);
        return;
      }
      this.idleWorkers.push(worker);
      this.activeCount = Math.max(0, this.activeCount - 1);
    }

    // If an unhealthy worker was discarded and queue still has pending jobs, spin up replacement
    if (!isHealthy && this.waitingQueue.length > 0 && !this.isTerminated) {
      const next = this.waitingQueue.shift()!;
      this.activeCount++;
      this.createSingleWorker()
        .then((newWorker) => next.resolve(newWorker))
        .catch((err) => {
          this.activeCount = Math.max(0, this.activeCount - 1);
          next.reject(err);
        });
    }
  }

  public async recognize(input: OCRInput): Promise<OCRPageResult> {
    const validatedInput = OCRInputSchema.parse(input);
    const worker = await this.acquireWorker();
    let isHealthy = true;

    try {
      const result = await worker.recognize(
        validatedInput.buffer,
        validatedInput.options || {},
        { text: true, blocks: true }
      );

      const rawText = result.data.text || '';
      const words: OCRWord[] = [];
      const lines: OCRLine[] = [];

      let searchIdx = 0;
      if (result.data.blocks && Array.isArray(result.data.blocks)) {
        let lineNum = 0;
        for (const block of result.data.blocks) {
          if (!block.paragraphs) continue;
          for (const para of block.paragraphs) {
            if (!para.lines) continue;
            for (const line of para.lines) {
              const lineWords: OCRWord[] = [];
              let wordNum = 0;
              if (line.words) {
                for (const w of line.words) {
                  const rawWordText = w.text || '';
                  const cleanWordText = rawWordText.trim();
                  if (!cleanWordText) continue;

                  let charStart = rawText.indexOf(cleanWordText, searchIdx);
                  if (charStart === -1) {
                    charStart = rawText.indexOf(cleanWordText);
                  }
                  const charEnd = charStart !== -1 ? charStart + cleanWordText.length : undefined;
                  if (charStart !== -1 && charStart >= searchIdx) {
                    searchIdx = charEnd!;
                  }

                  const wordObj: OCRWord = {
                    text: cleanWordText,
                    confidence:
                      typeof w.confidence === 'number'
                        ? Math.max(0, Math.min(100, Math.round(w.confidence)))
                        : 0,
                    bbox: {
                      x0: w.bbox?.x0 ?? 0,
                      y0: w.bbox?.y0 ?? 0,
                      x1: w.bbox?.x1 ?? 0,
                      y1: w.bbox?.y1 ?? 0,
                    },
                    lineNum,
                    wordNum,
                    charStart: charStart !== -1 ? charStart : undefined,
                    charEnd,
                  };
                  words.push(wordObj);
                  lineWords.push(wordObj);
                  wordNum++;
                }
              }

              lines.push({
                text: (line.text || '').trim(),
                confidence:
                  typeof line.confidence === 'number'
                    ? Math.max(0, Math.min(100, Math.round(line.confidence)))
                    : 0,
                bbox: {
                  x0: line.bbox?.x0 ?? 0,
                  y0: line.bbox?.y0 ?? 0,
                  x1: line.bbox?.x1 ?? 0,
                  y1: line.bbox?.y1 ?? 0,
                },
                words: lineWords,
              });
              lineNum++;
            }
          }
        }
      }

      const avgConfidence =
        words.length > 0
          ? Math.round(words.reduce((sum, w) => sum + w.confidence, 0) / words.length)
          : typeof result.data.confidence === 'number'
          ? Math.max(0, Math.min(100, Math.round(result.data.confidence)))
          : 0;

      return {
        pageNumber: validatedInput.pageNumber,
        text: rawText,
        confidence: avgConfidence,
        lines,
        words,
        isScanned: true,
      };
    } catch (err: any) {
      isHealthy = false;
      throw new Error(`OCR_RECOGNITION_FAILED: ${err?.message || 'Recognition execution error'}`);
    } finally {
      await this.releaseWorker(worker, isHealthy);
    }
  }

  public async recognizeDocument(inputs: OCRInput[]): Promise<OCRResult> {
    const pages: OCRPageResult[] = [];
    const pageBreakOffsets: number[] = [0];
    let fullText = '';

    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const pageResult = await this.recognize(input);
      pages.push(pageResult);

      if (i === 0) {
        fullText = pageResult.text;
      } else {
        pageBreakOffsets.push(fullText.length + 2);
        fullText += '\n\n' + pageResult.text;
      }
    }

    const totalConf = pages.reduce((sum, p) => sum + p.confidence, 0);
    const averageConfidence = pages.length > 0 ? Math.round(totalConf / pages.length) : 0;

    return {
      fullText,
      pages,
      averageConfidence,
      pageBreakOffsets,
      provider: this.name,
    };
  }

  public async terminate(): Promise<void> {
    this.isTerminated = true;

    // Reject any queued requests
    while (this.waitingQueue.length > 0) {
      const next = this.waitingQueue.shift()!;
      next.reject(new Error('TesseractProvider terminated'));
    }

    // Terminate all idle workers
    const workersToClose = [...this.idleWorkers];
    this.idleWorkers = [];
    await Promise.all(
      workersToClose.map(async (w) => {
        try {
          await w.terminate();
        } catch {
          // ignore
        }
      })
    );
    this.activeCount = 0;
  }
}
