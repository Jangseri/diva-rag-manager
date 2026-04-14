import { getRedisPublisher } from "@/lib/redis";
import { createLogger } from "@/lib/logger";

const log = createLogger("event-publisher");

export const STREAMS = {
  DOCUMENTS: "rag:documents",
  EXTRACT: "rag:extract",
} as const;

export interface DocumentUploadedEvent {
  event: "DOCUMENT_UPLOADED";
  uuid: string;
  file_name: string;
  file_format: string;
  file_path: string;
  user_key: string;
  timestamp: string;
}

export interface DocumentDeletedEvent {
  event: "DOCUMENT_DELETED";
  uuid: string;
  user_key: string;
  timestamp: string;
}

export type DocumentEvent = DocumentUploadedEvent | DocumentDeletedEvent;

/**
 * XADD rag:documents
 * Redis Stream에 발행. payload는 {data: JSON} 형태로 단일 필드에 넣음.
 */
async function publish(stream: string, event: DocumentEvent): Promise<string> {
  const client = getRedisPublisher();
  const id = await client.xadd(stream, "*", "data", JSON.stringify(event));
  log.info({ stream, event: event.event, uuid: event.uuid, msgId: id }, "이벤트 발행");
  return id as string;
}

export async function publishDocumentUploaded(
  event: Omit<DocumentUploadedEvent, "event" | "timestamp">
): Promise<void> {
  try {
    await publish(STREAMS.DOCUMENTS, {
      event: "DOCUMENT_UPLOADED",
      ...event,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    // Redis 장애 시에도 업로드 자체는 성공으로 처리 (이벤트 발행만 실패 로그)
    log.error({ err, uuid: event.uuid }, "DOCUMENT_UPLOADED 발행 실패");
  }
}

export async function publishDocumentDeleted(
  event: Omit<DocumentDeletedEvent, "event" | "timestamp">
): Promise<void> {
  try {
    await publish(STREAMS.DOCUMENTS, {
      event: "DOCUMENT_DELETED",
      ...event,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error({ err, uuid: event.uuid }, "DOCUMENT_DELETED 발행 실패");
  }
}
