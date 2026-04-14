import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// 간단한 인메모리 Rate Limiting
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  "/api/documents": { max: 20, windowMs: 60_000 }, // 분당 20회
  "/api/search": { max: 60, windowMs: 60_000 }, // 분당 60회
};

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= max) {
    return false;
  }

  entry.count++;
  return true;
}

// 주기적으로 만료된 항목 정리 (메모리 누수 방지)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(key);
    }
  }
}, 60_000);

export function proxy(request: NextRequest) {
  const response = NextResponse.next();

  // 보안 헤더
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Rate Limiting (프로덕션 API 경로만)
  if (process.env.NODE_ENV === "production") {
    const pathname = request.nextUrl.pathname;

    for (const [prefix, limit] of Object.entries(RATE_LIMITS)) {
      if (pathname.startsWith(prefix)) {
        const ip = getClientIp(request);
        const key = `${ip}:${prefix}`;

        if (!checkRateLimit(key, limit.max, limit.windowMs)) {
          return NextResponse.json(
            { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
            { status: 429 }
          );
        }
        break;
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
