export const OCR_IMAGE_MIMES = new Set(["image/png", "image/jpeg"]);

export interface OcrParser {
  parse(input: { bytes: ArrayBuffer; mimeType: string }): Promise<string>;
}

export function createOcrParser(parse: OcrParser["parse"]) {
  return {
    supports: (mimeType: string) => OCR_IMAGE_MIMES.has(mimeType),
    extract: ({ bytes, mimeType }: { bytes: ArrayBuffer; mimeType: string }) =>\n      parse({ bytes, mimeType }),
  };
}
