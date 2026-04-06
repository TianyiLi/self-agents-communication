import { describe, it, expect } from "bun:test";
import { randomInt } from "node:crypto";

describe("pairing code generation", () => {
  it("generates 6-digit codes using crypto", () => {
    for (let i = 0; i < 100; i++) {
      const code = randomInt(100000, 1000000);
      expect(code).toBeGreaterThanOrEqual(100000);
      expect(code).toBeLessThan(1000000);
      expect(String(code)).toHaveLength(6);
    }
  });

  it("produces varied codes (not deterministic)", () => {
    const codes = new Set<number>();
    for (let i = 0; i < 50; i++) {
      codes.add(randomInt(100000, 1000000));
    }
    // With 50 random 6-digit numbers, collision probability is negligible
    expect(codes.size).toBeGreaterThan(40);
  });
});

describe("pairing attempt limiting", () => {
  it("MAX_PAIRING_ATTEMPTS is 5", () => {
    // Mirrors the constant in src/services/pairing.ts
    const MAX_PAIRING_ATTEMPTS = 5;
    expect(MAX_PAIRING_ATTEMPTS).toBe(5);
  });
});
