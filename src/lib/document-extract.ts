export async function extractPlainText(object: R2Object): Promise<string> {
  const bytes = await object.arrayBuffer();
  return new TextDecoder().decode(bytes);
}

export function supportedTextMime(type: string) {
  return type === "text/plain" || type === "text/csv";
}
