export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { Readable } from "stream";
import { getDocument } from "@/lib/services/document-service";
import {
  fileExists,
  createFileReadStream,
  getFileSize,
} from "@/lib/file-storage";
import { ORIGIN_PATH, ALLOWED_MIME_TYPES } from "@/lib/constants";
import { errorResponse } from "@/lib/api-response";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/documents/[id]/download");

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
    if (doc.status === "DELETED") {
      return errorResponse("삭제된 문서는 다운로드할 수 없습니다", 410);
    }

    const ext = doc.file_format;
    const exists = await fileExists(ORIGIN_PATH, doc.user_key, doc.file_id, ext);
    if (!exists) {
      return errorResponse(
        "파일이 스토리지에 존재하지 않습니다. 관리자에게 문의해주세요.",
        404
      );
    }

    const fileSize = await getFileSize(ORIGIN_PATH, doc.user_key, doc.file_id, ext);
    const stream = createFileReadStream(ORIGIN_PATH, doc.user_key, doc.file_id, ext);
    const mimeType =
      ALLOWED_MIME_TYPES[doc.file_format] || "application/octet-stream";
    const encodedFileName = encodeURIComponent(doc.file_name);

    const webStream = Readable.toWeb(stream) as ReadableStream;

    return new Response(webStream, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodedFileName}`,
        "Content-Length": fileSize.toString(),
      },
    });
  } catch (error) {
    log.error({ err: error }, "파일 다운로드 실패");
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
