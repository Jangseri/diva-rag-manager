export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { DocumentListQuerySchema } from "@/lib/validators/document";
import {
  validateFileName,
  validateFileSize,
  getFileExtension,
} from "@/lib/validators/document";
import {
  listDocuments,
  createDocument,
  findDuplicateDocument,
} from "@/lib/services/document-service";
import { saveFile, deleteFile } from "@/lib/file-storage";
import { ORIGIN_PATH, MAX_FILE_SIZE_BYTES } from "@/lib/constants";
import { generateId } from "@/lib/id";
import {
  toDocumentResponse,
  errorResponse,
  validationErrorResponse,
} from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { publishDocumentUploaded } from "@/lib/services/event-publisher";
import path from "path";

const log = createLogger("api/documents");

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawQuery = Object.fromEntries(searchParams.entries());

    const parsed = DocumentListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return validationErrorResponse("잘못된 요청 파라미터입니다");
    }

    const result = await listDocuments(parsed.data);

    return NextResponse.json({
      data: result.data.map(toDocumentResponse),
      total: result.total,
      page: result.page,
      size: result.size,
    });
  } catch (error) {
    log.error({ err: error }, "문서 목록 조회 실패");
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = parseInt(
      request.headers.get("content-length") || "0",
      10
    );
    if (contentLength > MAX_FILE_SIZE_BYTES * 10) {
      return validationErrorResponse("요청 크기가 너무 큽니다");
    }

    const currentUser = getCurrentUser();
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return validationErrorResponse("파일을 선택해주세요");
    }

    const errors: string[] = [];
    const validFiles: { file: File; ext: string }[] = [];

    for (const file of files) {
      const nameCheck = validateFileName(file.name);
      if (!nameCheck.valid) {
        errors.push(`${file.name}: ${nameCheck.error}`);
        continue;
      }
      if (!validateFileSize(file.size)) {
        errors.push(`${file.name}: 파일 크기가 제한을 초과합니다 (최대 100MB)`);
        continue;
      }
      validFiles.push({ file, ext: getFileExtension(file.name) });
    }

    if (validFiles.length === 0) {
      return validationErrorResponse("유효한 파일이 없습니다", { files: errors });
    }

    const created = [];

    for (const { file, ext } of validFiles) {
      const duplicate = await findDuplicateDocument(
        currentUser.user_key,
        file.name
      );
      if (duplicate) {
        errors.push(
          `${file.name}: 동일한 파일명이 이미 등록되어 있습니다 (${duplicate.file_id})`
        );
        continue;
      }

      const file_id = generateId();
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.length > MAX_FILE_SIZE_BYTES) {
        errors.push(`${file.name}: 파일 크기가 제한을 초과합니다`);
        continue;
      }

      // 경로: ORIGIN_PATH/{user_key}/{file_id}.{ext}
      const savedPath = await saveFile(
        ORIGIN_PATH,
        currentUser.user_key,
        file_id,
        ext,
        buffer
      );
      const origin_path = path.resolve(savedPath);

      try {
        const doc = await createDocument({
          file_id,
          file_name: file.name,
          user_key: currentUser.user_key,
          file_format: ext,
          file_size: BigInt(buffer.length),
          origin_path,
          rgst_nm: currentUser.name,
        });

        created.push(toDocumentResponse(doc));

        // Redis Stream 발행
        await publishDocumentUploaded({
          file_id,
          user_key: currentUser.user_key,
          collection_name: null,
          file_name: file.name,
          file_type: ext,
          file_size: buffer.length,
          origin_path,
        });
      } catch (dbError) {
        // DB 실패 시 저장된 파일 롤백
        await deleteFile(ORIGIN_PATH, currentUser.user_key, file_id, ext).catch(() => {});
        log.error(
          { err: dbError, fileName: file.name, file_id },
          "DB insert 실패, 파일 롤백 완료"
        );
        errors.push(`${file.name}: 문서 등록에 실패했습니다`);
      }
    }

    const response: Record<string, unknown> = { data: created };
    if (errors.length > 0) {
      response.warnings = errors;
    }

    if (created.length === 0 && errors.length > 0) {
      return NextResponse.json(
        { error: "모든 파일 업로드에 실패했습니다", warnings: errors },
        { status: 400 }
      );
    }

    log.info(
      {
        userKey: currentUser.user_key,
        uploaded: created.length,
        failed: errors.length,
      },
      "업로드 완료"
    );
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    log.error({ err: error }, "업로드 처리 실패");
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
