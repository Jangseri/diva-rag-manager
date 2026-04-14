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
  uuid: string;
  file_name: string;
  user_key: string;
  file_format: string;
  file_size: bigint;
  rgst_nm: string;
}

export async function listDocuments(
  query: DocumentListQuery
): Promise<ListResult> {
  const { page, size, sort, order, search, format, status, file_status } = query;

  const where: Record<string, unknown> = {};

  // Default to ACTIVE if no status filter
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
  uuid: string
): Promise<DocumentRecord | null> {
  const doc = await prisma.document.findUnique({ where: { uuid } });
  return doc as DocumentRecord | null;
}

export async function createDocument(
  input: CreateDocumentInput
): Promise<DocumentRecord> {
  const doc = await prisma.document.create({
    data: {
      uuid: input.uuid,
      file_name: input.file_name,
      user_key: input.user_key,
      file_format: input.file_format,
      file_size: input.file_size,
      file_status: "UPLOADED",
      rgst_nm: input.rgst_nm,
      status: "ACTIVE",
      updt_nm: input.rgst_nm,
    },
  });

  return doc as DocumentRecord;
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

export async function softDeleteDocument(
  uuid: string,
  updt_nm: string
): Promise<DocumentRecord> {
  const existing = await prisma.document.findUnique({ where: { uuid } });

  if (!existing) {
    throw new Error("문서를 찾을 수 없습니다");
  }

  if (existing.status === "DELETED") {
    throw new Error("이미 삭제된 문서입니다");
  }

  const doc = await prisma.document.update({
    where: { uuid },
    data: { status: "DELETED", updt_nm },
  });

  return doc as DocumentRecord;
}
