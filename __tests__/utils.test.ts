import { describe, test, expect } from "bun:test";
import { wait } from "../server/utils/assert";
import { randomUlid } from "../server/utils/uid";

describe("utils", () => {
  describe("wait", () => {
    test("resolves after the specified delay", async () => {
      const start = Date.now();
      await wait(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });

    test("resolves with undefined", async () => {
      const result = await wait(1);
      expect(result).toBeUndefined();
    });
  });

  describe("randomUlid", () => {
    test("returns a 26-character string", () => {
      const id = randomUlid();
      expect(id).toHaveLength(26);
    });

    test("contains only valid Crockford Base32 characters", () => {
      const id = randomUlid();
      expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    });

    test("generates unique values on successive calls", () => {
      const ids = new Set(Array.from({ length: 100 }, () => randomUlid()));
      expect(ids.size).toBe(100);
    });
  });
});
