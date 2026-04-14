export const ALLOWED_FILE_FORMATS = ["pdf", "docx", "txt", "hwp", "xlsx", "pptx"] as const;

export const ALLOWED_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  hwp: "application/x-hwp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || "100", 10);
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

import path from "path";

export const ORIGIN_PATH = path.resolve(process.env.ORIGIN_PATH || "/shared/document/origin");
export const EXTRACT_PATH = path.resolve(process.env.EXTRACT_PATH || "/shared/document/extract");

export const DEFAULT_PAGE_SIZE = 10;
export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export const FILE_STATUS_LABELS: Record<string, string> = {
  UPLOADED: "업로드됨",
  PROCESSING: "처리중",
  EXTRACTED: "추출완료",
  FAILED: "실패",
};

export const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "활성",
  DELETED: "삭제됨",
};
