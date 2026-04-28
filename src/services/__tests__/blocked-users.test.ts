import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { RedisService } from "../redis";
import { BlockedUsersService } from "../blocked-users";

const redis = new RedisService();
const BLOCK_KEY = "agent:test-block:blocked_users";
const ALIAS_KEY = "agent:test-block:user_aliases";
let svc: BlockedUsersService;

beforeAll(async () => {
  await redis.connect(Bun.env.REDIS_URI || "redis://localhost:6379");
  svc = new BlockedUsersService(redis, "test-block");
});

afterAll(async () => {
  await redis.del(BLOCK_KEY, ALIAS_KEY);
  await redis.disconnect();
});

beforeEach(async () => {
  await redis.del(BLOCK_KEY, ALIAS_KEY);
});

describe("BlockedUsersService", () => {
  test("isBlocked false by default", async () => {
    expect(await svc.isBlocked("123")).toBe(false);
  });

  test("block / isBlocked / list", async () => {
    await svc.block("111");
    await svc.block("222");
    expect(await svc.isBlocked("111")).toBe(true);
    expect(await svc.isBlocked("222")).toBe(true);
    expect(await svc.isBlocked("333")).toBe(false);
    expect((await svc.list()).sort()).toEqual(["111", "222"]);
  });

  test("unblock removes the entry", async () => {
    await svc.block("a");
    await svc.unblock("a");
    expect(await svc.isBlocked("a")).toBe(false);
  });

  test("rememberAlias / resolveAlias is case insensitive", async () => {
    await svc.rememberAlias("PaulYu", "9001");
    expect(await svc.resolveAlias("paulyu")).toBe("9001");
    expect(await svc.resolveAlias("PaulYu")).toBe("9001");
    expect(await svc.resolveAlias("@paulyu")).toBe("9001");
  });

  test("resolveAlias returns null for unknown handle", async () => {
    expect(await svc.resolveAlias("ghost")).toBeNull();
    expect(await svc.resolveAlias("@ghost")).toBeNull();
  });

  test("rememberAlias is idempotent and overwrites", async () => {
    await svc.rememberAlias("changes", "1");
    await svc.rememberAlias("changes", "2");
    expect(await svc.resolveAlias("changes")).toBe("2");
  });
});
