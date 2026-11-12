/**
 * Inbound Email & Attachment Parser
 * Unpacks real-time incoming webhook emails or raw RFC 822 .eml files.
 * Extracts email text body and any attached PDF files for atomic ingestion.
 */

export interface ParsedInboundEmail {
  senderEmail: string | null;
  subject: string | null;
  bodyText: string;
  pdfAttachments: Array<{
    filename: string;
    buffer: Buffer;
  }>;
  spfStatus?: 'PASS' | 'FAIL' | 'SOFTFAIL' | 'NONE' | null;
  dkimStatus?: 'PASS' | 'FAIL' | 'NONE' | null;
}

export function parseInboundWebhook(params: {
  body: Record<string, any>;
  files?: Array<{ originalname: string; mimetype: string; buffer: Buffer }>;
}): ParsedInboundEmail {
  const { body, files = [] } = params;

  // 1. Extract sender
  let senderEmail: string | null = null;
  const rawFrom = body.from || body.sender || body.From || body.senderEmail || '';
  const fromMatch = /<([^>]+)>|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/.exec(rawFrom);
  if (fromMatch) {
    senderEmail = fromMatch[1] || fromMatch[2];
  }

  // 2. Extract subject
  const subject: string | null = body.subject || body.Subject || null;

  // 3. Extract email body text
  let bodyText = body.text || body.body || body['stripped-text'] || body.cleanedText || '';
  if (!bodyText && body.html) {
    // Strip simple HTML tags if only HTML is provided
    bodyText = body.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (!bodyText && body.rawText) {
    bodyText = body.rawText;
  }

  // 4. Extract attached PDFs from multipart files
  const pdfAttachments: Array<{ filename: string; buffer: Buffer }> = [];
  for (const f of files) {
    const isPdf =
      f.mimetype === 'application/pdf' ||
      f.originalname?.toLowerCase().endsWith('.pdf') ||
      (f.buffer && f.buffer.slice(0, 5).toString('ascii') === '%PDF-');

    if (isPdf) {
      pdfAttachments.push({
        filename: f.originalname || 'attachment.pdf',
        buffer: f.buffer,
      });
    }
  }

  // 5. If bodyText was a full raw .eml buffer, also check for inline base64 attachments
  if (bodyText.includes('Content-Type: application/pdf') || bodyText.includes('filename=')) {
    const extractedFromEml = extractPdfFromRawEml(bodyText);
    if (extractedFromEml) {
      pdfAttachments.push(extractedFromEml);
    }
  }

  // 6. Security auth statuses (from SendGrid / Postmark headers if present)
  let spfStatus: 'PASS' | 'FAIL' | 'SOFTFAIL' | 'NONE' | null = null;
  let dkimStatus: 'PASS' | 'FAIL' | 'NONE' | null = null;

  const spf = (body.spf || body['SPF'] || '').toLowerCase();
  if (spf.includes('pass')) spfStatus = 'PASS';
  else if (spf.includes('fail')) spfStatus = 'FAIL';

  const dkim = (body.dkim || body['DKIM'] || '').toLowerCase();
  if (dkim.includes('pass')) dkimStatus = 'PASS';
  else if (dkim.includes('fail')) dkimStatus = 'FAIL';

  return {
    senderEmail,
    subject,
    bodyText,
    pdfAttachments,
    spfStatus,
    dkimStatus,
  };
}

export function extractPdfFromRawEml(emlContent: string): { filename: string; buffer: Buffer } | null {
  try {
    const pdfSectionRegex = /Content-Type:\s*application\/pdf[^;]*;\s*name="?([^"\r\n]+)"?[\s\S]*?Content-Transfer-Encoding:\s*base64\s*\r?\n\r?\n([\s\S]*?)(?=\r?\n--|$)/i;
    const match = pdfSectionRegex.exec(emlContent);
    if (match) {
      const filename = match[1] || 'attached-document.pdf';
      const cleanBase64 = match[2].replace(/\s+/g, '');
      const buf = Buffer.from(cleanBase64, 'base64');
      return { filename, buffer: buf };
    }
  } catch {
    // ignore
  }
  return null;
}
