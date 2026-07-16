export const REQUEST_POLICY = {
  attempts: 2,
  baseDelayMs: 200,
  maxRetryAfterMs: 5_000
} as const;

export class HttpRequestError extends Error {
  status: number | null;
  retryAfterMs: number | null;

  constructor(message: string, status: number | null = null, retryAfterMs: number | null = null) {
    super(message);
    this.name = "HttpRequestError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const RETRYABLE_5XX = new Set([502, 503, 504]);
const RETRYABLE_4XX = new Set([408, 429]);

function isRetryableStatus(status: number) {
  return RETRYABLE_4XX.has(status) || RETRYABLE_5XX.has(status);
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
  }
  const epochMs = Date.parse(trimmed);
  if (Number.isFinite(epochMs)) return Math.max(0, epochMs - Date.now());
  return null;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export type FetchPolicy = {
  attempts?: number;
  baseDelayMs?: number;
  /**
   * If true, the caller's cache is still usable and a 5xx response should
   * surface immediately rather than trigger another network round-trip.
   * 408/429 still retry because they are explicitly transient.
   */
  skipRetryOn5xx?: boolean;
};

/** Shared policy for idempotent client reads. Mutation retries require explicit idempotency and are intentionally excluded. */
export async function fetchJsonWithRetry<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  policy: FetchPolicy = {}
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    throw new Error("fetchJsonWithRetry only supports idempotent reads");
  }

  const attempts = policy.attempts ?? REQUEST_POLICY.attempts;
  const baseDelayMs = policy.baseDelayMs ?? REQUEST_POLICY.baseDelayMs;
  const skipRetryOn5xx = policy.skipRetryOn5xx ?? false;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response | null = null;
    try {
      response = await fetch(input, init);
      if (response.ok) return await response.json() as T;
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      const error = new HttpRequestError(
        `Request failed with status ${response.status}`,
        response.status,
        retryAfter
      );
      const is5xx = response.status >= 500;
      const shouldSkip5xx = is5xx && skipRetryOn5xx;
      if (shouldSkip5xx || !isRetryableStatus(response.status) || attempt === attempts - 1) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (error instanceof HttpRequestError) {
        const is5xx = typeof error.status === "number" && error.status >= 500;
        const shouldSkip5xx = is5xx && skipRetryOn5xx;
        const retryable = shouldSkip5xx
          ? false
          : isRetryableStatus(error.status ?? 0);
        if (!retryable || attempt === attempts - 1) throw error;
      } else if (attempt === attempts - 1) {
        throw error;
      }
    }
    const retryAfter = lastError instanceof HttpRequestError ? lastError.retryAfterMs : null;
    const backoff = baseDelayMs * 2 ** attempt;
    const waitMs = retryAfter !== null
      ? Math.min(Math.max(retryAfter, baseDelayMs), REQUEST_POLICY.maxRetryAfterMs)
      : backoff;
    await delay(waitMs);
    response = null;
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed");
}
