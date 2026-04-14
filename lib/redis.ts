import Redis from "ioredis";
import { createLogger } from "@/lib/logger";

const log = createLogger("redis");

const globalForRedis = globalThis as unknown as {
  redisPublisher: Redis | undefined;
  redisSubscriber: Redis | undefined;
};

function createClient(name: string): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL 환경변수가 설정되지 않았습니다");
  }

  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
    retryStrategy: (times) => {
      const delay = Math.min(times * 500, 10000);
      log.warn({ attempt: times, delayMs: delay, client: name }, "Redis 재연결 시도");
      return delay;
    },
  });

  client.on("connect", () => log.info({ client: name }, "Redis 연결 성공"));
  client.on("error", (err) => log.error({ err, client: name }, "Redis 에러"));
  client.on("end", () => log.warn({ client: name }, "Redis 연결 종료"));

  return client;
}

export function getRedisPublisher(): Redis {
  if (!globalForRedis.redisPublisher) {
    globalForRedis.redisPublisher = createClient("publisher");
  }
  return globalForRedis.redisPublisher;
}

export function getRedisSubscriber(): Redis {
  if (!globalForRedis.redisSubscriber) {
    globalForRedis.redisSubscriber = createClient("subscriber");
  }
  return globalForRedis.redisSubscriber;
}
