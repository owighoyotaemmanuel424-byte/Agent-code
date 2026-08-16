import pdfParse from "pdf-parse";

export const PDF_MIME = "application/pdf";

export interface PdfParser {
  parse(bytes: ArrayBuffer): Promise<string>;
}

export async function parsePdf(bytes: ArrayBuffer): Promise<string> {
  const buffer = Buffer.from(bytes);
  const result = await pdfParse(buffer);
  return result.text.trim();
}

export function createPdfParser(parse: PdfParser["parse"] = parsePdf) {
  return {
    supports: (mimeType: string) => mimeType === PDF_MIME,
    extract: ({ bytes }: { bytes: ArrayBuffer }) => parse(bytes),
  };
}
