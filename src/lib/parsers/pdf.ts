import { Buffer } from "node:buffer";

export const PDF_MIME = "application/pdf";

export interface PdfParser {
  parse(bytes: ArrayBuffer): Promise<string>;
}

export async function parsePdf(bytes: ArrayBuffer): Promise<string> {
  const buffer = Buffer.from(bytes);
  const module = await import("pdf-parse") as unknown as Record<string, unknown>;
  const parse = (module.default ?? module) as ((input: Buffer) => Promise<{ text: string }>);
  const result = await parse(buffer);
  return result.text.trim();
}

export function createPdfParser(parse: PdfParser["parse"] = parsePdf) {
  return {
    supports: (mimeType: string) => mimeType === PDF_MIME,
    extract: ({ bytes }: { bytes: ArrayBuffer }) => parse(bytes),
  };
}
