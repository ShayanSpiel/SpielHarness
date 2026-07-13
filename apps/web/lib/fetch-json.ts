export const REQUEST_POLICY = {
  attempts: 3,
  baseDelayMs: 250,
} as const;

export class HttpRequestError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "HttpRequestError";
    this.status = status;
  }
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Shared policy for idempotent client reads. Mutation retries require explicit idempotency and are intentionally excluded. */
export async function fetchJsonWithRetry<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  policy: { attempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    throw new Error("fetchJsonWithRetry only supports idempotent reads");
  }

  const attempts = policy.attempts ?? REQUEST_POLICY.attempts;
  const baseDelayMs = policy.baseDelayMs ?? REQUEST_POLICY.baseDelayMs;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (response.ok) return await response.json() as T;
      const error = new HttpRequestError(`Request failed with status ${response.status}`, response.status);
      if (!isRetryableStatus(response.status) || attempt === attempts - 1) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      const retryable = !(error instanceof HttpRequestError) || error.status === null || isRetryableStatus(error.status);
      if (!retryable || attempt === attempts - 1) throw error;
    }
    await delay(baseDelayMs * 2 ** attempt);
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed");
}
