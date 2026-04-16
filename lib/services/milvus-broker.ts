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

const COLLECTION_NAME =
  process.env.MILVUS_COLLECTION_NAME || "customized_setup_hybrid";

// 스펙: HNSW + L2 + ef=100 (권장 균형값)
const DEFAULT_INDEX_INFO = {
  index_type: "HNSW",
  metric_type: "L2",
  params: { ef: 100 },
};

interface MilvusBrokerEntity {
  id?: string | number;
  file_name?: string;
  chunk_context?: string;
  category?: string;
  sub_category?: string;
}

interface MilvusBrokerHit {
  id: string | number;
  distance: number;
  entity?: MilvusBrokerEntity;
}

interface MilvusBrokerResponse {
  code: number;
  error_code?: string | null;
  error_message?: string | null;
  body?: MilvusBrokerHit[] | null;
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

function getFileFormat(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext || "unknown";
}

/**
 * RRF 점수는 "높을수록 관련도 높음". 결과 내 max 값으로 0~1 정규화.
 * (RRF 점수는 1/(k+rank) 합이라 절대값이 작음 → UI 표시용으로 상대 스케일 사용)
 */
function normalizeScores(hits: MilvusBrokerHit[]): number[] {
  if (hits.length === 0) return [];
  const distances = hits.map((h) => (typeof h.distance === "number" ? h.distance : 0));
  const max = Math.max(...distances);
  if (max <= 0) return distances.map(() => 0);
  return distances.map((d) => Number((d / max).toFixed(4)));
}

function buildSnippet(entity: MilvusBrokerEntity): string {
  const ctx = entity.chunk_context?.trim() || "";
  const page = entity.sub_category?.trim();
  // 페이지 정보가 있으면 스니펫 앞에 표시
  if (page && /^page_\d+$/i.test(page)) {
    const pageNum = page.replace(/^page_/i, "");
    return `[p.${pageNum}] ${ctx}`;
  }
  return ctx;
}

function toSearchResult(hit: MilvusBrokerHit, normalizedScore: number): SearchResult {
  const entity = hit.entity || {};
  const fileName = entity.file_name || "";
  return {
    document_id: String(entity.id ?? hit.id),
    file_name: fileName,
    score: normalizedScore,
    snippet: buildSnippet(entity),
    file_format: getFileFormat(fileName),
    rgst_dt: new Date().toISOString(),
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
    indexInfo: DEFAULT_INDEX_INFO,
    limit: top_k,
  };

  log.info({ method, userKey: user_key, top_k, collection: COLLECTION_NAME }, "milvus-broker 검색 요청");

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

    if (
      causeCode === "ECONNREFUSED" ||
      causeCode === "ENOTFOUND" ||
      causeCode === "EHOSTUNREACH"
    ) {
      log.error({ err, causeCode }, "milvus-broker 연결 실패");
      throw new MilvusBrokerError(
        "검색 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.",
        "UNAVAILABLE"
      );
    }
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

  // 스펙: HTTP 200이어도 code != 2000이면 실패
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

  const normalized = normalizeScores(hits);
  return hits.map((hit, idx) => toSearchResult(hit, normalized[idx]));
}
