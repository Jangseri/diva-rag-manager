export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getDocument } from "@/lib/services/document-service";
import { initiateDeletion } from "@/lib/services/deletion-gate";
import { toDocumentResponse, errorResponse } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { publishDocumentDeleted } from "@/lib/services/event-publisher";
import { deleteUrlTask } from "@/lib/services/extract-client";
import type { DocumentRecord } from "@/types";

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

    // 삭제 프로세스 개시 (status=DELETING, confirmation row 생성)
    const doc = (await initiateDeletion(id, currentUser.name)) as DocumentRecord;
    log.info(
      { file_id: id, userKey: currentUser.user_key, source_type: doc.source_type },
      "삭제 프로세스 개시"
    );

    if (doc.source_type === "url") {
      // URL 케이스: HTTP DELETE로 extract-service 호출 (스트림 발행 X)
      try {
        await deleteUrlTask(id);
      } catch (err) {
        log.error({ err, file_id: id }, "extract-service URL 삭제 호출 실패");
        // 호출 실패해도 status=DELETING 유지 → gate 타임아웃 시 PARTIAL_FAILURE
      }
    } else {
      // FILE 케이스: DOCUMENT_DELETED 발행 → extract, milvus가 각자 처리
      await publishDocumentDeleted({
        file_id: id,
        user_key: currentUser.user_key,
        collection_name: doc.collection_name,
      });
    }

    // 202 Accepted: 처리 접수됨, 실제 삭제는 confirmation gate 통과 후
    return NextResponse.json(
      {
        success: true,
        data: toDocumentResponse(doc),
        message: "삭제 요청이 접수되었습니다. 처리 완료까지 최대 5분 소요됩니다.",
      },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "문서를 찾을 수 없습니다") {
        return errorResponse(error.message, 404);
      }
      if (error.message === "이미 삭제 처리 중이거나 삭제된 문서입니다") {
        return errorResponse(error.message, 409);
      }
    }
    log.error({ err: error }, "문서 삭제 실패");
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
