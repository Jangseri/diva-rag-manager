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
import { saveFile, deleteFileDirectory } from "@/lib/file-storage";
import { ORIGIN_PATH, MAX_FILE_SIZE_BYTES } from "@/lib/constants";
import { generateTsid } from "@/lib/tsid";
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
    // #3: 서버사이드 Content-Length 사전 검증
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
      // #6: 파일명 검증 (특수문자, 길이, 형식)
      const nameCheck = validateFileName(file.name);
      if (!nameCheck.valid) {
        errors.push(`${file.name}: ${nameCheck.error}`);
        continue;
      }

      // #3: 서버사이드 파일 크기 재검증
      if (!validateFileSize(file.size)) {
        errors.push(`${file.name}: 파일 크기가 제한을 초과합니다 (최대 100MB)`);
        continue;
      }

      validFiles.push({ file, ext: getFileExtension(file.name) });
    }

    if (validFiles.length === 0) {
      return validationErrorResponse("유효한 파일이 없습니다", {
        files: errors,
      });
    }

    const created = [];

    for (const { file, ext } of validFiles) {
      // #10: 중복 파일 확인
      const duplicate = await findDuplicateDocument(
        currentUser.user_key,
        file.name
      );
      if (duplicate) {
        errors.push(
          `${file.name}: 동일한 파일명이 이미 등록되어 있습니다 (${duplicate.uuid})`
        );
        continue;
      }

      const tsid = generateTsid();

      // #3: arrayBuffer 변환 후 실제 크기 재확인
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.length > MAX_FILE_SIZE_BYTES) {
        errors.push(`${file.name}: 파일 크기가 제한을 초과합니다`);
        continue;
      }

      // #2: 파일 저장 후 DB 실패 시 롤백
      await saveFile(ORIGIN_PATH, tsid, file.name, buffer);

      try {
        const doc = await createDocument({
          uuid: tsid,
          file_name: file.name,
          user_key: currentUser.user_key,
          file_format: ext,
          file_size: BigInt(buffer.length),
          rgst_nm: currentUser.name,
        });

        created.push(toDocumentResponse(doc));

        // Redis Stream에 DOCUMENT_UPLOADED 발행 (docs-extract-system이 consume)
        await publishDocumentUploaded({
          uuid: tsid,
          file_name: file.name,
          file_format: ext,
          file_path: path.join(ORIGIN_PATH, tsid, file.name),
          user_key: currentUser.user_key,
        });
      } catch (dbError) {
        // DB 실패 시 저장된 파일 롤백
        await deleteFileDirectory(ORIGIN_PATH, tsid).catch(() => {});
        log.error(
          { err: dbError, fileName: file.name, tsid },
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
      { userKey: currentUser.user_key, uploaded: created.length, failed: errors.length },
      "업로드 완료"
    );
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    log.error({ err: error }, "업로드 처리 실패");
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
