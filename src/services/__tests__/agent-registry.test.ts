import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { RedisService } from "../redis";
import { AgentRegistry } from "../agent-registry";

const redis = new RedisService();
let registry: AgentRegistry;

beforeAll(async () => {
  await redis.connect(Bun.env.REDIS_URI || "redis://localhost:6379");
  registry = new AgentRegistry(redis, {
    agent_id: "test-agent",
    name: "test-agent",
    role: "tester",
    description: "test agent",
    capabilities: ["testing"],
    project: "/tmp/test",
    bot_username: "test_bot",
  });
});

afterAll(async () => {
  // Cleanup
  await redis.del(
    "agent:test-agent:profile",
    "agent:test-agent:alive",
    "agent:test-agent:subscriptions"
  );
  await redis.srem("idx:agents:registry", "test-agent");
  await redis.srem("idx:agents:online", "test-agent");
  await redis.disconnect();
});

describe("AgentRegistry", () => {
  test("register stores profile and marks online", async () => {
    await registry.register();

    const profile = await redis.hgetall("agent:test-agent:profile");
    expect(profile.name).toBe("test-agent");
    expect(profile.role).toBe("tester");

    const isOnline = await redis.sismember("idx:agents:online", "test-agent");
    expect(isOnline).toBe(true);

    const isRegistered = await redis.sismember("idx:agents:registry", "test-agent");
    expect(isRegistered).toBe(true);
  });

  test("heartbeat refreshes alive key", async () => {
    await registry.heartbeat();
    const alive = await redis.get("agent:test-agent:alive");
    expect(alive).toBe("1");
  });

  test("listAgents returns all registered agents", async () => {
    const agents = await registry.listAgents();
    expect(agents.length).toBeGreaterThan(0);
    expect(agents.find((a) => a.agent_id === "test-agent")).toBeTruthy();
  });

  test("goOffline removes from online set", async () => {
    await registry.goOffline("shutdown");
    const isOnline = await redis.sismember("idx:agents:online", "test-agent");
    expect(isOnline).toBe(false);
  });
});
