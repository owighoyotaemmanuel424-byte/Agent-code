export interface TextChunk { id: string; text: string; metadata: Record<string, string | number> }

export function chunkText(text: string, options: { chunkSize?: number; overlap?: number } = {}): string[] {
  const chunkSize = Math.max(200, options.chunkSize ?? 1200);
  const overlap = Math.min(Math.floor(chunkSize / 2), Math.max(0, options.overlap ?? 150));
  const normalized = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  const chunks: string[] = [];
  for (let start = 0; start < normalized.length; start += chunkSize - overlap) {
    const chunk = normalized.slice(start, start + chunkSize).trim();
    if (chunk) chunks.push(chunk);
    if (start + chunkSize >= normalized.length) break;
  }
  return chunks;
}
