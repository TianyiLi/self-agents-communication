import { describe, expect, it } from "bun:test";
import { parseChannelCli } from "../channel/cli";
import { buildChannelNotification, formatChannelBatchForTurn } from "../channel/format";
import { LauncherPresence } from "../channel/launcher-presence";
import type { ChannelMessage } from "../channel/shared";

describe("channel CLI parser", () => {
  it("selects default server mode", () => {
    expect(parseChannelCli([], {})).toEqual({ kind: "server" });
  });

  it("selects setup and remove modes", () => {
    expect(parseChannelCli(["--mcp-setup", "--agent-id", "agent-a", "--sse-url", "http://localhost:3101/sse"], {})).toMatchObject({
      kind: "mcp-setup",
      agentId: "agent-a",
      sseUrl: "http://localhost:3101/sse",
    });
    expect(parseChannelCli(["--mcp-remove"], {})).toEqual({ kind: "mcp-remove" });
  });

  it("selects Claude and Codex launcher modes", () => {
    expect(parseChannelCli(["--claude", "--restart"], { AGENT_ID: "agent-a" })).toMatchObject({
      kind: "launcher",
      driver: "claude",
      config: {
        agentId: "agent-a",
        restart: true,
      },
    });
    expect(parseChannelCli(["--codex", "--cwd", "/tmp/project", "--model", "gpt-5.4"], {})).toMatchObject({
      kind: "launcher",
      driver: "codex",
      config: {
        cwd: "/tmp/project",
        model: "gpt-5.4",
      },
    });
  });
});

describe("channel launcher formatting", () => {
  it("formats a Claude single-message notification", () => {
    expect(buildChannelNotification([message("1-0", "hello", "true")])).toEqual({
      content: "hello",
      meta: {
        source: "inbox",
        from: "user",
        from_name: "Paul",
        type: "text",
        must_reply: "true",
        chat_id: "123",
        message_id: "456",
        is_bot: "false",
        media_paths: "",
      },
    });
  });

  it("formats Codex turn input with per-message metadata", () => {
    const text = formatChannelBatchForTurn([
      message("1-0", "build this", "true"),
      message("2-0", "fyi", "false"),
    ]);
    expect(text).toContain("At least one message has must_reply=true");
    expect(text).toContain("Message 1");
    expect(text).toContain("- chat_id: 123");
    expect(text).toContain("Content:\nbuild this");
    expect(text).toContain("Message 2");
  });
});

describe("LauncherPresence", () => {
  it("writes controller presence without touching process heartbeat", async () => {
    const calls: string[] = [];
    const store = new Map<string, string>();
    const sets = new Map<string, Set<string>>();
    const hashes = new Map<string, Record<string, string>>();

    const redis = {
      async setNx(key: string, value: string) {
        if (store.has(key)) return false;
        store.set(key, value);
        return true;
      },
      async set(key: string, value: string) {
        calls.push(`set:${key}`);
        store.set(key, value);
      },
      async hset(key: string, fields: Record<string, string>) {
        hashes.set(key, fields);
      },
      async expire(key: string) {
        calls.push(`expire:${key}`);
      },
      async sismember(key: string, member: string) {
        return sets.get(key)?.has(member) ?? false;
      },
      async sadd(key: string, member: string) {
        const set = sets.get(key) ?? new Set<string>();
        set.add(member);
        sets.set(key, set);
      },
      async srem(key: string, member: string) {
        sets.get(key)?.delete(member);
      },
      async exists(key: string) {
        return store.has(key);
      },
      async hgetall() {
        return { name: "Agent A", role: "dev", capabilities: "[]" };
      },
      async xadd() {},
      async get(key: string) {
        return store.get(key) ?? null;
      },
      async del(...keys: string[]) {
        keys.forEach((key) => store.delete(key));
      },
    } as any;

    const presence = new LauncherPresence(redis, "agent-a", "codex");
    expect(await presence.acquireLock()).toBe(true);
    await presence.markControllerOnline();
    await presence.refresh({ status: "ready", pid: 42, threadId: "thread-a" });

    expect(store.get("agent:agent-a:controller_alive")).toBe("1");
    expect(store.has("agent:agent-a:alive")).toBe(false);
    expect(sets.get("idx:agents:online")?.has("agent-a")).toBe(true);
    expect(hashes.get("agent:agent-a:launcher_status")).toMatchObject({
      driver: "codex",
      state: "ready",
      pid: "42",
      thread_id: "thread-a",
    });
  });
});

function message(id: string, content: string, mustReply: "true" | "false"): ChannelMessage {
  return {
    id,
    stream: "stream:agent:agent-a:inbox",
    source: "inbox",
    content,
    meta: {
      source: "inbox",
      stream: "stream:agent:agent-a:inbox",
      from: "user",
      from_name: "Paul",
      type: "text",
      must_reply: mustReply,
      chat_id: "123",
      message_id: "456",
      is_bot: "false",
      media_paths: "",
    },
    queueLatencyMs: 5,
    mediaLatencyMs: 0,
  };
}

