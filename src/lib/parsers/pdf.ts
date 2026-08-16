export const PDF_MIME = "application/pdf";

export interface PdfParser {
  parse(bytes: ArrayBuffer): Promise<string>;
}

/**
 * PDF parsing intentionally lives behind a small adapter so the parser
 * implementation can run in a dedicated Node-compatible ingestion worker
 * without increasing the Cloudflare request/worker bundle.
 */
export function createPdfParser(parse: PdfParser["parse"]) {
  return {
    supports: (mimeType: string) => mimeType === PDF_MIME,
    extract: ({ bytes }: { bytes: ArrayBuffer }) => parse(bytes),
  };
}
