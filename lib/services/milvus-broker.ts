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

// 스펙: HNSW (KURE-v1 dense / BGE-M3 sparse 인덱스 기준, 192.168.220.223:8009 검증 완료)
const DENSE_INDEX_INFO = {
  index_type: "HNSW",
  metric_type: "COSINE",
  params: {},
};
const SPARSE_INDEX_INFO = {
  index_type: "HNSW",
  metric_type: "IP",
  params: {},
};
const DEFAULT_RANKER = {
  type: "weighted",
  weights: { dense: 0.3, sparse: 0.7 },
};

interface MilvusBrokerEntity {
  id?: string | number;
  file_name?: string;
  chunk_context?: string;
  category?: string;
  sub_category?: string;
  url?: string;
}

interface MilvusBrokerHit {
  id: string | number;
  distance: number;
  entity?: MilvusBrokerEntity;
}

interface MilvusBrokerResponse {
  code: number;
  errCode?: string | null;
  errMessage?: string | null;
  body?: MilvusBrokerHit[] | null;
}

function getBaseUrl(): string {
  const url = process.env.MILVUS_BROKER_URL;
  if (!url) {
    throw new Error("MILVUS_BROKER_URL 환경변수가 설정되지 않았습니다");
  }
  return url.replace(/\/+$/, "");
}

function getEndpoint(method: SearchMethod, clientServiceId: string): string {
  const base = getBaseUrl();
  // Hybrid: dense + sparse(BGE-M3) + weighted ranker (workcenter 세그먼트 없음)
  // BM25: sparse 전용 엔드포인트
  // Vector: dense 전용 엔드포인트
  if (method === "hybrid") {
    return `${base}/v2/collections/hybrid/${clientServiceId}/partitions/search`;
  }
  if (method === "bm25") {
    return `${base}/v2/collections/sparse/workcenter/${clientServiceId}/partitions/search`;
  }
  return `${base}/v2/collections/workcenter/${clientServiceId}/partitions/search`;
}

function buildRequestBody(
  method: SearchMethod,
  params: { query: string; top_k: number; tenantId: string }
) {
  const { query, top_k, tenantId } = params;
  const base = { tenant_id: tenantId, message: query, limit: top_k };

  if (method === "bm25") {
    return { ...base, index_info: SPARSE_INDEX_INFO };
  }
  if (method === "hybrid") {
    return { ...base, index_info: DENSE_INDEX_INFO, ranker: DEFAULT_RANKER };
  }
  return { ...base, index_info: DENSE_INDEX_INFO };
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
  tenantId: string;
  clientServiceId: string;
}): Promise<SearchResult[]> {
  const { query, method, top_k, tenantId, clientServiceId } = params;
  const url = getEndpoint(method, clientServiceId);
  const body = buildRequestBody(method, { query, top_k, tenantId });

  log.info({ method, tenantId, clientServiceId, top_k }, "milvus-broker 검색 요청");

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
      { code: data.code, errCode: data.errCode, errMsg: data.errMessage },
      "milvus-broker 에러 응답"
    );
    throw new MilvusBrokerError(
      data.errMessage || "검색 처리 중 오류가 발생했습니다.",
      "BAD_RESPONSE"
    );
  }

  const hits = data.body || [];
  log.info({ count: hits.length }, "milvus-broker 검색 결과");

  const normalized = normalizeScores(hits);
  return hits.map((hit, idx) => toSearchResult(hit, normalized[idx]));
}
