import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { RedisService } from "../redis";
import { FocusService } from "../focus";

const redis = new RedisService();
const KEY = "agent:test-focus:focus";
let focus: FocusService;

beforeAll(async () => {
  await redis.connect(Bun.env.REDIS_URI || "redis://localhost:6379");
  focus = new FocusService(redis, "test-focus");
});

afterAll(async () => {
  await redis.del(KEY, "agent:other-agent:focus");
  await redis.disconnect();
});

beforeEach(async () => {
  await redis.del(KEY, "agent:other-agent:focus");
});

describe("FocusService", () => {
  test("enable stores focus state", async () => {
    const state = await focus.enable("deep work", 10);

    expect(state.enabled).toBe(true);
    expect(state.reason).toBe("deep work");
    expect(state.expires_at).toBeDefined();
    expect(await focus.isFocused()).toBe(true);
  });

  test("disable clears focus state", async () => {
    await focus.enable();
    await focus.disable();

    expect(await focus.get()).toBeNull();
    expect(await focus.isFocused()).toBe(false);
  });

  test("can read another agent focus key", async () => {
    await redis.set(
      "agent:other-agent:focus",
      JSON.stringify({ enabled: true, started_at: "123" })
    );

    expect(await focus.isFocused("other-agent")).toBe(true);
  });
});
