export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { initiateDeletion } from "@/lib/services/deletion-gate";
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
    const failed: { file_id: string; error: string }[] = [];

    for (const id of ids) {
      if (typeof id !== "string") {
        failed.push({ file_id: String(id), error: "잘못된 ID" });
        continue;
      }
      try {
        const doc = await initiateDeletion(id, currentUser.name);
        success.push(id);

        await publishDocumentDeleted({
          file_id: id,
          user_key: currentUser.user_key,
          collection_name: doc.collection_name,
        });
      } catch (error) {
        failed.push({
          file_id: id,
          error: error instanceof Error ? error.message : "삭제 개시 실패",
        });
      }
    }

    log.info(
      {
        userKey: currentUser.user_key,
        success: success.length,
        failed: failed.length,
      },
      "일괄 삭제 개시"
    );

    // 202 Accepted: confirmation gate 통과 후 실제 삭제
    return NextResponse.json({ success, failed }, { status: 202 });
  } catch (error) {
    log.error({ err: error }, "일괄 삭제 실패");
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
