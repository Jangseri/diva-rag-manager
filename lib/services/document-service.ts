import { prisma } from "@/lib/prisma";
import type { DocumentListQuery } from "@/lib/validators/document";
import type { DocumentRecord } from "@/types";

interface ListResult {
  data: DocumentRecord[];
  total: number;
  page: number;
  size: number;
}

interface CreateDocumentInput {
  file_id: string;
  file_name: string;
  user_key: string;
  file_format: string;
  file_size: bigint;
  origin_path: string;
  collection_name?: string | null;
  rgst_nm: string;
}

export async function listDocuments(
  query: DocumentListQuery
): Promise<ListResult> {
  const { page, size, sort, order, search, format, status, file_status } = query;

  const where: Record<string, unknown> = {};
  where.status = status || "ACTIVE";

  if (file_status) {
    where.file_status = file_status;
  }
  if (format) {
    where.file_format = format;
  }
  if (search) {
    where.file_name = { contains: search };
  }

  const [data, total] = await Promise.all([
    prisma.document.findMany({
      where,
      skip: (page - 1) * size,
      take: size,
      orderBy: { [sort]: order },
    }),
    prisma.document.count({ where }),
  ]);

  return { data: data as DocumentRecord[], total, page, size };
}

export async function getDocument(
  file_id: string
): Promise<DocumentRecord | null> {
  const doc = await prisma.document.findUnique({ where: { file_id } });
  return doc as DocumentRecord | null;
}

export async function findDuplicateDocument(
  userKey: string,
  fileName: string
): Promise<DocumentRecord | null> {
  const doc = await prisma.document.findFirst({
    where: {
      user_key: userKey,
      file_name: fileName,
      status: "ACTIVE",
    },
  });
  return doc as DocumentRecord | null;
}

export async function createDocument(
  input: CreateDocumentInput
): Promise<DocumentRecord> {
  const doc = await prisma.document.create({
    data: {
      file_id: input.file_id,
      file_name: input.file_name,
      user_key: input.user_key,
      file_format: input.file_format,
      file_size: input.file_size,
      file_status: "UPLOADED",
      collection_name: input.collection_name ?? null,
      origin_path: input.origin_path,
      retry_count: 0,
      last_error_code: null,
      rgst_nm: input.rgst_nm,
      status: "ACTIVE",
      updt_nm: input.rgst_nm,
    },
  });
  return doc as DocumentRecord;
}

export async function softDeleteDocument(
  file_id: string,
  updt_nm: string
): Promise<DocumentRecord> {
  const existing = await prisma.document.findUnique({ where: { file_id } });

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

  const doc = await prisma.document.update({
    where: { file_id },
    data: { status: "DELETED", updt_nm },
  });
  return doc as DocumentRecord;
}
