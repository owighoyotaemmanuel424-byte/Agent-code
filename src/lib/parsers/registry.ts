import type { DocumentParser } from "@/workers/document-indexer";
import { createPdfParser } from "./pdf";
import { createOfficeParsers } from "./office";
import pdfParse from "pdf-parse";

export function createDocumentParsers(): DocumentParser[] {
  return [
    createPdfParser(async (bytes) => {
      const result = await pdfParse(Buffer.from(bytes));
      return result.text;
    }),
    ...createOfficeParsers(),
  ];
}
