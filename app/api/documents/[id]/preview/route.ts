export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getDocument } from "@/lib/services/document-service";
import { readFile, fileExists } from "@/lib/file-storage";
import { ORIGIN_PATH, EXTRACT_PATH } from "@/lib/constants";
import { errorResponse } from "@/lib/api-response";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/documents/[id]/preview");

const MAX_PREVIEW_BYTES = 500 * 1024;

/**
 * 경로 규칙:
 *   TXT: /data/diva/origin/{user_key}/{file_id}.txt → 원본 읽기
 *   기타: /data/diva/extract/{user_key}/{file_name}.json → docs-extract-system 결과
 */
async function getPreviewContent(
  format: string,
  user_key: string,
  file_id: string,
  file_name: string
): Promise<{ content: string; truncated: boolean } | null> {
  if (format === "txt") {
    const exists = await fileExists(ORIGIN_PATH, user_key, file_id, format);
    if (!exists) return null;
    const buffer = await readFile(ORIGIN_PATH, user_key, file_id, format);
    const truncated = buffer.length > MAX_PREVIEW_BYTES;
    const content = buffer.subarray(0, MAX_PREVIEW_BYTES).toString("utf-8");
    return { content, truncated };
  }

  // 추출 결과 경로: EXTRACT_PATH/{user_key}/{file_name}.json
  const extractPath = path.resolve(EXTRACT_PATH, user_key, `${file_name}.json`);
  try {
    const stat = await fs.stat(extractPath);
    const fd = await fs.open(extractPath, "r");
    const bufSize = Math.min(stat.size, MAX_PREVIEW_BYTES);
    const buf = Buffer.alloc(bufSize);
    await fd.read(buf, 0, bufSize, 0);
    await fd.close();
    const truncated = stat.size > MAX_PREVIEW_BYTES;
    let content = buf.toString("utf-8");

    try {
      content = JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      // JSON 아니면 원문 유지
    }
    return { content, truncated };
  } catch {
    return null;
  }
}

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
      return errorResponse("삭제된 문서는 미리볼 수 없습니다", 410);
    }

    // TXT 외 형식은 추출 완료 상태여야 미리보기 가능
    if (
      doc.file_format !== "txt" &&
      doc.file_status !== "EXTRACTED" &&
      doc.file_status !== "INDEXED"
    ) {
      return NextResponse.json({
        previewable: false,
        reason:
          doc.file_status === "FAILED"
            ? "추출에 실패한 문서는 미리볼 수 없습니다"
            : "추출이 완료된 후 미리볼 수 있습니다",
        file_status: doc.file_status,
      });
    }

    const result = await getPreviewContent(
      doc.file_format,
      doc.user_key,
      doc.file_id,
      doc.file_name
    );
    if (!result) {
      return NextResponse.json({
        previewable: false,
        reason: "미리볼 수 있는 내용이 없습니다",
      });
    }

    return NextResponse.json({
      previewable: true,
      content: result.content,
      truncated: result.truncated,
      size: Number(doc.file_size),
    });
  } catch (error) {
    log.error({ err: error }, "미리보기 실패");
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
