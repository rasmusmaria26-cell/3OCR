export interface LlmEmailExtractionOutput {
  poNumber?: string | null;
  poDate?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  currency?: string | null;
  lineItems?: Array<{
    productCode?: string | null;
    description?: string | null;
    quantity?: string | null;
    unitPrice?: string | null;
    lineTotal?: string | null;
    snippet?: string | null;
    rawValue?: string | null;
  }>;
  amounts?: {
    grandTotal?: string | null;
    snippet?: string | null;
    rawValue?: string | null;
  };
  evidenceSnippets?: Record<string, { snippet: string; rawValue: string }>;
}

export class MockLlmClient {
  private predefinedResponse: LlmEmailExtractionOutput | null = null;

  constructor(predefined?: LlmEmailExtractionOutput) {
    this.predefinedResponse = predefined || null;
  }

  setResponse(response: LlmEmailExtractionOutput): void {
    this.predefinedResponse = response;
  }

  async extractFromEmail(text: string): Promise<LlmEmailExtractionOutput> {
    if (this.predefinedResponse) {
      return this.predefinedResponse;
    }

    // Default mock behavior
    return {
      poNumber: 'PO-MOCK-1',
      customerId: 'CUST-MOCK',
      currency: 'USD',
      lineItems: [
        {
          productCode: 'LAP-001',
          description: 'Laptop',
          quantity: '5',
          snippet: '5 laptops',
          rawValue: '5',
        },
      ],
    };
  }
}

