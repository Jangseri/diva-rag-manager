import pino from "pino";
import path from "path";

const isDev = process.env.NODE_ENV !== "production";
const logDir = path.resolve(process.cwd(), "logs");

const targets: pino.TransportTargetOptions[] = [];

if (isDev) {
  // 개발: 콘솔에 예쁘게 출력
  targets.push({
    target: "pino-pretty",
    level: "debug",
    options: {
      colorize: true,
      translateTime: "HH:MM:ss.l",
      ignore: "pid,hostname",
    },
  });
} else {
  // 프로덕션: 콘솔 JSON
  targets.push({
    target: "pino/file",
    level: "info",
    options: { destination: 1 }, // stdout
  });
}

// 모든 환경에서 파일 저장 (일별 로테이션)
targets.push({
  target: "pino-roll",
  level: "info",
  options: {
    file: path.join(logDir, "app.log"),
    frequency: "daily",
    size: "10m",
    mkdir: true,
    dateFormat: "yyyy-MM-dd",
  },
});

targets.push({
  target: "pino-roll",
  level: "error",
  options: {
    file: path.join(logDir, "error.log"),
    frequency: "daily",
    size: "10m",
    mkdir: true,
    dateFormat: "yyyy-MM-dd",
  },
});

export const logger = pino({
  level: isDev ? "debug" : "info",
  transport: { targets },
  base: { env: process.env.NODE_ENV || "development" },
});

// 모듈별 child logger 생성 헬퍼
export function createLogger(module: string) {
  return logger.child({ module });
}
