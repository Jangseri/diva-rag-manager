import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import type { ReadStream } from "fs";

function sanitizeFileName(fileName: string): string {
  const basename = path.basename(fileName);
  if (!basename || basename === "." || basename === "..") {
    throw new Error("유효하지 않은 파일명입니다");
  }
  return basename;
}

function safePath(basePath: string, tsid: string, fileName: string): string {
  const sanitized = sanitizeFileName(fileName);
  const fullPath = path.resolve(basePath, tsid, sanitized);
  const resolvedBase = path.resolve(basePath);

  if (!fullPath.startsWith(resolvedBase + path.sep)) {
    throw new Error("허용되지 않은 파일 경로입니다");
  }

  return fullPath;
}

export function getFilePath(
  basePath: string,
  tsid: string,
  fileName: string
): string {
  return safePath(basePath, tsid, fileName);
}

export async function saveFile(
  basePath: string,
  tsid: string,
  fileName: string,
  buffer: Buffer
): Promise<string> {
  const filePath = safePath(basePath, tsid, fileName);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function readFile(
  basePath: string,
  tsid: string,
  fileName: string
): Promise<Buffer> {
  const filePath = safePath(basePath, tsid, fileName);
  return fs.readFile(filePath);
}

export function createFileReadStream(
  basePath: string,
  tsid: string,
  fileName: string
): ReadStream {
  const filePath = safePath(basePath, tsid, fileName);
  return createReadStream(filePath);
}

export async function getFileSize(
  basePath: string,
  tsid: string,
  fileName: string
): Promise<number> {
  const filePath = safePath(basePath, tsid, fileName);
  const stat = await fs.stat(filePath);
  return stat.size;
}

export async function fileExists(
  basePath: string,
  tsid: string,
  fileName: string
): Promise<boolean> {
  try {
    const filePath = safePath(basePath, tsid, fileName);
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function deleteFileDirectory(
  basePath: string,
  tsid: string
): Promise<void> {
  const dir = path.resolve(basePath, tsid);
  const resolvedBase = path.resolve(basePath);

  if (!dir.startsWith(resolvedBase + path.sep)) {
    throw new Error("허용되지 않은 경로입니다");
  }

  await fs.rm(dir, { recursive: true, force: true });
}
