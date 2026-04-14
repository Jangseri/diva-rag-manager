import { getRedisSubscriber } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { STREAMS } from "./event-publisher";
import os from "os";

const log = createLogger("event-consumer");

const CONSUMER_GROUP = "cg:rag-manager";
const CONSUMER_NAME = `rag-manager-${os.hostname()}-${process.pid}`;
const DLQ_STREAM = `${STREAMS.EXTRACT}:dlq`;

// 재처리 설정
const IDLE_MS = 60_000; // pending 60초 이상이면 재클레임
const CLAIM_INTERVAL_MS = 30_000; // 30초마다 XAUTOCLAIM
const MAX_DELIVERY_COUNT = 5; // 5회 실패 시 DLQ로 이동

interface ExtractEvent {
  event: "EXTRACT_STARTED" | "EXTRACT_COMPLETED" | "EXTRACT_FAILED";
  uuid: string;
  timestamp: string;
  error_message?: string;
}

let running = false;
let claimTimer: NodeJS.Timeout | null = null;

async function ensureConsumerGroup() {
  const client = getRedisSubscriber();
  try {
    await client.xgroup("CREATE", STREAMS.EXTRACT, CONSUMER_GROUP, "0", "MKSTREAM");
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

async function updateFileStatus(uuid: string, status: string): Promise<boolean> {
  try {
    const result = await prisma.document.updateMany({
      where: { uuid },
      data: { file_status: status, updt_nm: "docs-extract-system" },
    });
    if (result.count === 0) {
      log.warn({ uuid, status }, "DB에 존재하지 않는 문서 (이벤트 무시)");
      return true; // 문서가 없으면 ACK 처리 (재시도 의미 없음)
    }
    log.info({ uuid, status }, "file_status 업데이트");
    return true;
  } catch (err) {
    log.error({ err, uuid, status }, "file_status 업데이트 실패");
    return false;
  }
}

async function processEvent(event: ExtractEvent): Promise<boolean> {
  switch (event.event) {
    case "EXTRACT_STARTED":
      return updateFileStatus(event.uuid, "PROCESSING");
    case "EXTRACT_COMPLETED":
      return updateFileStatus(event.uuid, "EXTRACTED");
    case "EXTRACT_FAILED":
      log.warn({ uuid: event.uuid, reason: event.error_message }, "추출 실패 수신");
      return updateFileStatus(event.uuid, "FAILED");
    default:
      log.warn({ event }, "알 수 없는 이벤트 타입");
      return true; // 모르는 이벤트는 ACK (스트림 막히지 않게)
  }
}

async function handleMessage(
  msgId: string,
  fields: string[]
): Promise<boolean> {
  try {
    // fields = ["data", "<json>"]
    const dataIdx = fields.indexOf("data");
    if (dataIdx === -1 || !fields[dataIdx + 1]) {
      log.warn({ msgId, fields }, "data 필드 없음");
      return true;
    }
    const event: ExtractEvent = JSON.parse(fields[dataIdx + 1]);
    return await processEvent(event);
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
  // DLQ에 원본 데이터 + 메타 정보 함께 저장
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

async function consumeLoop() {
  const client = getRedisSubscriber();

  while (running) {
    try {
      // XREADGROUP BLOCK 5000 COUNT 10 STREAMS rag:extract >
      const result = (await client.xreadgroup(
        "GROUP",
        CONSUMER_GROUP,
        CONSUMER_NAME,
        "COUNT",
        10,
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
          // 실패 시 ACK 안 함 → pending 상태로 남음 → XAUTOCLAIM이 재처리
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
    // XAUTOCLAIM rag:extract cg:rag-manager consumer_name 60000 0 COUNT 10
    const result = (await client.xautoclaim(
      STREAMS.EXTRACT,
      CONSUMER_GROUP,
      CONSUMER_NAME,
      IDLE_MS,
      "0",
      "COUNT",
      10
    )) as [string, [string, string[]][], string[]] | null;

    if (!result) return;

    const [, claimed] = result;
    if (!claimed || claimed.length === 0) return;

    for (const [msgId, fields] of claimed) {
      // delivery_count 확인: XPENDING으로 조회
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

    // 메인 소비 루프 (non-blocking)
    consumeLoop().catch((err) => log.error({ err }, "Consumer 루프 비정상 종료"));

    // 주기적 재클레임
    claimTimer = setInterval(() => {
      claimPending().catch((err) => log.error({ err }, "주기 재클레임 실패"));
    }, CLAIM_INTERVAL_MS);

    log.info(
      { idleMs: IDLE_MS, intervalMs: CLAIM_INTERVAL_MS, maxDelivery: MAX_DELIVERY_COUNT },
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
