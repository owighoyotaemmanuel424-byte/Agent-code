export interface ObjectStorage {
  put(key: string, body: ArrayBuffer | ReadableStream | string, options?: { contentType?: string }): Promise<void>;
  get(key: string): Promise<unknown>;
  delete(key: string): Promise<void>;
}

export async function putFile(
  bucket: R2Bucket,
  key: string,
  body: ArrayBuffer | ReadableStream | string,
  contentType?: string,
) {
  await bucket.put(key, body, contentType ? { httpMetadata: { contentType } } : undefined);
}
