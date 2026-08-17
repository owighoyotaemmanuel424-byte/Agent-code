import type { DocumentParser } from "@/workers/document-indexer";
import { createPdfParser } from "./pdf";
import { createOfficeParsers } from "./office";
import { createWorkersAiOcrParser } from "./ocr";

export function createDocumentParsers(ai?: Pick<Ai, "run">): DocumentParser[] {
  const parsers: DocumentParser[] = [createPdfParser(), ...createOfficeParsers()];

  if (ai) parsers.push(createWorkersAiOcrParser(ai));
  return parsers;
}
