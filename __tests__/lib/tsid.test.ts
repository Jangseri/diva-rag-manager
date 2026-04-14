import { describe, it, expect } from "vitest";
import { generateTsid } from "@/lib/tsid";

describe("TSID Generator", () => {
  it("should generate a non-empty string", () => {
    const id = generateTsid();
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("should generate IDs with length <= 30 characters", () => {
    const id = generateTsid();
    expect(id.length).toBeLessThanOrEqual(30);
  });

  it("should generate unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateTsid());
    }
    expect(ids.size).toBe(1000);
  });

  it("should generate IDs that are sortable (later IDs are >= earlier IDs)", () => {
    const id1 = generateTsid();
    const id2 = generateTsid();
    expect(id2 >= id1).toBe(true);
  });

  it("should only contain alphanumeric characters", () => {
    const id = generateTsid();
    expect(id).toMatch(/^[a-zA-Z0-9]+$/);
  });
});
