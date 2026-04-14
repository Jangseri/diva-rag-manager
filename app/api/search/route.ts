export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { SearchQuerySchema } from "@/lib/validators/document";
import { errorResponse, validationErrorResponse } from "@/lib/api-response";
import { createLogger } from "@/lib/logger";
import { getCurrentUser } from "@/lib/auth";
import {
  searchViaBroker,
  MilvusBrokerError,
} from "@/lib/services/milvus-broker";
import type { SearchResponse } from "@/types";

const log = createLogger("api/search");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = SearchQuerySchema.safeParse(body);

    if (!parsed.success) {
      return validationErrorResponse("잘못된 검색 요청입니다");
    }

    const { query, method, top_k } = parsed.data;
    const currentUser = getCurrentUser();

    const results = await searchViaBroker({
      query,
      method,
      top_k,
      user_key: currentUser.user_key,
    });

    const response: SearchResponse = {
      results,
      method,
      query,
      total: results.length,
    };

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof MilvusBrokerError) {
      // 503: 서비스 일시적 불가 (연결 실패, 타임아웃, 응답 오류)
      const statusCode =
        error.code === "UNAVAILABLE" || error.code === "TIMEOUT"
          ? 503
          : error.code === "BAD_RESPONSE"
            ? 502
            : 500;
      return errorResponse(error.message, statusCode);
    }
    log.error({ err: error }, "검색 실패");
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
