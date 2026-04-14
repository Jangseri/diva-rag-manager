export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import { prisma } from "@/lib/prisma";
import { getRedisPublisher } from "@/lib/redis";
import { ORIGIN_PATH, EXTRACT_PATH } from "@/lib/constants";

type CheckStatus = "ok" | "error" | "skipped";

interface CheckResult {
  status: CheckStatus;
  message?: string;
}

interface HealthCheck {
  status: "ok" | "degraded" | "error";
  timestamp: string;
  checks: {
    database: CheckResult;
    origin_storage: CheckResult;
    extract_storage: CheckResult;
    redis: CheckResult;
    milvus_broker: CheckResult;
  };
}

async function checkDatabase(): Promise<CheckResult> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "DB 연결 실패",
    };
  }
}

async function checkStorage(path: string): Promise<CheckResult> {
  try {
    await fs.access(path);
    return { status: "ok" };
  } catch {
    return {
      status: "error",
      message: `경로 접근 불가: ${path}`,
    };
  }
}

async function checkRedis(): Promise<CheckResult> {
  if (!process.env.REDIS_URL) {
    return { status: "skipped", message: "REDIS_URL 미설정" };
  }
  try {
    const client = getRedisPublisher();
    const pong = await client.ping();
    if (pong !== "PONG") {
      return { status: "error", message: `비정상 응답: ${pong}` };
    }
    return { status: "ok" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Redis 연결 실패",
    };
  }
}

async function checkMilvusBroker(): Promise<CheckResult> {
  const url = process.env.MILVUS_BROKER_URL;
  if (!url) {
    return { status: "skipped", message: "MILVUS_BROKER_URL 미설정" };
  }
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/ping`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return { status: "error", message: `HTTP ${res.status}` };
    }
    return { status: "ok" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "milvus-broker 연결 실패",
    };
  }
}

export async function GET() {
  const [database, origin_storage, extract_storage, redis, milvus_broker] =
    await Promise.all([
      checkDatabase(),
      checkStorage(ORIGIN_PATH),
      checkStorage(EXTRACT_PATH),
      checkRedis(),
      checkMilvusBroker(),
    ]);

  const checks = { database, origin_storage, extract_storage, redis, milvus_broker };

  // 필수(critical): database, origin_storage
  const criticalOk = database.status === "ok" && origin_storage.status === "ok";
  // 전체: 모든 체크가 ok
  const allOk = Object.values(checks).every(
    (c) => c.status === "ok" || c.status === "skipped"
  );

  const overallStatus: HealthCheck["status"] = !criticalOk
    ? "error"
    : allOk
      ? "ok"
      : "degraded";

  const result: HealthCheck = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks,
  };

  // critical 실패면 503, degraded(일부 외부 의존성 문제)는 200
  return NextResponse.json(result, { status: criticalOk ? 200 : 503 });
}
