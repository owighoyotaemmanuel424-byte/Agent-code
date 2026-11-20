export interface PreviewWaitOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  readonly requestTimeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly accept?: (status: number) => boolean;
}

export interface PreviewWaitResult {
  readonly ok: boolean;
  readonly url: string;
  readonly status?: number;
  readonly attempts: number;
  readonly elapsedMs: number;
  readonly lastError?: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls a preview URL until the server answers. Any response below 500 counts as
 * ready: the app may legitimately return 404 for `/`. Never throws on timeout.
 */
export const waitForPreview = async (
  url: string,
  options: PreviewWaitOptions = {},
): Promise<PreviewWaitResult> => {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 500;
  const requestTimeoutMs = options.requestTimeoutMs ?? 3000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const accept = options.accept ?? ((status: number) => status < 500);
  const startedAt = Date.now();
  let attempts = 0;
  let lastError: string | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    attempts += 1;
    try {
      const response = await fetchImpl(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      await response.body?.cancel();
      if (accept(response.status)) {
        return {
          ok: true,
          url,
          status: response.status,
          attempts,
          elapsedMs: Date.now() - startedAt,
        };
      }
      lastError = `HTTP ${String(response.status)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "request failed";
    }
    await sleep(intervalMs);
  }

  return {
    ok: false,
    url,
    attempts,
    elapsedMs: Date.now() - startedAt,
    ...(lastError === undefined ? {} : { lastError }),
  };
};
