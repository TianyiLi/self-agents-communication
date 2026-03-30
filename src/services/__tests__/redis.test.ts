import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { RedisService } from "../redis";

// Requires a running Redis instance at REDIS_URI or localhost:6379
const redis = new RedisService();

beforeAll(async () => {
  await redis.connect(Bun.env.REDIS_URI || "redis://localhost:6379");
  // Clean test keys
  await redis.client.del("test:stream", "test:hash", "test:set");
});

afterAll(async () => {
  await redis.client.del("test:stream", "test:hash", "test:set");
  await redis.disconnect();
});

describe("RedisService", () => {
  test("xadd and xrange", async () => {
    const id = await redis.xadd("test:stream", { foo: "bar" });
    expect(id).toContain("-");

    const messages = await redis.xrange("test:stream", "-", "+", 10);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].message.foo).toBe("bar");
  });

  test("hash operations", async () => {
    await redis.hset("test:hash", { name: "agent-a", role: "dev" });
    const data = await redis.hgetall("test:hash");
    expect(data.name).toBe("agent-a");
    expect(data.role).toBe("dev");
  });

  test("set operations", async () => {
    await redis.sadd("test:set", "a", "b");
    const members = await redis.smembers("test:set");
    expect(members).toContain("a");
    expect(members).toContain("b");
  });

  test("consumer group create and xreadgroup", async () => {
    await redis.ensureConsumerGroup("test:stream", "agent:test-agent");
    await redis.xadd("test:stream", { msg: "hello" });

    const results = await redis.xreadgroup(
      "agent:test-agent",
      "test-agent",
      ["test:stream"],
      1
    );
    expect(results.length).toBeGreaterThan(0);

    // ACK
    for (const r of results) {
      await redis.xack(r.streamKey, "agent:test-agent", r.messages.map(m => m.id));
    }
  });
});
