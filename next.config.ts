import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // proxy.ts가 존재하면 Next.js는 body를 버퍼링하며 기본 10MB에서 잘림.
    // 업로드 라우트의 contentLength 상한(MAX_FILE_SIZE_BYTES * 10 = 1GB)과 동일하게 맞춤.
    proxyClientMaxBodySize: "1gb",
  },
  // Pino transport는 동적 로딩이라 tracing이 감지 못함 → 명시적으로 포함
  outputFileTracingIncludes: {
    "/**/*": [
      "node_modules/pino/**",
      "node_modules/pino-pretty/**",
      "node_modules/pino-roll/**",
      "node_modules/pino-abstract-transport/**",
      "node_modules/split2/**",
      "node_modules/thread-stream/**",
      "node_modules/sonic-boom/**",
      "node_modules/on-exit-leak-free/**",
      "node_modules/real-require/**",
      "node_modules/safe-stable-stringify/**",
      "node_modules/quick-format-unescaped/**",
      "node_modules/atomic-sleep/**",
      "node_modules/fast-redact/**",
      "node_modules/pino-std-serializers/**",
      "node_modules/process-warning/**",
      "node_modules/steno/**",
      "node_modules/.prisma/client/**",
      "node_modules/@prisma/client/**",
    ],
  },
};

export default nextConfig;
