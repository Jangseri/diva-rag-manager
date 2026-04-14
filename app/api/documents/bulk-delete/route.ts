export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { softDeleteDocument } from "@/lib/services/document-service";
import { errorResponse, validationErrorResponse } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { publishDocumentDeleted } from "@/lib/services/event-publisher";

const log = createLogger("api/documents/bulk-delete");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const ids = body?.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return validationErrorResponse("삭제할 문서 ID 목록이 필요합니다");
    }

    if (ids.length > 100) {
      return validationErrorResponse("한 번에 최대 100개까지 삭제할 수 있습니다");
    }

    const currentUser = getCurrentUser();
    const success: string[] = [];
    const failed: { uuid: string; error: string }[] = [];

    for (const id of ids) {
      if (typeof id !== "string") {
        failed.push({ uuid: String(id), error: "잘못된 ID" });
        continue;
      }
      try {
        await softDeleteDocument(id, currentUser.name);
        success.push(id);

        // Redis Stream에 DOCUMENT_DELETED 발행 (개별 발행)
        await publishDocumentDeleted({
          uuid: id,
          user_key: currentUser.user_key,
        });
      } catch (error) {
        failed.push({
          uuid: id,
          error: error instanceof Error ? error.message : "삭제 실패",
        });
      }
    }

    log.info(
      { userKey: currentUser.user_key, success: success.length, failed: failed.length },
      "일괄 삭제 완료"
    );
    return NextResponse.json({ success, failed });
  } catch (error) {
    log.error({ err: error }, "일괄 삭제 실패");
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
