import { monotonicFactory } from "ulid";

/**
 * monotonicFactory: 같은 밀리초 내에도 순서가 보장되는 ULID 생성기.
 * file_id, event_id에 사용.
 */
const generate = monotonicFactory();

export function generateId(): string {
  return generate();
}

// 점진 마이그레이션용 별칭
export const generateTsid = generateId;
