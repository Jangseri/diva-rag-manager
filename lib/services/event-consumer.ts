import { getRedisSubscriber } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { STREAMS, publishDocumentUploaded } from "./event-publisher";
import os from "os";

const log = createLogger("event-consumer");

const CONSUMER_GROUP = "cg:rag-manager";
const CONSUMER_NAME = `rag-manager-${os.hostname()}-${process.pid}`;
const DLQ_STREAM = `${STREAMS.EXTRACT}:dlq`;

const IDLE_MS = 60_000;
const CLAIM_INTERVAL_MS = 30_000;
const MAX_DELIVERY_COUNT = 5;
const MAX_RETRY = 3;

interface ExtractStartedEvent {
  event_id: string;
  event_type: "EXTRACT_STARTED";
  schema_version: string;
  timestamp: string;
  file_id: string;
  user_key: string;
}

interface ExtractCompletedEvent {
  event_id: string;
  event_type: "EXTRACT_COMPLETED";
  schema_version: string;
  timestamp: string;
  file_id: string;
  user_key: string;
  collection_name?: string | null;
  file_name?: string;
  file_type?: string;
  output_path?: string;
  redis_key?: string;
}

interface ExtractFailedEvent {
  event_id: string;
  event_type: "EXTRACT_FAILED";
  schema_version: string;
  timestamp: string;
  file_id: string;
  user_key: string;
  error_code: string;
  error_message: string;
  retryable: boolean;
}

type ExtractEvent =
  | ExtractStartedEvent
  | ExtractCompletedEvent
  | ExtractFailedEvent;

let running = false;
let claimTimer: NodeJS.Timeout | null = null;

// -------------------- 내부 유틸 --------------------

async function ensureConsumerGroup() {
  const client = getRedisSubscriber();
  try {
    await client.xgroup("CREATE", STREAMS.EXTRACT, CONSUMER_GROUP, "$", "MKSTREAM");
    log.info({ stream: STREAMS.EXTRACT, group: CONSUMER_GROUP }, "Consumer Group 생성");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("BUSYGROUP")) {
      log.debug({ group: CONSUMER_GROUP }, "Consumer Group 이미 존재");
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
    .create({
      data: { event_id, event_type, file_id },
    })
    .catch((e) => {
      // 유니크 제약 충돌은 이미 처리됐다는 의미
      if (!String(e).includes("Unique constraint")) throw e;
    });
}

async function updateFileStatus(
  file_id: string,
  file_status: string,
  extra?: { last_error_code?: string | null; retry_count?: number }
): Promise<boolean> {
  try {
    const result = await prisma.document.updateMany({
      where: { file_id },
      data: {
        file_status,
        updt_nm: "docs-extract-system",
        ...extra,
      },
    });
    if (result.count === 0) {
      log.warn({ file_id, file_status }, "DB에 없는 문서 (이벤트 무시)");
      return true;
    }
    log.info({ file_id, file_status, ...extra }, "file_status 업데이트");
    return true;
  } catch (err) {
    log.error({ err, file_id, file_status }, "file_status 업데이트 실패");
    return false;
  }
}

// -------------------- 이벤트 타입별 처리 --------------------

async function handleExtractStarted(event: ExtractStartedEvent): Promise<boolean> {
  return updateFileStatus(event.file_id, "PROCESSING");
}

async function handleExtractCompleted(event: ExtractCompletedEvent): Promise<boolean> {
  return updateFileStatus(event.file_id, "EXTRACTED", { last_error_code: null });
}

async function handleExtractFailed(event: ExtractFailedEvent): Promise<boolean> {
  const { file_id, retryable, error_code, error_message } = event;

  const doc = await prisma.document.findUnique({ where: { file_id } });
  if (!doc) {
    log.warn({ file_id }, "DB에 없는 문서 (FAILED 이벤트 무시)");
    return true;
  }

  log.warn({ file_id, error_code, error_message, retryable }, "추출 실패 수신");

  // retryable + 재시도 여력 있음 → 재발행
  if (retryable && doc.retry_count < MAX_RETRY) {
    const newRetryCount = doc.retry_count + 1;
    log.info(
      { file_id, retry_count: newRetryCount, max: MAX_RETRY },
      "재시도 이벤트 재발행"
    );

    // DB 상태: 재시도 중임을 기록 (PROCESSING 복귀 + retry_count 증가)
    await updateFileStatus(file_id, "PROCESSING", {
      last_error_code: error_code,
      retry_count: newRetryCount,
    });

    // DOCUMENT_UPLOADED 재발행
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
        last_error_code: error_code,
      });
    }
    return true;
  }

  // retryable=false 또는 재시도 한도 초과 → 영구 FAILED
  await updateFileStatus(file_id, "FAILED", {
    last_error_code: error_code,
  });
  return true;
}

async function processEvent(event: ExtractEvent): Promise<boolean> {
  switch (event.event_type) {
    case "EXTRACT_STARTED":
      return handleExtractStarted(event);
    case "EXTRACT_COMPLETED":
      return handleExtractCompleted(event);
    case "EXTRACT_FAILED":
      return handleExtractFailed(event);
    default:
      log.warn({ event }, "알 수 없는 event_type (ACK 후 무시)");
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
    const event: ExtractEvent = JSON.parse(fields[dataIdx + 1]);

    if (!event.event_id || !event.event_type || !event.file_id) {
      log.warn({ msgId, event }, "필수 필드 누락 (ACK 후 스킵)");
      return true;
    }

    // 멱등성 체크
    if (await isAlreadyProcessed(event.event_id)) {
      log.debug({ event_id: event.event_id, event_type: event.event_type }, "중복 이벤트 스킵");
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

async function ackMessage(msgId: string): Promise<void> {
  const client = getRedisSubscriber();
  await client.xack(STREAMS.EXTRACT, CONSUMER_GROUP, msgId);
}

async function moveToDlq(msgId: string, fields: string[]): Promise<void> {
  const client = getRedisSubscriber();
  const args: string[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    args.push(fields[i], fields[i + 1]);
  }
  args.push("original_stream", STREAMS.EXTRACT);
  args.push("original_id", msgId);
  args.push("dead_at", new Date().toISOString());

  await client.xadd(DLQ_STREAM, "*", ...args);
  await ackMessage(msgId);
  log.error({ msgId, stream: DLQ_STREAM }, "DLQ로 이동");
}

// -------------------- 메인 루프 --------------------

async function consumeLoop() {
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
        STREAMS.EXTRACT,
        ">"
      )) as [string, [string, string[]][]][] | null;

      if (!result) continue;

      for (const [, messages] of result) {
        for (const [msgId, fields] of messages) {
          const success = await handleMessage(msgId, fields);
          if (success) {
            await ackMessage(msgId);
          }
        }
      }
    } catch (err) {
      log.error({ err }, "consume 루프 에러 (5초 후 재시도)");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  log.info("Consumer 루프 종료");
}

async function claimPending() {
  const client = getRedisSubscriber();
  try {
    const result = (await client.xautoclaim(
      STREAMS.EXTRACT,
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
        STREAMS.EXTRACT,
        CONSUMER_GROUP,
        "IDLE",
        0,
        msgId,
        msgId,
        1
      )) as [string, string, number, number][] | null;

      const deliveryCount = pending?.[0]?.[3] ?? 1;

      if (deliveryCount >= MAX_DELIVERY_COUNT) {
        await moveToDlq(msgId, fields);
        continue;
      }

      const success = await handleMessage(msgId, fields);
      if (success) {
        await ackMessage(msgId);
      }
    }
  } catch (err) {
    log.error({ err }, "XAUTOCLAIM 실패");
  }
}

export async function startConsumer() {
  if (running) {
    log.warn("이미 실행 중");
    return;
  }

  log.info({ consumer: CONSUMER_NAME }, "Redis Consumer 시작");

  try {
    await ensureConsumerGroup();
    running = true;

    consumeLoop().catch((err) =>
      log.error({ err }, "Consumer 루프 비정상 종료")
    );

    claimTimer = setInterval(() => {
      claimPending().catch((err) => log.error({ err }, "주기 재클레임 실패"));
    }, CLAIM_INTERVAL_MS);

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
  if (claimTimer) {
    clearInterval(claimTimer);
    claimTimer = null;
  }
  log.info("Consumer 중지");
}
