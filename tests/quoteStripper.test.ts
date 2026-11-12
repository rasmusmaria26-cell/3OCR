import { describe, it, expect } from 'vitest';
import { stripEmailQuotes } from '../src/core/email/quoteStripper.js';

describe('Forwarded-PO Quote Stripper (Fix 11)', () => {
  it('strips "---------- Forwarded message ---------" headers and flags large chunk', () => {
    const rawEmail = `
Please find the PO attached.

---------- Forwarded message ---------
From: vendor-rep@acme.com
Date: Wed, Nov 11, 2026 at 10:00 AM
Subject: Internal discussions about pricing and discounts
To: team@supplier.com

Hi Team,
We had a lengthy discussion with procurement regarding the tier-2 discount structure.
Here are the previous meeting notes:
1. Pricing was originally set to $550.
2. We renegotiated to $500.
3. Quantity requested was 100 but adjusted to 10.
4. Additional freight terms are FOB Origin.
Let us know if there are any objections before finalizing the contract.
Thanks,
Vendor Team
`;

    const result = stripEmailQuotes(rawEmail);
    expect(result.cleanedText).toContain('Please find the PO attached.');
    expect(result.cleanedText).not.toContain('Internal discussions about pricing');
    expect(result.metadata.largeChunkRemoved).toBe(true);
    expect(result.metadata.charsRemoved).toBeGreaterThan(200);
    expect(result.metadata.ratio).toBeGreaterThan(0.4);
  });

  it('strips classic ">" quoted lines and "On ... wrote:" blocks', () => {
    const rawEmail = `
Confirmed. Order details below:
PO Number: PO-2026-99
Item: LAP-001
Qty: 5
Price: $500

On Nov 10, 2026, at 4:15 PM, John Buyer <john@client.com> wrote:
> Can you confirm if you have 5 laptops available?
> We need them urgently.
> Regards,
> John
`;

    const result = stripEmailQuotes(rawEmail);
    expect(result.cleanedText).toContain('PO Number: PO-2026-99');
    expect(result.cleanedText).toContain('Qty: 5');
    expect(result.cleanedText).not.toContain('Can you confirm if you have 5 laptops available?');
  });

  it('leaves clean emails intact without setting largeChunkRemoved', () => {
    const rawEmail = 'PO: PO-1001, Item: LAP-001, Qty: 10, Price: $500';
    const result = stripEmailQuotes(rawEmail);
    expect(result.cleanedText.trim()).toBe(rawEmail);
    expect(result.metadata.charsRemoved).toBe(0);
    expect(result.metadata.largeChunkRemoved).toBe(false);
  });
});

