import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createDocumentRecord,
  createDocumentRecords,
} from "../factories/document";

const { prismaMock } = vi.hoisted(() => {
  const prismaMock = {
    document: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    processedEvent: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  };
  return { prismaMock };
});

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/file-storage", () => ({
  saveFile: vi.fn().mockResolvedValue("/data/diva/origin/user01/test.pdf"),
  readFile: vi.fn().mockResolvedValue(Buffer.from("file content")),
  fileExists: vi.fn().mockResolvedValue(true),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getFilePath: vi.fn().mockReturnValue("/data/diva/origin/user01/test.pdf"),
}));

vi.mock("@/lib/id", () => ({
  generateId: vi.fn().mockReturnValue("01TESTULID123456789012345A"),
  generateTsid: vi.fn().mockReturnValue("01TESTULID123456789012345A"),
}));

import {
  listDocuments,
  getDocument,
  createDocument,
  softDeleteDocument,
  findDuplicateDocument,
} from "@/lib/services/document-service";

beforeEach(() => {
  Object.values(prismaMock.document).forEach((fn) => fn.mockReset());
  Object.values(prismaMock.processedEvent).forEach((fn) => fn.mockReset());
});

describe("listDocuments", () => {
  it("should return paginated list with defaults", async () => {
    const records = createDocumentRecords(3);
    prismaMock.document.findMany.mockResolvedValue(records);
    prismaMock.document.count.mockResolvedValue(3);

    const result = await listDocuments({
      page: 1,
      size: 10,
      sort: "rgst_dt",
      order: "desc",
    });

    expect(result.data).toHaveLength(3);
    expect(result.total).toBe(3);
    expect(prismaMock.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 10,
        orderBy: { rgst_dt: "desc" },
      })
    );
  });

  it("should apply pagination correctly (page 2, size 10)", async () => {
    prismaMock.document.findMany.mockResolvedValue([]);
    prismaMock.document.count.mockResolvedValue(15);

    await listDocuments({ page: 2, size: 10, sort: "rgst_dt", order: "desc" });

    expect(prismaMock.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 })
    );
  });

  it("should filter by format", async () => {
    prismaMock.document.findMany.mockResolvedValue([]);
    prismaMock.document.count.mockResolvedValue(0);

    await listDocuments({
      page: 1,
      size: 10,
      sort: "rgst_dt",
      order: "desc",
      format: "pdf",
    });

    expect(prismaMock.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ file_format: "pdf" }),
      })
    );
  });

  it("should default to excluding DELETED documents when no status filter", async () => {
    prismaMock.document.findMany.mockResolvedValue([]);
    prismaMock.document.count.mockResolvedValue(0);

    await listDocuments({ page: 1, size: 10, sort: "rgst_dt", order: "desc" });

    expect(prismaMock.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "ACTIVE" }),
      })
    );
  });

  it("should search by file name", async () => {
    prismaMock.document.findMany.mockResolvedValue([]);
    prismaMock.document.count.mockResolvedValue(0);

    await listDocuments({
      page: 1,
      size: 10,
      sort: "rgst_dt",
      order: "desc",
      search: "report",
    });

    expect(prismaMock.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          file_name: { contains: "report" },
        }),
      })
    );
  });
});

describe("getDocument", () => {
  it("should return document by file_id", async () => {
    const record = createDocumentRecord({ file_id: "01TEST" });
    prismaMock.document.findUnique.mockResolvedValue(record);

    const result = await getDocument("01TEST");

    expect(result).toBeDefined();
    expect(result!.file_id).toBe("01TEST");
    expect(prismaMock.document.findUnique).toHaveBeenCalledWith({
      where: { file_id: "01TEST" },
    });
  });

  it("should return null for non-existing document", async () => {
    prismaMock.document.findUnique.mockResolvedValue(null);

    const result = await getDocument("non_exist");

    expect(result).toBeNull();
  });
});

describe("findDuplicateDocument", () => {
  it("should find ACTIVE duplicate by user_key + file_name", async () => {
    const record = createDocumentRecord({ user_key: "u1", file_name: "a.pdf" });
    prismaMock.document.findFirst.mockResolvedValue(record);

    const result = await findDuplicateDocument("u1", "a.pdf");

    expect(result).toBeDefined();
    expect(prismaMock.document.findFirst).toHaveBeenCalledWith({
      where: { user_key: "u1", file_name: "a.pdf", status: "ACTIVE" },
    });
  });
});

describe("createDocument", () => {
  it("should create document record with required fields", async () => {
    const record = createDocumentRecord();
    prismaMock.document.create.mockResolvedValue(record);

    const result = await createDocument({
      file_id: "01FILE",
      file_name: "test.pdf",
      user_key: "user001",
      file_format: "pdf",
      file_size: BigInt(1024),
      origin_path: "/data/diva/origin/user001/01FILE.pdf",
      rgst_nm: "홍길동",
    });

    expect(result).toBeDefined();
    expect(prismaMock.document.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        file_id: "01FILE",
        file_name: "test.pdf",
        user_key: "user001",
        file_format: "pdf",
        file_size: BigInt(1024),
        origin_path: "/data/diva/origin/user001/01FILE.pdf",
        rgst_nm: "홍길동",
        updt_nm: "홍길동",
        status: "ACTIVE",
        file_status: "UPLOADED",
        retry_count: 0,
        last_error_code: null,
      }),
    });
  });
});

describe("softDeleteDocument", () => {
  it("should set status to DELETED", async () => {
    const record = createDocumentRecord({ file_id: "01DEL", status: "ACTIVE" });
    prismaMock.document.findUnique.mockResolvedValue(record);
    prismaMock.document.update.mockResolvedValue({ ...record, status: "DELETED" });

    const result = await softDeleteDocument("01DEL", "관리자");

    expect(result).toBeDefined();
    expect(prismaMock.document.update).toHaveBeenCalledWith({
      where: { file_id: "01DEL" },
      data: { status: "DELETED", updt_nm: "관리자" },
    });
  });

  it("should throw error if document not found", async () => {
    prismaMock.document.findUnique.mockResolvedValue(null);

    await expect(softDeleteDocument("nope", "관리자")).rejects.toThrow(
      "문서를 찾을 수 없습니다"
    );
  });

  it("should throw error if document already deleted", async () => {
    const record = createDocumentRecord({ file_id: "01DEL", status: "DELETED" });
    prismaMock.document.findUnique.mockResolvedValue(record);

    await expect(softDeleteDocument("01DEL", "관리자")).rejects.toThrow(
      "이미 삭제된 문서입니다"
    );
  });
});
