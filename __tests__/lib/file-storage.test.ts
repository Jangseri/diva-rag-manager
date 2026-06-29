import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  saveFile,
  readFile,
  fileExists,
  getFilePath,
  deleteFile,
  getFileSize,
} from "@/lib/file-storage";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rag-test-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("getFilePath", () => {
  it("should construct correct file path: {base}/{clientServiceId}/{tenantId}/{file_id}.{ext}", () => {
    const result = getFilePath(tempDir, "25", "dnis-001", "01FILE", "pdf");
    expect(result).toBe(path.resolve(tempDir, "25", "dnis-001", "01FILE.pdf"));
  });

  it("should lowercase extension", () => {
    const result = getFilePath(tempDir, "25", "dnis-001", "01FILE", "PDF");
    expect(result.endsWith(".pdf")).toBe(true);
  });

  it("should strip leading dot from ext", () => {
    const result = getFilePath(tempDir, "25", "dnis-001", "01FILE", ".txt");
    expect(result.endsWith(".txt")).toBe(true);
  });
});

describe("saveFile / readFile", () => {
  it("should save and read back", async () => {
    const buffer = Buffer.from("hello world");
    const savedPath = await saveFile(tempDir, "25", "dnis-001", "01FILE", "txt", buffer);
    expect(savedPath).toBe(path.resolve(tempDir, "25", "dnis-001", "01FILE.txt"));

    const read = await readFile(tempDir, "25", "dnis-001", "01FILE", "txt");
    expect(read.toString()).toBe("hello world");
  });

  it("should create directories if not exists", async () => {
    const buffer = Buffer.from("x");
    await saveFile(tempDir, "99", "newuser", "01X", "txt", buffer);
    const dir = path.join(tempDir, "99", "newuser");
    const stat = await fs.stat(dir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("should overwrite existing file", async () => {
    await saveFile(tempDir, "c", "u", "f", "txt", Buffer.from("first"));
    await saveFile(tempDir, "c", "u", "f", "txt", Buffer.from("second"));
    const content = await readFile(tempDir, "c", "u", "f", "txt");
    expect(content.toString()).toBe("second");
  });
});

describe("fileExists", () => {
  it("should return true for existing file", async () => {
    await saveFile(tempDir, "c", "u", "f", "txt", Buffer.from("x"));
    expect(await fileExists(tempDir, "c", "u", "f", "txt")).toBe(true);
  });

  it("should return false for non-existing file", async () => {
    expect(await fileExists(tempDir, "c", "u", "nope", "txt")).toBe(false);
  });
});

describe("getFileSize", () => {
  it("should return correct byte size", async () => {
    await saveFile(tempDir, "c", "u", "f", "txt", Buffer.from("1234567890"));
    const size = await getFileSize(tempDir, "c", "u", "f", "txt");
    expect(size).toBe(10);
  });
});

describe("deleteFile", () => {
  it("should delete the file", async () => {
    await saveFile(tempDir, "c", "u", "f", "txt", Buffer.from("x"));
    await deleteFile(tempDir, "c", "u", "f", "txt");
    expect(await fileExists(tempDir, "c", "u", "f", "txt")).toBe(false);
  });

  it("should not throw if file does not exist", async () => {
    await expect(
      deleteFile(tempDir, "c", "u", "nope", "txt")
    ).resolves.not.toThrow();
  });
});

describe("path traversal protection", () => {
  it("should reject path traversal in clientServiceId", () => {
    expect(() => getFilePath(tempDir, "../../etc", "u", "id", "txt")).toThrow();
  });

  it("should reject path traversal in tenantId", () => {
    expect(() => getFilePath(tempDir, "c", "../../etc", "id", "txt")).toThrow();
  });

  it("should reject path traversal in file_id", () => {
    expect(() => getFilePath(tempDir, "c", "u", "../../escape", "txt")).toThrow();
  });

  it("should reject empty clientServiceId", () => {
    expect(() => getFilePath(tempDir, "", "u", "id", "txt")).toThrow();
  });

  it("should reject empty tenantId", () => {
    expect(() => getFilePath(tempDir, "c", "", "id", "txt")).toThrow();
  });

  it("should reject empty file_id", () => {
    expect(() => getFilePath(tempDir, "c", "u", "", "txt")).toThrow();
  });
});
