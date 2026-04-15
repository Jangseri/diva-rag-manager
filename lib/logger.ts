import pino from "pino";
import path from "path";

const isDev = process.env.NODE_ENV !== "production";
const logDir = path.resolve(process.cwd(), "logs");

function createPino() {
  if (isDev) {
    // 개발: pino-pretty(콘솔 예쁘게) + pino-roll(파일 로테이션)
    return pino({
      level: "debug",
      base: { env: "development" },
      transport: {
        targets: [
          {
            target: "pino-pretty",
            level: "debug",
            options: {
              colorize: true,
              translateTime: "HH:MM:ss.l",
              ignore: "pid,hostname",
            },
          },
          {
            target: "pino-roll",
            level: "info",
            options: {
              file: path.join(logDir, "app.log"),
              frequency: "daily",
              size: "10m",
              mkdir: true,
              dateFormat: "yyyy-MM-dd",
            },
          },
          {
            target: "pino-roll",
            level: "error",
            options: {
              file: path.join(logDir, "error.log"),
              frequency: "daily",
              size: "10m",
              mkdir: true,
              dateFormat: "yyyy-MM-dd",
            },
          },
        ],
      },
    });
  }

  // 프로덕션: transport 없이 stdout JSON (Docker logging driver가 관리)
  return pino({
    level: "info",
    base: { env: "production" },
  });
}

export const logger = createPino();

// 모듈별 child logger 생성 헬퍼
export function createLogger(module: string) {
  return logger.child({ module });
}
