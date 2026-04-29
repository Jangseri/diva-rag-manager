import { prisma } from "@/lib/prisma";
import { deleteFile } from "@/lib/file-storage";
import { ORIGIN_PATH } from "@/lib/constants";
import { createLogger } from "@/lib/logger";

const log = createLogger("deletion-gate");

export const DELETION_TIMEOUT_MS = 5 * 60 * 1000; // 5분

/**
 * 삭제 프로세스 개시.
 * - document.status → DELETING
 * - deletion_confirmations row 생성 (deletion_due_at = now + 5min)
 * - DOCUMENT_DELETED 발행은 호출자(API route)가 담당
 */
export async function initiateDeletion(file_id: string, updt_nm: string) {
  const now = new Date();
  const dueAt = new Date(now.getTime() + DELETION_TIMEOUT_MS);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.document.findUnique({ where: { file_id } });
    if (!existing) {
      throw new Error("문서를 찾을 수 없습니다");
    }
    if (
      existing.status === "DELETED" ||
      existing.status === "DELETING" ||
      existing.status === "DELETE_PARTIAL_FAILURE"
    ) {
      throw new Error("이미 삭제 처리 중이거나 삭제된 문서입니다");
    }

    const doc = await tx.document.update({
      where: { file_id },
      data: { status: "DELETING", updt_nm },
    });

    await tx.deletionConfirmation.upsert({
      where: { file_id },
      create: {
        file_id,
        deletion_due_at: dueAt,
      },
      update: {
        extract_confirmed: false,
        extract_error_code: null,
        extract_confirmed_at: null,
        index_confirmed: false,
        index_error_code: null,
        index_confirmed_at: null,
        deletion_due_at: dueAt,
        finalized_at: null,
      },
    });

    log.info({ file_id, due_at: dueAt.toISOString() }, "삭제 프로세스 개시");
    return doc;
  });
}

export async function markExtractConfirmed(file_id: string) {
  await ensureConfirmationExists(file_id);
  await prisma.deletionConfirmation.update({
    where: { file_id },
    data: {
      extract_confirmed: true,
      extract_error_code: null,
      extract_confirmed_at: new Date(),
    },
  });
  log.debug({ file_id }, "EXTRACT 삭제 confirm 기록");
  await evaluateDeletion(file_id);
}

export async function markExtractFailure(
  file_id: string,
  error_code: string | null | undefined
) {
  await ensureConfirmationExists(file_id);
  await prisma.deletionConfirmation.update({
    where: { file_id },
    data: {
      extract_confirmed: false,
      extract_error_code: error_code || "EXTRACT_DELETE_FAILED",
      extract_confirmed_at: new Date(),
    },
  });
  log.warn({ file_id, error_code }, "EXTRACT 삭제 실패 기록");
  await evaluateDeletion(file_id);
}

export async function markIndexConfirmed(file_id: string) {
  await ensureConfirmationExists(file_id);
  await prisma.deletionConfirmation.update({
    where: { file_id },
    data: {
      index_confirmed: true,
      index_error_code: null,
      index_confirmed_at: new Date(),
    },
  });
  log.debug({ file_id }, "INDEX 삭제 confirm 기록");
  await evaluateDeletion(file_id);
}

export async function markIndexFailure(
  file_id: string,
  error_code: string | null | undefined
) {
  await ensureConfirmationExists(file_id);
  await prisma.deletionConfirmation.update({
    where: { file_id },
    data: {
      index_confirmed: false,
      index_error_code: error_code || "INDEX_DELETE_FAILED",
      index_confirmed_at: new Date(),
    },
  });
  log.warn({ file_id, error_code }, "INDEX 삭제 실패 기록");
  await evaluateDeletion(file_id);
}

/**
 * gate 평가 — 두 응답 모두 수신되었는지, 성공/실패 상태에 따라 최종 처리.
 */
export async function evaluateDeletion(file_id: string) {
  const conf = await prisma.deletionConfirmation.findUnique({
    where: { file_id },
  });
  if (!conf || conf.finalized_at) return;

  const extractResponded =
    conf.extract_confirmed || !!conf.extract_error_code;
  const indexResponded = conf.index_confirmed || !!conf.index_error_code;

  if (!extractResponded || !indexResponded) return;

  const hasFailure = !!conf.extract_error_code || !!conf.index_error_code;

  if (!hasFailure) {
    await finalizeSuccess(file_id);
  } else {
    await finalizePartialFailure(file_id, {
      extract_error_code: conf.extract_error_code,
      index_error_code: conf.index_error_code,
    });
  }
}

async function finalizeSuccess(file_id: string) {
  const doc = await prisma.document.findUnique({ where: { file_id } });
  if (doc && doc.source_type !== "url" && doc.file_format) {
    await deleteFile(ORIGIN_PATH, doc.user_key, doc.file_id, doc.file_format).catch(
      (err) => log.error({ err, file_id }, "원본 파일 삭제 실패")
    );
  }

  await prisma.$transaction([
    prisma.document.update({
      where: { file_id },
      data: { status: "DELETED", updt_nm: "rag-manager" },
    }),
    prisma.deletionConfirmation.update({
      where: { file_id },
      data: { finalized_at: new Date() },
    }),
  ]);

  log.info({ file_id }, "삭제 완료 (원본 unlink + status=DELETED)");
}

async function finalizePartialFailure(
  file_id: string,
  errors: { extract_error_code: string | null; index_error_code: string | null }
) {
  await prisma.$transaction([
    prisma.document.update({
      where: { file_id },
      data: { status: "DELETE_PARTIAL_FAILURE", updt_nm: "rag-manager" },
    }),
    prisma.deletionConfirmation.update({
      where: { file_id },
      data: { finalized_at: new Date() },
    }),
  ]);

  log.error(
    { file_id, ...errors },
    "삭제 부분 실패 — 원본 보존, 수동 개입 필요"
  );
}

/**
 * 타임아웃 처리 (timeout-job에서 호출).
 * deletion_due_at을 지났는데 finalized_at이 NULL인 row를 PARTIAL_FAILURE로 확정.
 */
export async function finalizeTimeout(file_id: string) {
  const conf = await prisma.deletionConfirmation.findUnique({
    where: { file_id },
  });
  if (!conf || conf.finalized_at) return;

  await prisma.$transaction([
    prisma.document.update({
      where: { file_id },
      data: { status: "DELETE_PARTIAL_FAILURE", updt_nm: "rag-manager" },
    }),
    prisma.deletionConfirmation.update({
      where: { file_id },
      data: { finalized_at: new Date() },
    }),
  ]);

  log.error(
    {
      file_id,
      extract_confirmed: conf.extract_confirmed,
      index_confirmed: conf.index_confirmed,
      extract_error_code: conf.extract_error_code,
      index_error_code: conf.index_error_code,
    },
    "삭제 타임아웃 — PARTIAL_FAILURE 전환, 원본 보존"
  );
}

/**
 * 수신 이벤트의 file_id에 해당하는 confirmation row가 없을 때 생성.
 * (DOCUMENT_DELETED 발행 시점에 이미 생성되지만, 다른 서비스가 먼저 응답하는 edge case 대비)
 */
async function ensureConfirmationExists(file_id: string) {
  await prisma.deletionConfirmation.upsert({
    where: { file_id },
    create: {
      file_id,
      deletion_due_at: new Date(Date.now() + DELETION_TIMEOUT_MS),
    },
    update: {},
  });
}
