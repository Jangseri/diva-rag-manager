import { describe, it, expect } from "vitest";
import { generateId } from "@/lib/id";

describe("ULID Generator", () => {
  it("should generate a non-empty string", () => {
    const id = generateId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("should generate IDs with 26 chars (ULID length)", () => {
    const id = generateId();
    expect(id.length).toBe(26);
  });

  it("should generate unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(1000);
  });

  it("should generate sortable IDs (later ID >= earlier)", () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id2 >= id1).toBe(true);
  });

  it("should use Crockford Base32 charset (no I, L, O, U)", () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
  });
});
