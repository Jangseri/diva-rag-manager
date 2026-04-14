import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  saveFile,
  readFile,
  fileExists,
  getFilePath,
  deleteFileDirectory,
} from "@/lib/file-storage";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rag-test-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("getFilePath", () => {
  it("should construct correct file path", () => {
    const result = getFilePath(tempDir, "abc123", "document.pdf");
    expect(result).toBe(path.resolve(tempDir, "abc123", "document.pdf"));
  });
});

describe("saveFile", () => {
  it("should save file to correct location", async () => {
    const buffer = Buffer.from("test content");
    const filePath = await saveFile(tempDir, "tsid001", "test.pdf", buffer);

    expect(filePath).toBe(path.join(tempDir, "tsid001", "test.pdf"));

    const content = await fs.readFile(filePath);
    expect(content.toString()).toBe("test content");
  });

  it("should create nested directory if not exists", async () => {
    const buffer = Buffer.from("hello");
    await saveFile(tempDir, "newdir", "file.txt", buffer);

    const dirExists = await fs
      .stat(path.join(tempDir, "newdir"))
      .then(() => true)
      .catch(() => false);
    expect(dirExists).toBe(true);
  });

  it("should handle Korean filenames", async () => {
    const buffer = Buffer.from("한글 내용");
    const filePath = await saveFile(
      tempDir,
      "tsid002",
      "한글문서.hwp",
      buffer
    );

    const content = await fs.readFile(filePath);
    expect(content.toString()).toBe("한글 내용");
  });

  it("should overwrite existing file", async () => {
    const buffer1 = Buffer.from("first");
    const buffer2 = Buffer.from("second");

    await saveFile(tempDir, "tsid003", "file.txt", buffer1);
    await saveFile(tempDir, "tsid003", "file.txt", buffer2);

    const content = await fs.readFile(
      path.join(tempDir, "tsid003", "file.txt")
    );
    expect(content.toString()).toBe("second");
  });
});

describe("readFile", () => {
  it("should read existing file", async () => {
    const dir = path.join(tempDir, "tsid004");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "test.pdf"), "content");

    const buffer = await readFile(tempDir, "tsid004", "test.pdf");
    expect(buffer.toString()).toBe("content");
  });

  it("should throw error for non-existing file", async () => {
    await expect(
      readFile(tempDir, "nonexist", "file.pdf")
    ).rejects.toThrow();
  });
});

describe("fileExists", () => {
  it("should return true for existing file", async () => {
    const dir = path.join(tempDir, "tsid005");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "test.pdf"), "content");

    const exists = await fileExists(tempDir, "tsid005", "test.pdf");
    expect(exists).toBe(true);
  });

  it("should return false for non-existing file", async () => {
    const exists = await fileExists(tempDir, "nope", "file.pdf");
    expect(exists).toBe(false);
  });
});

describe("deleteFileDirectory", () => {
  it("should delete the entire directory for a TSID", async () => {
    const dir = path.join(tempDir, "tsid006");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "test.pdf"), "content");

    await deleteFileDirectory(tempDir, "tsid006");

    const exists = await fs
      .stat(dir)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("should not throw if directory does not exist", async () => {
    await expect(
      deleteFileDirectory(tempDir, "nonexist")
    ).resolves.not.toThrow();
  });
});

describe("path traversal protection", () => {
  it("should sanitize path traversal to safe basename", () => {
    const result = getFilePath(tempDir, "tsid", "../../../etc/passwd");
    expect(path.basename(result)).toBe("passwd");
    expect(result.startsWith(path.resolve(tempDir))).toBe(true);
  });

  it("should sanitize backslash traversal to safe basename", () => {
    const result = getFilePath(tempDir, "tsid", "..\\..\\etc\\passwd");
    expect(result.startsWith(path.resolve(tempDir))).toBe(true);
  });

  it("should reject empty fileName", () => {
    expect(() => getFilePath(tempDir, "tsid", "")).toThrow();
  });

  it("should reject dot-dot fileName", () => {
    expect(() => getFilePath(tempDir, "tsid", "..")).toThrow();
  });

  it("should strip directory components from fileName", async () => {
    const buffer = Buffer.from("safe content");
    const filePath = await saveFile(tempDir, "tsid007", "subdir/file.txt", buffer);
    expect(path.basename(filePath)).toBe("file.txt");
    expect(filePath.startsWith(path.resolve(tempDir))).toBe(true);
  });
});
