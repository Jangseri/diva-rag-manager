import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import type { ReadStream } from "fs";

/**
 * 파일 저장 경로 규칙:
 *   {basePath}/{user_key}/{file_id}.{ext}
 *
 * user_key, file_id, ext 모두 path traversal 방지를 위해 sanitize.
 */

function sanitize(segment: string, label: string): string {
  if (!segment) throw new Error(`${label}가 비어있습니다`);
  if (segment === "." || segment === "..") {
    throw new Error(`유효하지 않은 ${label}입니다`);
  }
  if (segment.includes("..")) {
    throw new Error(`${label}에 경로 조작 문자가 포함되어 있습니다`);
  }
  if (/[\x00-\x1F<>:"|?*\\/]/.test(segment)) {
    throw new Error(`${label}에 허용되지 않은 문자가 포함되어 있습니다`);
  }
  return segment;
}

function buildFileName(file_id: string, ext: string): string {
  const safeId = sanitize(file_id, "file_id");
  const safeExt = sanitize(ext.replace(/^\./, ""), "확장자").toLowerCase();
  return `${safeId}.${safeExt}`;
}

function safePath(basePath: string, user_key: string, file_id: string, ext: string): string {
  const safeUserKey = sanitize(user_key, "user_key");
  const fileName = buildFileName(file_id, ext);
  const fullPath = path.resolve(basePath, safeUserKey, fileName);
  const resolvedBase = path.resolve(basePath);

  if (!fullPath.startsWith(resolvedBase + path.sep)) {
    throw new Error("허용되지 않은 파일 경로입니다");
  }
  return fullPath;
}

export function getFilePath(
  basePath: string,
  user_key: string,
  file_id: string,
  ext: string
): string {
  return safePath(basePath, user_key, file_id, ext);
}

export async function saveFile(
  basePath: string,
  user_key: string,
  file_id: string,
  ext: string,
  buffer: Buffer
): Promise<string> {
  const filePath = safePath(basePath, user_key, file_id, ext);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function readFile(
  basePath: string,
  user_key: string,
  file_id: string,
  ext: string
): Promise<Buffer> {
  const filePath = safePath(basePath, user_key, file_id, ext);
  return fs.readFile(filePath);
}

export function createFileReadStream(
  basePath: string,
  user_key: string,
  file_id: string,
  ext: string
): ReadStream {
  const filePath = safePath(basePath, user_key, file_id, ext);
  return createReadStream(filePath);
}

export async function getFileSize(
  basePath: string,
  user_key: string,
  file_id: string,
  ext: string
): Promise<number> {
  const filePath = safePath(basePath, user_key, file_id, ext);
  const stat = await fs.stat(filePath);
  return stat.size;
}

export async function fileExists(
  basePath: string,
  user_key: string,
  file_id: string,
  ext: string
): Promise<boolean> {
  try {
    const filePath = safePath(basePath, user_key, file_id, ext);
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 특정 file_id 파일 1개만 삭제 (유저 디렉토리는 유지).
 */
export async function deleteFile(
  basePath: string,
  user_key: string,
  file_id: string,
  ext: string
): Promise<void> {
  const filePath = safePath(basePath, user_key, file_id, ext);
  await fs.rm(filePath, { force: true });
}
