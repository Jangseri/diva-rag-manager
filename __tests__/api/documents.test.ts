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
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  };
  return { prismaMock };
});

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/file-storage", () => ({
  saveFile: vi.fn().mockResolvedValue("/storage/tsid/file.pdf"),
  readFile: vi.fn().mockResolvedValue(Buffer.from("file content")),
  fileExists: vi.fn().mockResolvedValue(true),
  deleteFileDirectory: vi.fn().mockResolvedValue(undefined),
  getFilePath: vi.fn().mockReturnValue("/storage/tsid/file.pdf"),
}));

vi.mock("@/lib/tsid", () => ({
  generateTsid: vi.fn().mockReturnValue("test_tsid_001"),
}));

import {
  listDocuments,
  getDocument,
  createDocument,
  softDeleteDocument,
} from "@/lib/services/document-service";

beforeEach(() => {
  Object.values(prismaMock.document).forEach((fn) => fn.mockReset());
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
    expect(result.page).toBe(1);
    expect(result.size).toBe(10);
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
      expect.objectContaining({
        skip: 10,
        take: 10,
      })
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
        where: expect.objectContaining({
          file_format: "pdf",
        }),
      })
    );
  });

  it("should filter by status", async () => {
    prismaMock.document.findMany.mockResolvedValue([]);
    prismaMock.document.count.mockResolvedValue(0);

    await listDocuments({
      page: 1,
      size: 10,
      sort: "rgst_dt",
      order: "desc",
      status: "ACTIVE",
    });

    expect(prismaMock.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "ACTIVE",
        }),
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

  it("should default to excluding DELETED documents when no status filter", async () => {
    prismaMock.document.findMany.mockResolvedValue([]);
    prismaMock.document.count.mockResolvedValue(0);

    await listDocuments({
      page: 1,
      size: 10,
      sort: "rgst_dt",
      order: "desc",
    });

    expect(prismaMock.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "ACTIVE",
        }),
      })
    );
  });
});

describe("getDocument", () => {
  it("should return document by uuid", async () => {
    const record = createDocumentRecord({ uuid: "test_uuid" });
    prismaMock.document.findUnique.mockResolvedValue(record);

    const result = await getDocument("test_uuid");

    expect(result).toBeDefined();
    expect(result!.uuid).toBe("test_uuid");
    expect(prismaMock.document.findUnique).toHaveBeenCalledWith({
      where: { uuid: "test_uuid" },
    });
  });

  it("should return null for non-existing document", async () => {
    prismaMock.document.findUnique.mockResolvedValue(null);

    const result = await getDocument("non_exist");

    expect(result).toBeNull();
  });
});

describe("createDocument", () => {
  it("should create document record", async () => {
    const record = createDocumentRecord();
    prismaMock.document.create.mockResolvedValue(record);

    const result = await createDocument({
      uuid: "test_tsid_001",
      file_name: "test.pdf",
      user_key: "user001",
      file_format: "pdf",
      file_size: BigInt(1024),
      rgst_nm: "홍길동",
    });

    expect(result).toBeDefined();
    expect(prismaMock.document.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        uuid: "test_tsid_001",
        file_name: "test.pdf",
        user_key: "user001",
        file_format: "pdf",
        file_size: BigInt(1024),
        rgst_nm: "홍길동",
        updt_nm: "홍길동",
        status: "ACTIVE",
        file_status: "UPLOADED",
      }),
    });
  });
});

describe("softDeleteDocument", () => {
  it("should set status to DELETED", async () => {
    const record = createDocumentRecord({ uuid: "del_uuid", status: "ACTIVE" });
    prismaMock.document.findUnique.mockResolvedValue(record);
    prismaMock.document.update.mockResolvedValue({
      ...record,
      status: "DELETED",
    });

    const result = await softDeleteDocument("del_uuid", "관리자");

    expect(result).toBeDefined();
    expect(prismaMock.document.update).toHaveBeenCalledWith({
      where: { uuid: "del_uuid" },
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
    const record = createDocumentRecord({
      uuid: "del_uuid",
      status: "DELETED",
    });
    prismaMock.document.findUnique.mockResolvedValue(record);

    await expect(softDeleteDocument("del_uuid", "관리자")).rejects.toThrow(
      "이미 삭제된 문서입니다"
    );
  });
});
