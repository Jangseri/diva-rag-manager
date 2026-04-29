export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import {
  UrlSubmitSchema,
  validateAndNormalizeUrl,
} from "@/lib/validators/url";
import {
  createUrlDocument,
  findDuplicateUrlDocument,
} from "@/lib/services/document-service";
import { generateId } from "@/lib/id";
import {
  toDocumentResponse,
  errorResponse,
  validationErrorResponse,
} from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { submitUrlTask, ExtractClientError } from "@/lib/services/extract-client";
import { prisma } from "@/lib/prisma";

const log = createLogger("api/documents/url");

export async function POST(request: NextRequest) {
  try {
    const currentUser = getCurrentUser();
    const body = await request.json().catch(() => null);
    if (!body) {
      return validationErrorResponse("요청 본문이 올바르지 않습니다");
    }

    const parsed = UrlSubmitSchema.safeParse(body);
    if (!parsed.success) {
      return validationErrorResponse(
        z.prettifyError(parsed.error) || "잘못된 요청입니다"
      );
    }

    const { urls, collection_name, crawler_options } = parsed.data;

    const created = [];
    const errors: string[] = [];
    const seenInBatch = new Set<string>();

    for (const raw of urls) {
      const validation = validateAndNormalizeUrl(raw);
      if (!validation.valid || !validation.normalized || !validation.fileName) {
        errors.push(`${raw}: ${validation.error}`);
        continue;
      }

      const normalized = validation.normalized;

      // 같은 요청 안에서 중복
      if (seenInBatch.has(normalized)) {
        errors.push(`${raw}: 같은 요청에 중복된 URL입니다`);
        continue;
      }
      seenInBatch.add(normalized);

      // DB 중복 (user_key + source_url)
      const duplicate = await findDuplicateUrlDocument(
        currentUser.user_key,
        normalized
      );
      if (duplicate) {
        errors.push(
          `${raw}: 이미 등록된 URL입니다 (${duplicate.file_id})`
        );
        continue;
      }

      const file_id = generateId();
      let savedDoc;
      try {
        savedDoc = await createUrlDocument({
          file_id,
          file_name: validation.fileName,
          user_key: currentUser.user_key,
          source_url: normalized,
          collection_name: collection_name ?? null,
          rgst_nm: currentUser.name,
        });
      } catch (dbError) {
        log.error({ err: dbError, url: normalized }, "URL document insert 실패");
        errors.push(`${raw}: 등록에 실패했습니다`);
        continue;
      }

      try {
        await submitUrlTask({
          file_id,
          url: normalized,
          user_key: currentUser.user_key,
          collection_name: collection_name ?? null,
          crawler_options,
        });
        created.push(toDocumentResponse(savedDoc));
      } catch (httpError) {
        // extract-service 호출 실패 시 DB row 롤백
        await prisma.document
          .delete({ where: { file_id } })
          .catch((err) =>
            log.error({ err, file_id }, "URL document 롤백 실패")
          );

        const reason =
          httpError instanceof ExtractClientError
            ? httpError.message
            : httpError instanceof Error
              ? httpError.message
              : "extract-service 호출 실패";
        log.error(
          { err: httpError, file_id, url: normalized },
          "extract-service 호출 실패, DB 롤백 완료"
        );
        errors.push(`${raw}: ${reason}`);
      }
    }

    const response: Record<string, unknown> = { data: created };
    if (errors.length > 0) {
      response.warnings = errors;
    }

    if (created.length === 0 && errors.length > 0) {
      return NextResponse.json(
        { error: "모든 URL 등록에 실패했습니다", warnings: errors },
        { status: 400 }
      );
    }

    log.info(
      {
        userKey: currentUser.user_key,
        registered: created.length,
        failed: errors.length,
      },
      "URL 등록 완료"
    );
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    log.error({ err: error }, "URL 등록 처리 실패");
    return errorResponse("서버 오류가 발생했습니다", 500);
  }
}
