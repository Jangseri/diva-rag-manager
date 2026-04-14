import { createLogger } from "@/lib/logger";
import type { SearchMethod, SearchResult } from "@/types";

const log = createLogger("milvus-broker");

export class MilvusBrokerError extends Error {
  constructor(
    message: string,
    public readonly code: "UNAVAILABLE" | "TIMEOUT" | "BAD_RESPONSE" | "UNKNOWN",
    public readonly status?: number
  ) {
    super(message);
    this.name = "MilvusBrokerError";
  }
}

const COLLECTION_NAME = process.env.MILVUS_COLLECTION_NAME || "llm_workcenter_v3";
const DEFAULT_INDEX_INFO = {
  index_type: "HNSW",
  metric_type: "L2",
  params: {},
};

interface MilvusBrokerEntity {
  id?: string;
  file_name?: string;
  chunk_context?: string;
  category?: string;
  sub_category?: string;
}

interface MilvusBrokerHit {
  id: string;
  distance: number;
  entity?: MilvusBrokerEntity;
}

interface MilvusBrokerResponse {
  code: number;
  error_code?: string | null;
  error_message?: string | null;
  body?: MilvusBrokerHit[];
}

function getBaseUrl(): string {
  const url = process.env.MILVUS_BROKER_URL;
  if (!url) {
    throw new Error("MILVUS_BROKER_URL 환경변수가 설정되지 않았습니다");
  }
  return url.replace(/\/+$/, "");
}

function getEndpoint(method: SearchMethod): string {
  const base = getBaseUrl();
  // Hybrid: dense + sparse(BGE-M3) + RRF
  // Vector (dense): dense만
  // BM25: 별도 엔드포인트 없음 → Hybrid 사용 (추후 지원 예정)
  if (method === "hybrid" || method === "bm25") {
    return `${base}/v2/collections/hybrid/workcenter/${COLLECTION_NAME}/partitions/search`;
  }
  return `${base}/v2/collections/workcenter/${COLLECTION_NAME}/partitions/search`;
}

/**
 * L2 distance를 0~1 score로 정규화.
 * distance는 작을수록 유사. 1 / (1 + distance) 공식 사용.
 */
function distanceToScore(distance: number): number {
  if (distance < 0) return 0;
  return Number((1 / (1 + distance)).toFixed(4));
}

function getFileFormat(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext || "unknown";
}

function toSearchResult(hit: MilvusBrokerHit): SearchResult {
  const entity = hit.entity || {};
  const fileName = entity.file_name || "";
  return {
    document_id: entity.id || hit.id,
    file_name: fileName,
    score: distanceToScore(hit.distance),
    snippet: entity.chunk_context || "",
    file_format: getFileFormat(fileName),
    rgst_dt: new Date().toISOString(), // milvus-broker 응답에 없으므로 현재 시각으로 대체
  };
}

export async function searchViaBroker(params: {
  query: string;
  method: SearchMethod;
  top_k: number;
  user_key: string;
}): Promise<SearchResult[]> {
  const { query, method, top_k, user_key } = params;
  const url = getEndpoint(method);

  const body = {
    dnis: user_key,
    message: query,
    index_info: DEFAULT_INDEX_INFO,
    limit: top_k,
  };

  log.info({ method, userKey: user_key, top_k }, "milvus-broker 검색 요청");

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const err = error as Error & { cause?: { code?: string } };
    const causeCode = err.cause?.code;

    // 연결 거부 / DNS / 네트워크
    if (causeCode === "ECONNREFUSED" || causeCode === "ENOTFOUND" || causeCode === "EHOSTUNREACH") {
      log.error({ err, causeCode }, "milvus-broker 연결 실패");
      throw new MilvusBrokerError(
        "검색 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.",
        "UNAVAILABLE"
      );
    }
    // 타임아웃
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      log.error({ err }, "milvus-broker 타임아웃");
      throw new MilvusBrokerError(
        "검색 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.",
        "TIMEOUT"
      );
    }

    log.error({ err }, "milvus-broker 요청 실패");
    throw new MilvusBrokerError(
      "검색 서비스와 통신 중 오류가 발생했습니다.",
      "UNKNOWN"
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    log.error({ status: res.status, body: text }, "milvus-broker HTTP 에러");
    throw new MilvusBrokerError(
      "검색 서비스가 일시적으로 응답할 수 없습니다.",
      "BAD_RESPONSE",
      res.status
    );
  }

  const data: MilvusBrokerResponse = await res.json();

  if (data.code !== 2000) {
    log.error(
      { code: data.code, errCode: data.error_code, errMsg: data.error_message },
      "milvus-broker 에러 응답"
    );
    throw new MilvusBrokerError(
      data.error_message || "검색 처리 중 오류가 발생했습니다.",
      "BAD_RESPONSE"
    );
  }

  const hits = data.body || [];
  log.info({ count: hits.length }, "milvus-broker 검색 결과");

  return hits.map(toSearchResult);
}
