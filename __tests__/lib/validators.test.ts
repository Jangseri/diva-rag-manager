import { describe, it, expect } from "vitest";
import {
  DocumentListQuerySchema,
  DocumentUploadMetaSchema,
  SearchQuerySchema,
  validateFileFormat,
  validateFileName,
  validateFileSize,
} from "@/lib/validators/document";

describe("DocumentListQuerySchema", () => {
  it("should accept valid query with all params", () => {
    const result = DocumentListQuerySchema.safeParse({
      page: "1",
      size: "10",
      sort: "rgst_dt",
      order: "desc",
      search: "test",
      format: "pdf",
      status: "ACTIVE",
    });
    expect(result.success).toBe(true);
  });

  it("should use defaults when no params provided", () => {
    const result = DocumentListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.size).toBe(10);
      expect(result.data.sort).toBe("rgst_dt");
      expect(result.data.order).toBe("desc");
    }
  });

  it("should reject page < 1", () => {
    const result = DocumentListQuerySchema.safeParse({ page: "0" });
    expect(result.success).toBe(false);
  });

  it("should reject page > 10000", () => {
    const result = DocumentListQuerySchema.safeParse({ page: "10001" });
    expect(result.success).toBe(false);
  });

  it("should reject invalid size", () => {
    const result = DocumentListQuerySchema.safeParse({ size: "999" });
    expect(result.success).toBe(false);
  });

  it("should reject invalid sort field", () => {
    const result = DocumentListQuerySchema.safeParse({ sort: "hacked" });
    expect(result.success).toBe(false);
  });

  it("should reject invalid format", () => {
    const result = DocumentListQuerySchema.safeParse({ format: "exe" });
    expect(result.success).toBe(false);
  });

  it("should reject invalid status", () => {
    const result = DocumentListQuerySchema.safeParse({ status: "HACKED" });
    expect(result.success).toBe(false);
  });

  it("should accept valid file_status", () => {
    for (const fs of ["UPLOADED", "PROCESSING", "EXTRACTED", "FAILED"]) {
      const result = DocumentListQuerySchema.safeParse({ file_status: fs });
      expect(result.success).toBe(true);
    }
  });

  it("should reject invalid file_status", () => {
    const result = DocumentListQuerySchema.safeParse({ file_status: "UNKNOWN" });
    expect(result.success).toBe(false);
  });

  it("should coerce string page/size to numbers", () => {
    const result = DocumentListQuerySchema.safeParse({
      page: "3",
      size: "20",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.size).toBe(20);
    }
  });
});

describe("DocumentUploadMetaSchema", () => {
  it("should accept valid upload metadata", () => {
    const result = DocumentUploadMetaSchema.safeParse({
      rgst_nm: "홍길동",
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty rgst_nm", () => {
    const result = DocumentUploadMetaSchema.safeParse({
      rgst_nm: "",
    });
    expect(result.success).toBe(false);
  });

  it("should reject rgst_nm over 100 chars", () => {
    const result = DocumentUploadMetaSchema.safeParse({
      rgst_nm: "a".repeat(101),
    });
    expect(result.success).toBe(false);
  });
});

describe("SearchQuerySchema", () => {
  it("should accept valid search query", () => {
    const result = SearchQuerySchema.safeParse({
      query: "인공지능 기반 문서 분석",
      method: "bm25",
      top_k: 5,
    });
    expect(result.success).toBe(true);
  });

  it("should default top_k to 5", () => {
    const result = SearchQuerySchema.safeParse({
      query: "test query",
      method: "vector",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.top_k).toBe(5);
    }
  });

  it("should reject empty query", () => {
    const result = SearchQuerySchema.safeParse({
      query: "",
      method: "bm25",
    });
    expect(result.success).toBe(false);
  });

  it("should reject whitespace-only query", () => {
    const result = SearchQuerySchema.safeParse({
      query: "   ",
      method: "bm25",
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid method", () => {
    const result = SearchQuerySchema.safeParse({
      query: "test",
      method: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("should reject top_k > 20", () => {
    const result = SearchQuerySchema.safeParse({
      query: "test",
      method: "hybrid",
      top_k: 21,
    });
    expect(result.success).toBe(false);
  });

  it("should reject top_k < 1", () => {
    const result = SearchQuerySchema.safeParse({
      query: "test",
      method: "hybrid",
      top_k: 0,
    });
    expect(result.success).toBe(false);
  });

  it("should accept all valid methods", () => {
    for (const method of ["bm25", "vector", "hybrid"]) {
      const result = SearchQuerySchema.safeParse({
        query: "test",
        method,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("validateFileFormat", () => {
  it("should accept allowed formats", () => {
    expect(validateFileFormat("document.pdf")).toBe(true);
    expect(validateFileFormat("report.docx")).toBe(true);
    expect(validateFileFormat("slide.pptx")).toBe(true);
    expect(validateFileFormat("data.xlsx")).toBe(true);
    expect(validateFileFormat("한글문서.hwp")).toBe(true);
    expect(validateFileFormat("readme.txt")).toBe(true);
    expect(validateFileFormat("photo.jpg")).toBe(true);
    expect(validateFileFormat("photo.jpeg")).toBe(true);
    expect(validateFileFormat("image.png")).toBe(true);
  });

  it("should reject disallowed formats", () => {
    expect(validateFileFormat("malware.exe")).toBe(false);
    expect(validateFileFormat("script.js")).toBe(false);
    expect(validateFileFormat("archive.zip")).toBe(false);
    expect(validateFileFormat("animation.gif")).toBe(false);
  });

  it("should be case-insensitive", () => {
    expect(validateFileFormat("DOCUMENT.PDF")).toBe(true);
    expect(validateFileFormat("Report.DOCX")).toBe(true);
  });

  it("should reject files without extension", () => {
    expect(validateFileFormat("noextension")).toBe(false);
  });

  it("should handle double extensions correctly", () => {
    expect(validateFileFormat("file.backup.pdf")).toBe(true);
    expect(validateFileFormat("file.pdf.exe")).toBe(false);
  });
});

describe("validateFileName", () => {
  it("should reject filenames over 255 chars", () => {
    const longName = "a".repeat(252) + ".pdf";
    expect(validateFileName(longName).valid).toBe(false);
  });

  it("should reject null bytes in filename", () => {
    expect(validateFileName("file\x00.pdf").valid).toBe(false);
  });

  it("should reject control characters", () => {
    expect(validateFileName("file\x0A.pdf").valid).toBe(false);
  });

  it("should reject filenames starting with dot", () => {
    expect(validateFileName(".hidden.pdf").valid).toBe(false);
  });

  it("should reject empty filename", () => {
    expect(validateFileName("").valid).toBe(false);
  });

  it("should accept valid filename", () => {
    expect(validateFileName("보고서_2026.pdf").valid).toBe(true);
  });
});

describe("validateFileSize", () => {
  it("should accept files within size limit", () => {
    expect(validateFileSize(1024)).toBe(true);
    expect(validateFileSize(50 * 1024 * 1024)).toBe(true);
  });

  it("should reject files exceeding size limit", () => {
    expect(validateFileSize(101 * 1024 * 1024)).toBe(false);
  });

  it("should reject zero-size files", () => {
    expect(validateFileSize(0)).toBe(false);
  });

  it("should reject negative sizes", () => {
    expect(validateFileSize(-1)).toBe(false);
  });

  it("should accept exact limit", () => {
    expect(validateFileSize(100 * 1024 * 1024)).toBe(true);
  });
});
