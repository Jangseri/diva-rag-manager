import { z } from "zod/v4";
import { ALLOWED_FILE_FORMATS, MAX_FILE_SIZE_BYTES } from "@/lib/constants";

const SORTABLE_FIELDS = [
  "file_name",
  "file_format",
  "file_status",
  "file_size",
  "rgst_dt",
  "rgst_nm",
  "status",
] as const;

export const DocumentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  size: z.coerce.number().int().refine((v) => [10, 20, 50].includes(v), {
    message: "Size must be 10, 20, or 50",
  }).default(10),
  sort: z.enum(SORTABLE_FIELDS).default("rgst_dt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().optional(),
  format: z.enum(ALLOWED_FILE_FORMATS).optional(),
  status: z.enum(["ACTIVE", "DELETING", "DELETED", "DELETE_PARTIAL_FAILURE"]).optional(),
  file_status: z
    .enum([
      "UPLOADED",
      "PROCESSING",
      "EXTRACTED",
      "INDEXED",
      "FAILED",
      "INDEX_FAILED",
    ])
    .optional(),
});

export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;

export const DocumentUploadMetaSchema = z.object({
  rgst_nm: z.string().min(1, "등록자명은 필수입니다").max(100),
});

export type DocumentUploadMeta = z.infer<typeof DocumentUploadMetaSchema>;

export const SearchQuerySchema = z.object({
  query: z
    .string()
    .min(1, "검색어를 입력해주세요")
    .transform((v) => v.trim())
    .refine((v) => v.length > 0, { message: "검색어를 입력해주세요" }),
  method: z.enum(["bm25", "vector", "hybrid"]),
  top_k: z.number().int().min(1).max(20).default(5),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

const INVALID_FILENAME_CHARS = /[\x00-\x1F<>:"|?*]/;

export function validateFileName(fileName: string): { valid: boolean; error?: string } {
  if (!fileName || fileName.length === 0) {
    return { valid: false, error: "파일명이 비어있습니다" };
  }

  if (fileName.length > 255) {
    return { valid: false, error: "파일명이 255자를 초과합니다" };
  }

  if (INVALID_FILENAME_CHARS.test(fileName)) {
    return { valid: false, error: "파일명에 허용되지 않은 문자가 포함되어 있습니다" };
  }

  if (fileName.startsWith(".") || fileName === ".." || fileName === ".") {
    return { valid: false, error: "유효하지 않은 파일명입니다" };
  }

  const ext = fileName.split(".").pop()?.toLowerCase();
  if (!ext || !(ALLOWED_FILE_FORMATS as readonly string[]).includes(ext)) {
    return {
      valid: false,
      error: `지원하지 않는 파일 형식입니다 (${ALLOWED_FILE_FORMATS.join(", ")}만 가능)`,
    };
  }

  return { valid: true };
}

export function validateFileFormat(fileName: string): boolean {
  return validateFileName(fileName).valid;
}

export function validateFileSize(sizeInBytes: number): boolean {
  return sizeInBytes > 0 && sizeInBytes <= MAX_FILE_SIZE_BYTES;
}

export function getFileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() || "";
}
