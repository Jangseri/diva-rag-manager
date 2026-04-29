import { createLogger } from "@/lib/logger";

const log = createLogger("extract-client");

const BASE_URL = process.env.EXTRACT_SERVICE_URL || "http://localhost:8010";
const REQUEST_TIMEOUT_MS = 10000;

export interface CrawlerOptions {
  max_pages?: number;
  max_depth?: number;
  allow_external_links?: boolean;
}

export interface UrlTaskRequest {
  file_id: string;
  url: string;
  user_key: string;
  collection_name?: string | null;
  crawler_options?: CrawlerOptions;
}

export interface UrlTaskResponse {
  task_id: string;
  file_id: string;
  status: string;
  source_type: "url";
  file_name: string;
  url: string;
  user_key: string;
  collection_name: string | null;
}

interface StandardResponse<T> {
  success: boolean;
  data?: T;
  message?: string | null;
  code?: number;
  error?: string;
}

export class ExtractClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = "ExtractClientError";
  }
}

async function request<T>(
  method: "POST" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: StandardResponse<T> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as StandardResponse<T>) : null;
    } catch {
      // JSON 파싱 실패는 아래 status 처리에서 일반 에러로
    }

    if (!res.ok || (parsed && parsed.success === false)) {
      const message =
        parsed?.message || parsed?.error || `extract-service ${res.status}`;
      throw new ExtractClientError(message, res.status);
    }

    if (!parsed || parsed.data === undefined) {
      throw new ExtractClientError("응답 형식이 올바르지 않습니다", res.status);
    }
    return parsed.data;
  } finally {
    clearTimeout(timer);
  }
}

export async function submitUrlTask(
  payload: UrlTaskRequest
): Promise<UrlTaskResponse> {
  log.info(
    { file_id: payload.file_id, url: payload.url, user_key: payload.user_key },
    "URL 추출 작업 등록 요청"
  );
  return request<UrlTaskResponse>("POST", "/v1/extract/tasks/url", payload);
}

export async function deleteUrlTask(file_id: string): Promise<void> {
  log.info({ file_id }, "URL 추출 작업 삭제 요청");
  await request<unknown>("DELETE", `/v1/extract/tasks/url/${file_id}`);
}
