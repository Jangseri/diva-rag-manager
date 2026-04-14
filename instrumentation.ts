export async function register() {
  // Node.js 런타임에서만 실행 (Edge에서는 skip)
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.ENABLE_REDIS_CONSUMER !== "true") {
    console.log("[instrumentation] ENABLE_REDIS_CONSUMER=false, consumer 비활성");
    return;
  }

  const { startConsumer } = await import("./lib/services/event-consumer");
  await startConsumer();
}
