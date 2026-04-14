export const FILE_FORMATS = ["pdf", "docx", "txt", "hwp", "xlsx", "pptx"] as const;
export type FileFormat = (typeof FILE_FORMATS)[number];

export const FILE_STATUSES = ["UPLOADED", "PROCESSING", "EXTRACTED", "FAILED"] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export const DOCUMENT_STATUSES = ["ACTIVE", "DELETED"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const SEARCH_METHODS = ["bm25", "vector", "hybrid"] as const;
export type SearchMethod = (typeof SEARCH_METHODS)[number];

export interface DocumentRecord {
  uuid: string;
  file_name: string;
  user_key: string;
  file_format: string;
  file_status: string;
  file_size: bigint;
  rgst_dt: Date;
  rgst_nm: string;
  status: string;
  updt_dt: Date;
  updt_nm: string;
}

export interface DocumentListResponse {
  data: DocumentResponse[];
  total: number;
  page: number;
  size: number;
}

export interface DocumentResponse {
  uuid: string;
  file_name: string;
  user_key: string;
  file_format: string;
  file_status: string;
  file_size: string;
  rgst_dt: string;
  rgst_nm: string;
  status: string;
  updt_dt: string;
  updt_nm: string;
}

export interface SearchResult {
  document_id: string;
  file_name: string;
  score: number;
  snippet: string;
  file_format: string;
  rgst_dt: string;
}

export interface SearchResponse {
  results: SearchResult[];
  method: SearchMethod;
  query: string;
  total: number;
}

export interface ApiError {
  error: string;
  details?: Record<string, string[]>;
}
