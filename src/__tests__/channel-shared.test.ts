import { describe, expect, it } from "bun:test";
import {
  buildChannelInstructions,
  ChannelStreamReader,
  sourceFromStream,
} from "../channel/shared";

describe("channel source mapping", () => {
  it("maps Redis stream keys to channel sources", () => {
    expect(sourceFromStream("stream:agent:frontend-agent:inbox")).toBe("inbox");
    expect(sourceFromStream("stream:system:introductions")).toBe("system");
    expect(sourceFromStream("stream:channel:team")).toBe("channel:team");
    expect(sourceFromStream("stream:channel:api-updates")).toBe("channel:api-updates");
  });
});

describe("channel instructions", () => {
  it("describes Claude channel push delivery", () => {
    const text = buildChannelInstructions({
      agentId: "frontend-agent",
      agentName: "Frontend Agent",
      agentRole: "frontend",
      agentDesc: "Builds UI",
      agentCaps: "react,css",
      delivery: "claude-channel",
    });

    expect(text).toContain("Messages arrive as <channel> tags");
    expect(text).toContain('meta.must_reply="true"');
    expect(text).toContain('meta.from="frontend-agent"');
    expect(text).toContain("Capabilities: react,css");
  });

  it("describes generic polling delivery", () => {
    const text = buildChannelInstructions({
      agentId: "codex-agent",
      agentName: "Codex Agent",
      agentRole: "general",
      agentDesc: "",
      agentCaps: "",
      delivery: "polling",
    });

    expect(text).toContain("Call poll_channel_messages");
    expect(text).not.toContain("Capabilities:");
    expect(text).toContain("Use reply to send results back to the Telegram user");
  });
});

describe("ChannelStreamReader", () => {
  it("reads channel messages with metadata, filters self echoes, and acks consumed messages", async () => {
    const calls = {
      connect: 0,
      sadd: [] as Array<[string, string]>,
      ensureGroups: [] as Array<[string, string]>,
      xreadgroup: [] as Array<{
        groupName: string;
        consumerName: string;
        streamKeys: string[];
        count: number;
        block?: number;
        id: string;
      }>,
      xack: [] as Array<[string, string, string[]]>,
    };

    const fakeRedis = {
      async connect() {
        calls.connect++;
      },
      async disconnect() {},
      async sadd(key: string, member: string) {
        calls.sadd.push([key, member]);
      },
      async ensureConsumerGroup(stream: string, groupName: string) {
        calls.ensureGroups.push([stream, groupName]);
      },
      async smembers() {
        return ["team", "api-updates"];
      },
      async hget() {
        return undefined;
      },
      async xreadgroup(
        groupName: string,
        consumerName: string,
        streamKeys: string[],
        count: number,
        block?: number,
        id = ">"
      ) {
        calls.xreadgroup.push({ groupName, consumerName, streamKeys, count, block, id });
        if (id === "0") return [];

        return [{
          streamKey: "stream:channel:team",
          messages: [
            {
              id: "1-0",
              message: {
                from: "frontend-agent",
                content: "self echo",
                timestamp: String(Date.now()),
              },
            },
            {
              id: "2-0",
              message: {
                from: "backend-agent",
                from_name: "Backend Agent",
                type: "status",
                content: "API ready",
                must_reply: "false",
                chat_id: "-100",
                message_id: "42",
                is_bot: "true",
                timestamp: String(Date.now()),
              },
            },
          ],
        }];
      },
      async xack(streamKey: string, groupName: string, ids: string[]) {
        calls.xack.push([streamKey, groupName, ids]);
      },
    };

    const reader = new ChannelStreamReader({
      agentId: "frontend-agent",
      redisUri: "redis://example.invalid:6379",
      mediaDirPrefix: "agent-channel-test",
    });
    (reader as any).redis = fakeRedis;

    const messages = await reader.read(25, 5);

    expect(calls.connect).toBe(1);
    expect(calls.sadd).toEqual([["agent:frontend-agent:subscriptions", "team"]]);
    expect(calls.ensureGroups).toContainEqual([
      "stream:agent:frontend-agent:inbox",
      "channel:agent:frontend-agent",
    ]);
    expect(calls.ensureGroups).toContainEqual([
      "stream:system:introductions",
      "channel:agent:frontend-agent",
    ]);
    expect(calls.ensureGroups).toContainEqual([
      "stream:channel:team",
      "channel:agent:frontend-agent",
    ]);
    expect(calls.ensureGroups).toContainEqual([
      "stream:channel:api-updates",
      "channel:agent:frontend-agent",
    ]);

    const normalRead = calls.xreadgroup.at(-1)!;
    expect(normalRead).toMatchObject({
      groupName: "channel:agent:frontend-agent",
      consumerName: "frontend-agent",
      count: 5,
      block: 25,
      id: ">",
    });
    expect(normalRead.streamKeys).toEqual([
      "stream:agent:frontend-agent:inbox",
      "stream:system:introductions",
      "stream:channel:team",
      "stream:channel:api-updates",
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "2-0",
      stream: "stream:channel:team",
      source: "channel:team",
      content: "API ready",
      meta: {
        source: "channel:team",
        stream: "stream:channel:team",
        from: "backend-agent",
        from_name: "Backend Agent",
        type: "status",
        must_reply: "false",
        chat_id: "-100",
        message_id: "42",
        is_bot: "true",
        media_paths: "",
      },
    });
    expect(calls.xack).toEqual([
      ["stream:channel:team", "channel:agent:frontend-agent", ["1-0"]],
      ["stream:channel:team", "channel:agent:frontend-agent", ["2-0"]],
    ]);
  });
});
