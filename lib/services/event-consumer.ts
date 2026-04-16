import { getRedisSubscriber } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { STREAMS, publishDocumentUploaded } from "./event-publisher";
import {
  markExtractConfirmed,
  markExtractFailure,
  markIndexConfirmed,
  markIndexFailure,
} from "./deletion-gate";
import os from "os";

const log = createLogger("event-consumer");

const CONSUMER_GROUP = "cg:rag-manager";
const CONSUMER_NAME = `rag-manager-${os.hostname()}-${process.pid}`;

const IDLE_MS = 60_000;
const CLAIM_INTERVAL_MS = 30_000;
const MAX_DELIVERY_COUNT = 5;
const MAX_RETRY = 3;

type KnownEventType =
  | "EXTRACT_STARTED"
  | "EXTRACT_COMPLETED"
  | "EXTRACT_FAILED"
  | "EXTRACT_DELETED"
  | "EXTRACT_DELETE_FAILED"
  | "INDEX_COMPLETED"
  | "INDEX_FAILED"
  | "INDEX_DELETED"
  | "INDEX_DELETE_FAILED";

interface BaseEvent {
  event_id: string;
  event_type: KnownEventType | string;
  schema_version: string;
  timestamp: string;
  file_id: string;
  user_key?: string;
  error_code?: string;
  error_message?: string;
  retryable?: boolean;
}

let running = false;
const claimTimers: NodeJS.Timeout[] = [];

// -------------------- 공통 유틸 --------------------

async function ensureConsumerGroup(stream: string) {
  const client = getRedisSubscriber();
  try {
    await client.xgroup("CREATE", stream, CONSUMER_GROUP, "$", "MKSTREAM");
    log.info({ stream, group: CONSUMER_GROUP }, "Consumer Group 생성");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("BUSYGROUP")) {
      log.debug({ stream, group: CONSUMER_GROUP }, "Consumer Group 이미 존재");
    } else {
      throw err;
    }
  }
}

async function isAlreadyProcessed(event_id: string): Promise<boolean> {
  const exists = await prisma.processedEvent.findUnique({
    where: { event_id },
    select: { event_id: true },
  });
  return exists !== null;
}

async function markProcessed(
  event_id: string,
  event_type: string,
  file_id: string | null
): Promise<void> {
  await prisma.processedEvent
    .create({ data: { event_id, event_type, file_id } })
    .catch((e) => {
      if (!String(e).includes("Unique constraint")) throw e;
    });
}

async function updateFileStatus(
  file_id: string,
  file_status: string,
  extra?: {
    last_error_code?: string | null;
    retry_count?: number;
    updt_nm?: string;
  }
): Promise<boolean> {
  try {
    const { updt_nm, ...rest } = extra || {};
    const result = await prisma.document.updateMany({
      where: { file_id },
      data: {
        file_status,
        updt_nm: updt_nm || "docs-extract-system",
        ...rest,
      },
    });
    if (result.count === 0) {
      log.warn({ file_id, file_status }, "DB에 없는 문서 (이벤트 무시)");
      return true;
    }
    log.info({ file_id, file_status, ...rest }, "file_status 업데이트");
    return true;
  } catch (err) {
    log.error({ err, file_id, file_status }, "file_status 업데이트 실패");
    return false;
  }
}

// -------------------- 이벤트 타입별 처리 --------------------

async function handleExtractStarted(event: BaseEvent) {
  return updateFileStatus(event.file_id, "PROCESSING");
}

async function handleExtractCompleted(event: BaseEvent) {
  return updateFileStatus(event.file_id, "EXTRACTED", { last_error_code: null });
}

async function handleExtractFailed(event: BaseEvent) {
  const { file_id, retryable, error_code } = event;

  const doc = await prisma.document.findUnique({ where: { file_id } });
  if (!doc) {
    log.warn({ file_id }, "DB에 없는 문서 (EXTRACT_FAILED 무시)");
    return true;
  }

  log.warn(
    { file_id, error_code, retryable, retry_count: doc.retry_count },
    "추출 실패 수신"
  );

  if (retryable && doc.retry_count < MAX_RETRY) {
    const newRetryCount = doc.retry_count + 1;
    log.info({ file_id, retry_count: newRetryCount }, "추출 재시도 재발행");

    await updateFileStatus(file_id, "PROCESSING", {
      last_error_code: error_code || null,
      retry_count: newRetryCount,
    });

    if (doc.origin_path) {
      await publishDocumentUploaded({
        file_id: doc.file_id,
        user_key: doc.user_key,
        collection_name: doc.collection_name,
        file_name: doc.file_name,
        file_type: doc.file_format,
        file_size: Number(doc.file_size),
        origin_path: doc.origin_path,
      });
    } else {
      log.error({ file_id }, "origin_path 없어 재발행 불가 → FAILED 고정");
      await updateFileStatus(file_id, "FAILED", {
        last_error_code: error_code || "NO_ORIGIN_PATH",
      });
    }
    return true;
  }

  return updateFileStatus(file_id, "FAILED", {
    last_error_code: error_code || null,
  });
}

async function handleExtractDeleted(event: BaseEvent) {
  await markExtractConfirmed(event.file_id);
  return true;
}

async function handleExtractDeleteFailed(event: BaseEvent) {
  await markExtractFailure(event.file_id, event.error_code);
  return true;
}

async function handleIndexCompleted(event: BaseEvent) {
  return updateFileStatus(event.file_id, "INDEXED", {
    last_error_code: null,
    updt_nm: "milvus-indexer",
  });
}

async function handleIndexFailed(event: BaseEvent) {
  const { file_id, retryable, error_code } = event;

  const doc = await prisma.document.findUnique({ where: { file_id } });
  if (!doc) {
    log.warn({ file_id }, "DB에 없는 문서 (INDEX_FAILED 무시)");
    return true;
  }

  log.warn(
    { file_id, error_code, retryable, retry_count: doc.retry_count },
    "인덱싱 실패 수신"
  );

  if (retryable && doc.retry_count < MAX_RETRY) {
    const newRetryCount = doc.retry_count + 1;
    log.info({ file_id, retry_count: newRetryCount }, "인덱싱 재시도 재발행");

    // 인덱싱 재시도는 추출부터 재출발 (DOCUMENT_UPLOADED 재발행)
    await updateFileStatus(file_id, "PROCESSING", {
      last_error_code: error_code || null,
      retry_count: newRetryCount,
      updt_nm: "milvus-indexer",
    });

    if (doc.origin_path) {
      await publishDocumentUploaded({
        file_id: doc.file_id,
        user_key: doc.user_key,
        collection_name: doc.collection_name,
        file_name: doc.file_name,
        file_type: doc.file_format,
        file_size: Number(doc.file_size),
        origin_path: doc.origin_path,
      });
    } else {
      log.error({ file_id }, "origin_path 없어 재발행 불가 → INDEX_FAILED 고정");
      await updateFileStatus(file_id, "INDEX_FAILED", {
        last_error_code: error_code || "NO_ORIGIN_PATH",
        updt_nm: "milvus-indexer",
      });
    }
    return true;
  }

  return updateFileStatus(file_id, "INDEX_FAILED", {
    last_error_code: error_code || null,
    updt_nm: "milvus-indexer",
  });
}

async function handleIndexDeleted(event: BaseEvent) {
  await markIndexConfirmed(event.file_id);
  return true;
}

async function handleIndexDeleteFailed(event: BaseEvent) {
  await markIndexFailure(event.file_id, event.error_code);
  return true;
}

async function processEvent(event: BaseEvent): Promise<boolean> {
  switch (event.event_type) {
    case "EXTRACT_STARTED":
      return handleExtractStarted(event);
    case "EXTRACT_COMPLETED":
      return handleExtractCompleted(event);
    case "EXTRACT_FAILED":
      return handleExtractFailed(event);
    case "EXTRACT_DELETED":
      return handleExtractDeleted(event);
    case "EXTRACT_DELETE_FAILED":
      return handleExtractDeleteFailed(event);
    case "INDEX_COMPLETED":
      return handleIndexCompleted(event);
    case "INDEX_FAILED":
      return handleIndexFailed(event);
    case "INDEX_DELETED":
      return handleIndexDeleted(event);
    case "INDEX_DELETE_FAILED":
      return handleIndexDeleteFailed(event);
    default:
      log.warn({ event_type: event.event_type }, "알 수 없는 event_type (ACK)");
      return true;
  }
}

async function handleMessage(msgId: string, fields: string[]): Promise<boolean> {
  try {
    const dataIdx = fields.indexOf("data");
    if (dataIdx === -1 || !fields[dataIdx + 1]) {
      log.warn({ msgId, fields }, "data 필드 없음");
      return true;
    }
    const event: BaseEvent = JSON.parse(fields[dataIdx + 1]);

    if (!event.event_id || !event.event_type || !event.file_id) {
      log.warn({ msgId, event }, "필수 필드 누락 (ACK 후 스킵)");
      return true;
    }

    if (await isAlreadyProcessed(event.event_id)) {
      log.debug(
        { event_id: event.event_id, event_type: event.event_type },
        "중복 이벤트 스킵"
      );
      return true;
    }

    const success = await processEvent(event);
    if (success) {
      await markProcessed(event.event_id, event.event_type, event.file_id);
    }
    return success;
  } catch (err) {
    log.error({ err, msgId }, "메시지 처리 실패");
    return false;
  }
}

async function ackMessage(stream: string, msgId: string): Promise<void> {
  const client = getRedisSubscriber();
  await client.xack(stream, CONSUMER_GROUP, msgId);
}

async function moveToDlq(stream: string, msgId: string, fields: string[]) {
  const client = getRedisSubscriber();
  const dlqStream = `${stream}:dlq`;
  const args: string[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    args.push(fields[i], fields[i + 1]);
  }
  args.push("original_stream", stream);
  args.push("original_id", msgId);
  args.push("dead_at", new Date().toISOString());

  await client.xadd(dlqStream, "*", ...args);
  await ackMessage(stream, msgId);
  log.error({ msgId, stream: dlqStream }, "DLQ로 이동");
}

// -------------------- 스트림별 루프 --------------------

async function consumeLoop(stream: string) {
  const client = getRedisSubscriber();

  while (running) {
    try {
      const result = (await client.xreadgroup(
        "GROUP",
        CONSUMER_GROUP,
        CONSUMER_NAME,
        "COUNT",
        16,
        "BLOCK",
        5000,
        "STREAMS",
        stream,
        ">"
      )) as [string, [string, string[]][]][] | null;

      if (!result) continue;

      for (const [, messages] of result) {
        for (const [msgId, fields] of messages) {
          const success = await handleMessage(msgId, fields);
          if (success) {
            await ackMessage(stream, msgId);
          }
        }
      }
    } catch (err) {
      log.error({ err, stream }, "consume 루프 에러 (5초 후 재시도)");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  log.info({ stream }, "Consumer 루프 종료");
}

async function claimPending(stream: string) {
  const client = getRedisSubscriber();
  try {
    const result = (await client.xautoclaim(
      stream,
      CONSUMER_GROUP,
      CONSUMER_NAME,
      IDLE_MS,
      "0-0",
      "COUNT",
      16
    )) as [string, [string, string[]][], string[]] | null;

    if (!result) return;
    const [, claimed] = result;
    if (!claimed || claimed.length === 0) return;

    for (const [msgId, fields] of claimed) {
      const pending = (await client.xpending(
        stream,
        CONSUMER_GROUP,
        "IDLE",
        0,
        msgId,
        msgId,
        1
      )) as [string, string, number, number][] | null;

      const deliveryCount = pending?.[0]?.[3] ?? 1;

      if (deliveryCount >= MAX_DELIVERY_COUNT) {
        await moveToDlq(stream, msgId, fields);
        continue;
      }

      const success = await handleMessage(msgId, fields);
      if (success) {
        await ackMessage(stream, msgId);
      }
    }
  } catch (err) {
    log.error({ err, stream }, "XAUTOCLAIM 실패");
  }
}

// -------------------- 공개 API --------------------

const SUBSCRIBED_STREAMS = [STREAMS.EXTRACT, STREAMS.INDEX];

export async function startConsumer() {
  if (running) {
    log.warn("이미 실행 중");
    return;
  }

  log.info(
    { consumer: CONSUMER_NAME, streams: SUBSCRIBED_STREAMS },
    "Redis Consumer 시작"
  );

  try {
    for (const stream of SUBSCRIBED_STREAMS) {
      await ensureConsumerGroup(stream);
    }
    running = true;

    for (const stream of SUBSCRIBED_STREAMS) {
      consumeLoop(stream).catch((err) =>
        log.error({ err, stream }, "Consumer 루프 비정상 종료")
      );
    }

    for (const stream of SUBSCRIBED_STREAMS) {
      const timer = setInterval(() => {
        claimPending(stream).catch((err) =>
          log.error({ err, stream }, "주기 재클레임 실패")
        );
      }, CLAIM_INTERVAL_MS);
      claimTimers.push(timer);
    }

    log.info(
      {
        idleMs: IDLE_MS,
        intervalMs: CLAIM_INTERVAL_MS,
        maxDelivery: MAX_DELIVERY_COUNT,
        maxRetry: MAX_RETRY,
      },
      "Consumer 초기화 완료"
    );
  } catch (err) {
    running = false;
    log.error({ err }, "Consumer 시작 실패");
  }
}

export function stopConsumer() {
  running = false;
  while (claimTimers.length > 0) {
    const t = claimTimers.pop();
    if (t) clearInterval(t);
  }
  log.info("Consumer 중지");
}
