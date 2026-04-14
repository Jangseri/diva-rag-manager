export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  getDocument,
  softDeleteDocument,
} from "@/lib/services/document-service";
import { toDocumentResponse, errorResponse } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { publishDocumentDeleted } from "@/lib/services/event-publisher";

const log = createLogger("api/documents/[id]");

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const doc = await getDocument(id);

    if (!doc) {
      return errorResponse("문서를 찾을 수 없습니다", 404);
    }

    return NextResponse.json({ data: toDocumentResponse(doc) });
  } catch (error) {
    log.error({ err: error }, "문서 상세 조회 실패");
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const currentUser = getCurrentUser();

    const doc = await softDeleteDocument(id, currentUser.name);
    log.info({ uuid: id, userKey: currentUser.user_key }, "문서 소프트 삭제");

    // Redis Stream에 DOCUMENT_DELETED 발행
    await publishDocumentDeleted({
      uuid: id,
      user_key: currentUser.user_key,
    });

    return NextResponse.json({
      success: true,
      data: toDocumentResponse(doc),
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "문서를 찾을 수 없습니다") {
        return errorResponse(error.message, 404);
      }
      if (error.message === "이미 삭제된 문서입니다") {
        return errorResponse(error.message, 409);
      }
    }
    log.error({ err: error }, "문서 삭제 실패");
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
