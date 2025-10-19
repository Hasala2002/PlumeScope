import axios from "axios";

export const http = axios.create({
  timeout: 8000,
  headers: {
    "User-Agent": "plumescope-api/0.1",
    Accept: "application/json",
  },
  // 'validateStatus' lets us treat 5xx as errors we can retry
  validateStatus: (status) => status >= 200 && status < 300,
});

export type RetryOptions = {
  retries?: number; // total attempts (including the first)
  backoffMs?: number; // base backoff
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function getJsonWithRetry<T>(
  url: string,
  params: Record<string, any>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = Math.max(1, opts.retries ?? 3);
  const backoffMs = opts.backoffMs ?? 250;
  let attempt = 0;
  let lastErr: any;
  while (attempt < retries) {
    try {
      const res = await http.get<T>(url, { params });
      return res.data as T;
    } catch (e: any) {
      lastErr = e;
      const status = e?.response?.status;
      const isRetryable =
        e.code === "ECONNABORTED" || // timeout
        e.code === "ECONNRESET" ||
        (typeof status === "number" && status >= 500 && status < 600);
      attempt++;
      if (!isRetryable || attempt >= retries) break;
      await sleep(backoffMs * attempt);
    }
  }
  throw lastErr;
}
