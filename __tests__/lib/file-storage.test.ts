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
  it("should construct correct file path: {base}/{user_key}/{file_id}.{ext}", () => {
    const result = getFilePath(tempDir, "user01", "01FILE", "pdf");
    expect(result).toBe(path.resolve(tempDir, "user01", "01FILE.pdf"));
  });

  it("should lowercase extension", () => {
    const result = getFilePath(tempDir, "user01", "01FILE", "PDF");
    expect(result.endsWith(".pdf")).toBe(true);
  });

  it("should strip leading dot from ext", () => {
    const result = getFilePath(tempDir, "user01", "01FILE", ".txt");
    expect(result.endsWith(".txt")).toBe(true);
  });
});

describe("saveFile / readFile", () => {
  it("should save and read back", async () => {
    const buffer = Buffer.from("hello world");
    const savedPath = await saveFile(tempDir, "user01", "01FILE", "txt", buffer);
    expect(savedPath).toBe(path.resolve(tempDir, "user01", "01FILE.txt"));

    const read = await readFile(tempDir, "user01", "01FILE", "txt");
    expect(read.toString()).toBe("hello world");
  });

  it("should create user_key directory if not exists", async () => {
    const buffer = Buffer.from("x");
    await saveFile(tempDir, "newuser", "01X", "txt", buffer);
    const dir = path.join(tempDir, "newuser");
    const stat = await fs.stat(dir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("should overwrite existing file", async () => {
    await saveFile(tempDir, "u", "f", "txt", Buffer.from("first"));
    await saveFile(tempDir, "u", "f", "txt", Buffer.from("second"));
    const content = await readFile(tempDir, "u", "f", "txt");
    expect(content.toString()).toBe("second");
  });
});

describe("fileExists", () => {
  it("should return true for existing file", async () => {
    await saveFile(tempDir, "u", "f", "txt", Buffer.from("x"));
    expect(await fileExists(tempDir, "u", "f", "txt")).toBe(true);
  });

  it("should return false for non-existing file", async () => {
    expect(await fileExists(tempDir, "u", "nope", "txt")).toBe(false);
  });
});

describe("getFileSize", () => {
  it("should return correct byte size", async () => {
    await saveFile(tempDir, "u", "f", "txt", Buffer.from("1234567890"));
    const size = await getFileSize(tempDir, "u", "f", "txt");
    expect(size).toBe(10);
  });
});

describe("deleteFile", () => {
  it("should delete the file", async () => {
    await saveFile(tempDir, "u", "f", "txt", Buffer.from("x"));
    await deleteFile(tempDir, "u", "f", "txt");
    expect(await fileExists(tempDir, "u", "f", "txt")).toBe(false);
  });

  it("should not throw if file does not exist", async () => {
    await expect(
      deleteFile(tempDir, "u", "nope", "txt")
    ).resolves.not.toThrow();
  });
});

describe("path traversal protection", () => {
  it("should reject path traversal in user_key", () => {
    expect(() => getFilePath(tempDir, "../../etc", "id", "txt")).toThrow();
  });

  it("should reject path traversal in file_id", () => {
    expect(() => getFilePath(tempDir, "u", "../../escape", "txt")).toThrow();
  });

  it("should reject invalid chars in user_key", () => {
    expect(() => getFilePath(tempDir, "u/../a", "id", "txt")).toThrow();
  });

  it("should reject empty user_key", () => {
    expect(() => getFilePath(tempDir, "", "id", "txt")).toThrow();
  });

  it("should reject empty file_id", () => {
    expect(() => getFilePath(tempDir, "u", "", "txt")).toThrow();
  });
});
