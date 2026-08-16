import type { DocumentParser } from "@/workers/document-indexer";
import { createPdfParser } from "./pdf";
import { createOfficeParsers } from "./office";
import { createWorkersAiOcrParser } from "./ocr";
import pdfParse from "pdf-parse";

export function createDocumentParsers(ai?: Pick<Ai, "run">): DocumentParser[] {
  const parsers: DocumentParser[] = [
    createPdfParser(async (bytes) => {
      const result = await pdfParse(Buffer.from(bytes));
      return result.text;
    }),
    ...createOfficeParsers(),
  ];

  if (ai) parsers.push(createWorkersAiOcrParser(ai));
  return parsers;
}
