import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { RedisService } from "../redis";
import { AllowedChatsService } from "../allowed-chats";

const redis = new RedisService();
const KEY = "agent:test-allow:allowed_chats";
let svc: AllowedChatsService;

beforeAll(async () => {
  await redis.connect(Bun.env.REDIS_URI || "redis://localhost:6379");
  svc = new AllowedChatsService(redis, "test-allow");
});

afterAll(async () => {
  await redis.del(KEY);
  await redis.disconnect();
});

beforeEach(async () => {
  await redis.del(KEY);
});

describe("AllowedChatsService", () => {
  test("isAllowed returns true on empty set (legacy 'allow all')", async () => {
    expect(await svc.isAllowed("123")).toBe(true);
  });

  test("seedIfEmpty seeds when set empty", async () => {
    const n = await svc.seedIfEmpty(["111", "222"]);
    expect(n).toBe(2);
    expect((await svc.list()).sort()).toEqual(["111", "222"]);
  });

  test("seedIfEmpty no-op when set already populated", async () => {
    await svc.add("999");
    const n = await svc.seedIfEmpty(["111", "222"]);
    expect(n).toBe(0);
    expect(await svc.list()).toEqual(["999"]);
  });

  test("seedIfEmpty no-op when seed empty", async () => {
    const n = await svc.seedIfEmpty([]);
    expect(n).toBe(0);
  });

  test("isAllowed honours membership when set non-empty", async () => {
    await svc.add("allowed-id");
    expect(await svc.isAllowed("allowed-id")).toBe(true);
    expect(await svc.isAllowed("other-id")).toBe(false);
  });

  test("remove drops a chat id", async () => {
    await svc.add("a");
    await svc.add("b");
    await svc.remove("a");
    expect(await svc.list()).toEqual(["b"]);
  });

  test("remove last id reverts to legacy allow-all", async () => {
    await svc.add("only");
    expect(await svc.isAllowed("other")).toBe(false);
    await svc.remove("only");
    expect(await svc.isAllowed("other")).toBe(true);
  });
});
