import { vi } from "vitest";

export const prismaMock = {
  document: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

export function resetPrismaMock() {
  Object.values(prismaMock.document).forEach((fn) => fn.mockReset());
}
