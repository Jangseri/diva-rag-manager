/**
 * docs-extract-system이 발행하는 error_code → 사용자 친화 메시지 매핑.
 * 매핑에 없는 코드는 "처리 중 오류가 발생했습니다"로 표시.
 */

export const ERROR_CODE_MESSAGES: Record<string, string> = {
  UNSUPPORTED_FORMAT: "지원하지 않는 파일 형식입니다",
  FILE_CORRUPTED: "파일이 손상되어 처리할 수 없습니다",
  FILE_TOO_LARGE: "파일 크기가 제한을 초과했습니다",
  EXTRACT_TIMEOUT: "처리 시간이 초과되었습니다. 재시도됩니다",
  GPU_OOM: "서버 자원이 부족하여 재시도됩니다",
  OCR_FAILED: "문자 인식에 일시적인 오류가 발생했습니다. 재시도됩니다",
  INTERNAL_ERROR: "내부 처리 오류가 발생했습니다. 재시도됩니다",
};

export function getErrorMessage(errorCode: string | null | undefined): string {
  if (!errorCode) return "";
  return ERROR_CODE_MESSAGES[errorCode] || "처리 중 오류가 발생했습니다";
}
