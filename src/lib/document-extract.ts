const TEXT_TYPES = new Set(["text/plain", "text/csv"]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);
const BINARY_TYPES = new Set([
  "application/pdf",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export async function extractPlainText(object: R2ObjectBody): Promise<string> {
  const type = object.httpMetadata?.contentType ?? "";

  if (TEXT_TYPES.has(type)) {
    return new TextDecoder().decode(await object.arrayBuffer());
  }

  if (IMAGE_TYPES.has(type)) {
    throw new Error(`Image extraction requires OCR: ${type}`);
  }
  if (BINARY_TYPES.has(type)) {
    throw new Error(`Binary document parser is not configured: ${type}`);
  }
  throw new Error(`Unsupported document type: ${type || "unknown"}`);
}

export function supportedTextMime(type: string) {
  return TEXT_TYPES.has(type);
}

export function supportedDocumentMime(type: string) {
  return TEXT_TYPES.has(type) || IMAGE_TYPES.has(type) || BINARY_TYPES.has(type);
}
