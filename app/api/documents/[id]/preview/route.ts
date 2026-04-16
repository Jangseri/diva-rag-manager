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

interface PreviewSection {
  previewable: boolean;
  content?: string;
  truncated?: boolean;
  reason?: string;
}

async function getOriginalContent(
  user_key: string,
  file_id: string,
  format: string
): Promise<PreviewSection> {
  if (format !== "txt") {
    return { previewable: false, reason: "원본 미리보기는 TXT 파일만 지원합니다" };
  }
  const exists = await fileExists(ORIGIN_PATH, user_key, file_id, format);
  if (!exists) {
    return { previewable: false, reason: "원본 파일을 찾을 수 없습니다" };
  }
  const buffer = await readFile(ORIGIN_PATH, user_key, file_id, format);
  const truncated = buffer.length > MAX_PREVIEW_BYTES;
  const content = buffer.subarray(0, MAX_PREVIEW_BYTES).toString("utf-8");
  return { previewable: true, content, truncated };
}

async function getExtractedContent(
  user_key: string,
  file_name: string,
  file_status: string
): Promise<PreviewSection> {
  if (file_status !== "EXTRACTED" && file_status !== "INDEXED") {
    if (file_status === "FAILED" || file_status === "INDEX_FAILED") {
      return { previewable: false, reason: "추출에 실패한 문서입니다" };
    }
    return { previewable: false, reason: "추출이 완료된 후 확인할 수 있습니다" };
  }

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
    return { previewable: true, content, truncated };
  } catch {
    return { previewable: false, reason: "추출 결과 파일을 찾을 수 없습니다" };
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
    if (doc.status === "DELETED" || doc.status === "DELETING") {
      return errorResponse("삭제된 문서는 미리볼 수 없습니다", 410);
    }

    const [original, extracted] = await Promise.all([
      getOriginalContent(doc.user_key, doc.file_id, doc.file_format),
      getExtractedContent(doc.user_key, doc.file_name, doc.file_status),
    ]);

    return NextResponse.json({
      original,
      extracted,
      size: Number(doc.file_size),
    });
  } catch (error) {
    log.error({ err: error }, "미리보기 실패");
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
