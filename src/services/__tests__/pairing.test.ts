import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { RedisService } from "../redis";
import { PairingService } from "../pairing";

const redis = new RedisService();
let pairing: PairingService;

beforeAll(async () => {
  await redis.connect(Bun.env.REDIS_URI || "redis://localhost:6379");
  pairing = new PairingService(redis, "test-agent");
});

afterAll(async () => {
  await redis.del("pairing:test-agent:pending", "agent:test-agent:paired_user");
  await redis.disconnect();
});

describe("PairingService", () => {
  test("generateCode creates a 6-digit code", async () => {
    const code = await pairing.generateCode("12345");
    expect(code).toMatch(/^\d{6}$/);

    const stored = await redis.get("pairing:test-agent:pending");
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.code).toBe(code);
    expect(parsed.user_id).toBe("12345");
  });

  test("verifyCode succeeds with correct code", async () => {
    const code = await pairing.generateCode("67890");
    const result = await pairing.verifyCode(code);
    expect(result).toBe("67890");

    // Verify paired_user is set
    const paired = await pairing.getPairedUser();
    expect(paired).toBe("67890");
  });

  test("verifyCode fails with wrong code", async () => {
    await pairing.generateCode("11111");
    const result = await pairing.verifyCode("000000");
    expect(result).toBeNull();
  });

  test("isPaired returns true after pairing", async () => {
    await pairing.generateCode("99999");
    const code = (await redis.get("pairing:test-agent:pending"))!;
    await pairing.verifyCode(JSON.parse(code).code);
    expect(await pairing.isPaired()).toBe(true);
  });
});
