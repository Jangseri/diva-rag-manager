export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getDocument } from "@/lib/services/document-service";
import { EXTRACT_PATH } from "@/lib/constants";
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

function statusGuard(file_status: string): PreviewSection | null {
  if (file_status === "EXTRACTED" || file_status === "INDEXED") return null;
  if (file_status === "FAILED" || file_status === "INDEX_FAILED") {
    return { previewable: false, reason: "추출에 실패한 문서입니다" };
  }
  return { previewable: false, reason: "추출이 완료된 후 확인할 수 있습니다" };
}

function getExtractPath(user_key: string, file_name: string): string {
  return path.resolve(EXTRACT_PATH, user_key, `${file_name}.json`);
}

/**
 * 추출 텍스트 탭: extracted_text 필드만 표시
 */
async function getExtractedText(
  user_key: string,
  file_name: string,
  file_status: string
): Promise<PreviewSection> {
  const guard = statusGuard(file_status);
  if (guard) return guard;

  try {
    const raw = await fs.readFile(getExtractPath(user_key, file_name), "utf-8");
    const json = JSON.parse(raw);
    const text = json.extracted_text;

    if (!text || typeof text !== "string") {
      return { previewable: false, reason: "추출된 텍스트가 없습니다" };
    }

    const truncated = text.length > MAX_PREVIEW_BYTES;
    return {
      previewable: true,
      content: truncated ? text.substring(0, MAX_PREVIEW_BYTES) : text,
      truncated,
    };
  } catch {
    return { previewable: false, reason: "추출 결과 파일을 찾을 수 없습니다" };
  }
}

/**
 * 원본 탭: 전체 JSON 표시
 */
async function getOriginalJson(
  user_key: string,
  file_name: string,
  file_status: string
): Promise<PreviewSection> {
  const guard = statusGuard(file_status);
  if (guard) return guard;

  try {
    const raw = await fs.readFile(getExtractPath(user_key, file_name), "utf-8");
    const formatted = JSON.stringify(JSON.parse(raw), null, 2);
    const truncated = formatted.length > MAX_PREVIEW_BYTES;

    return {
      previewable: true,
      content: truncated ? formatted.substring(0, MAX_PREVIEW_BYTES) : formatted,
      truncated,
    };
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

    const [extracted, original] = await Promise.all([
      getExtractedText(doc.user_key, doc.file_name, doc.file_status),
      getOriginalJson(doc.user_key, doc.file_name, doc.file_status),
    ]);

    return NextResponse.json({
      extracted,
      original,
      size: Number(doc.file_size),
    });
  } catch (error) {
    log.error({ err: error }, "미리보기 실패");
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
