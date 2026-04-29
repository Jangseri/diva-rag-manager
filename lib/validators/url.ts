import { z } from "zod/v4";

const MAX_URL_LENGTH = 2048;
const MAX_FILE_NAME_LENGTH = 100;

export const UrlSubmitSchema = z.object({
  urls: z
    .array(z.string().min(1).max(MAX_URL_LENGTH))
    .min(1, "URL을 최소 1개 입력해주세요")
    .max(50, "한 번에 최대 50개까지 등록 가능합니다"),
  collection_name: z.string().max(200).optional().nullable(),
  crawler_options: z
    .object({
      max_pages: z.number().int().min(1).max(500).optional(),
      max_depth: z.number().int().min(0).max(10).optional(),
      allow_external_links: z.boolean().optional(),
    })
    .optional(),
});

export type UrlSubmitInput = z.infer<typeof UrlSubmitSchema>;

export interface UrlValidationResult {
  valid: boolean;
  normalized?: string;
  fileName?: string;
  error?: string;
}

export function validateAndNormalizeUrl(raw: string): UrlValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, error: "빈 URL입니다" };
  }
  if (trimmed.length > MAX_URL_LENGTH) {
    return { valid: false, error: `URL이 ${MAX_URL_LENGTH}자를 초과합니다` };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { valid: false, error: "올바른 URL 형식이 아닙니다" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { valid: false, error: "http(s):// URL만 지원합니다" };
  }

  // hash 제거, trailing slash 정규화
  url.hash = "";
  const normalized = url.toString();

  const fileName = buildUrlFileName(url);
  if (fileName.length > MAX_FILE_NAME_LENGTH) {
    return {
      valid: false,
      error: `URL로부터 생성된 파일명이 ${MAX_FILE_NAME_LENGTH}자를 초과합니다`,
    };
  }

  return { valid: true, normalized, fileName };
}

/**
 * URL을 file_name 규칙으로 변환.
 * 예: https://www.ploonet.com/about?x=1 → www.ploonet.com_about_x=1.url
 */
export function buildUrlFileName(url: URL): string {
  const host = url.hostname;
  const pathPart = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "") || "index";
  const queryPart = url.search ? url.search.replace(/^\?/, "") : "";

  const segments = [host, pathPart];
  if (queryPart) segments.push(queryPart);

  const slug = segments
    .join("_")
    .replace(/[\\/<>:"|?*\x00-\x1F]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  // 너무 길면 잘라냄 (확장자 .url 4자 + 여유)
  const maxLen = MAX_FILE_NAME_LENGTH - 4;
  const truncated = slug.length > maxLen ? slug.slice(0, maxLen) : slug;

  return `${truncated}.url`;
}
