import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { finalizeTimeout } from "./deletion-gate";

const log = createLogger("timeout-job");

const INTERVAL_MS = 60_000; // 1분마다 스캔
const BATCH_SIZE = 50;

let timer: NodeJS.Timeout | null = null;
let running = false;

async function scanExpiredDeletions() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const expired = await prisma.deletionConfirmation.findMany({
      where: {
        finalized_at: null,
        deletion_due_at: { lt: now },
      },
      select: { file_id: true },
      take: BATCH_SIZE,
    });

    if (expired.length === 0) return;

    log.warn({ count: expired.length }, "타임아웃된 삭제 confirmation 발견");

    for (const { file_id } of expired) {
      try {
        await finalizeTimeout(file_id);
      } catch (err) {
        log.error({ err, file_id }, "타임아웃 처리 실패");
      }
    }
  } catch (err) {
    log.error({ err }, "타임아웃 스캔 실패");
  } finally {
    running = false;
  }
}

export function startTimeoutJob() {
  if (timer) return;
  log.info({ intervalMs: INTERVAL_MS }, "Timeout Job 시작");
  timer = setInterval(() => {
    scanExpiredDeletions().catch((err) =>
      log.error({ err }, "타임아웃 스캔 루프 에러")
    );
  }, INTERVAL_MS);
}

export function stopTimeoutJob() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info("Timeout Job 중지");
  }
}
