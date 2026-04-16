import { getRedisPublisher } from "@/lib/redis";
import { createLogger } from "@/lib/logger";
import { generateId } from "@/lib/id";

const log = createLogger("event-publisher");

export const STREAMS = {
  DOCUMENTS: "rag:documents",
  EXTRACT: "rag:extract",
  INDEX: "rag:index",
} as const;

const SCHEMA_VERSION = "1";
const MAX_STREAM_LEN = 100000;

interface CommonFields {
  event_id: string;
  schema_version: string;
  timestamp: string;
}

export interface DocumentUploadedEvent extends CommonFields {
  event_type: "DOCUMENT_UPLOADED";
  file_id: string;
  user_key: string;
  collection_name: string | null;
  file_name: string;
  file_type: string;
  file_size: number;
  origin_path: string;
}

export interface DocumentDeletedEvent extends CommonFields {
  event_type: "DOCUMENT_DELETED";
  file_id: string;
  user_key: string;
  collection_name: string | null;
}

export type DocumentEvent = DocumentUploadedEvent | DocumentDeletedEvent;

/**
 * XADD rag:documents * MAXLEN ~ 100000 data <json>
 */
async function publish(stream: string, event: DocumentEvent): Promise<string> {
  const client = getRedisPublisher();
  const id = await client.xadd(
    stream,
    "MAXLEN",
    "~",
    MAX_STREAM_LEN,
    "*",
    "data",
    JSON.stringify(event)
  );
  log.info(
    {
      stream,
      event_type: event.event_type,
      event_id: event.event_id,
      file_id: event.file_id,
      msgId: id,
    },
    "이벤트 발행"
  );
  return id as string;
}

export async function publishDocumentUploaded(
  payload: Omit<
    DocumentUploadedEvent,
    "event_id" | "event_type" | "schema_version" | "timestamp"
  >
): Promise<void> {
  try {
    await publish(STREAMS.DOCUMENTS, {
      event_id: generateId(),
      event_type: "DOCUMENT_UPLOADED",
      schema_version: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      ...payload,
    });
  } catch (err) {
    log.error({ err, file_id: payload.file_id }, "DOCUMENT_UPLOADED 발행 실패");
  }
}

export async function publishDocumentDeleted(
  payload: Omit<
    DocumentDeletedEvent,
    "event_id" | "event_type" | "schema_version" | "timestamp"
  >
): Promise<void> {
  try {
    await publish(STREAMS.DOCUMENTS, {
      event_id: generateId(),
      event_type: "DOCUMENT_DELETED",
      schema_version: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      ...payload,
    });
  } catch (err) {
    log.error({ err, file_id: payload.file_id }, "DOCUMENT_DELETED 발행 실패");
  }
}
