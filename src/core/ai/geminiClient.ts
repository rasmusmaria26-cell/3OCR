/**
 * 3OCR Gemini AI Client
 * Lightweight, direct REST integration with Google Gemini API.
 * Uses GEMINI_API_KEY or GOOGLE_API_KEY from environment.
 */

export interface GeminiContentPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string; // base64 encoded
  };
}

export interface GeminiGenerateOptions {
  model?: string;
  systemInstruction?: string;
  responseSchema?: Record<string, any>;
  temperature?: number;
}

export class GeminiClient {
  private apiKey: string | null;
  private defaultModel: string;

  constructor(apiKey?: string, defaultModel = 'gemini-2.5-flash') {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
    this.defaultModel = defaultModel;
  }

  public isAvailable(): boolean {
    return !!this.apiKey && this.apiKey.trim().length > 0;
  }

  public async generateContent(
    parts: (string | GeminiContentPart)[],
    options: GeminiGenerateOptions = {}
  ): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY is not set in environment.');
    }

    const model = options.model || this.defaultModel;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

    const formattedParts: GeminiContentPart[] = parts.map((p) => {
      if (typeof p === 'string') {
        return { text: p };
      }
      return p;
    });

    const requestBody: Record<string, any> = {
      contents: [
        {
          role: 'user',
          parts: formattedParts,
        },
      ],
      generationConfig: {
        temperature: options.temperature ?? 0.1,
      },
    };

    if (options.systemInstruction) {
      requestBody.systemInstruction = {
        parts: [{ text: options.systemInstruction }],
      };
    }

    if (options.responseSchema) {
      requestBody.generationConfig.responseMimeType = 'application/json';
      requestBody.generationConfig.responseSchema = options.responseSchema;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    const candidate = data.candidates?.[0];
    const textPart = candidate?.content?.parts?.[0]?.text;

    if (!textPart) {
      throw new Error('No text returned in Gemini API response.');
    }

    return textPart;
  }
}

export const defaultGeminiClient = new GeminiClient();
