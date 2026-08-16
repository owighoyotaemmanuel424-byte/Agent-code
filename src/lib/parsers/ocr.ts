export const OCR_IMAGE_MIMES = new Set(["image/png", "image/jpeg"]);

export interface OcrParser {
  parse(input: { bytes: ArrayBuffer; mimeType: string }): Promise<string>;
}

export function createOcrParser(parse: OcrParser["parse"]) {
  return {
    supports: (mimeType: string) => OCR_IMAGE_MIMES.has(mimeType),
    extract: ({ bytes, mimeType }: { bytes: ArrayBuffer; mimeType: string }) =>
      parse({ bytes, mimeType }),
  };
}

export function createWorkersAiOcrParser(ai: Pick<Ai, "run">) {
  return createOcrParser(async ({ bytes, mimeType }) => {
    const image = `data:${mimeType};base64,${arrayBufferToBase64(bytes)}`;
    const result = await ai.run("@cf/meta/llama-3.2-11b-vision-instruct", {
      messages: [
        {
          role: "user",
          content: "Extract all readable text from this image. Return only the extracted text, preserving useful line breaks and table-like structure.",
        },
      ],
      image,
      max_tokens: 4096,
    });

    const text = typeof result === "string"
      ? result
      : typeof result?.response === "string"
        ? result.response
        : typeof result?.result === "string"
          ? result.result
          : "";

    if (!text.trim()) throw new Error("OCR returned no text");
    return text;
  });
}

function arrayBufferToBase64(bytes: ArrayBuffer) {
  let binary = "";
  const view = new Uint8Array(bytes);
  const chunkSize = 0x8000;
  for (let offset = 0; offset < view.length; offset += chunkSize) {
    binary += String.fromCharCode(...view.subarray(offset, Math.min(offset + chunkSize, view.length)));
  }
  return btoa(binary);
}
