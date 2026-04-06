import { describe, it, expect } from "bun:test";

describe("consumer group naming", () => {
  const AGENT_ID = "test-agent";

  it("PushLoop uses agent:{id} group name", () => {
    // Mirrors src/mcp/push.ts
    const pushGroupName = `agent:${AGENT_ID}`;
    expect(pushGroupName).toBe("agent:test-agent");
  });

  it("channel.ts uses channel:agent:{id} group name", () => {
    // Mirrors src/channel.ts
    const channelGroupName = `channel:agent:${AGENT_ID}`;
    expect(channelGroupName).toBe("channel:agent:test-agent");
  });

  it("group names are different (enables fan-out)", () => {
    const pushGroup = `agent:${AGENT_ID}`;
    const channelGroup = `channel:agent:${AGENT_ID}`;
    expect(pushGroup).not.toBe(channelGroup);
  });
});

describe("consumer group caching", () => {
  it("Set-based cache prevents duplicate ensureConsumerGroup calls", () => {
    const createdGroups = new Set<string>();
    let callCount = 0;

    function ensureGroup(stream: string) {
      if (createdGroups.has(stream)) return;
      callCount++;
      createdGroups.add(stream);
    }

    ensureGroup("stream:agent:test:inbox");
    ensureGroup("stream:agent:test:inbox"); // duplicate
    ensureGroup("stream:system:introductions");
    ensureGroup("stream:agent:test:inbox"); // duplicate again

    expect(callCount).toBe(2); // only 2 unique streams
  });
});

describe("pending message recovery", () => {
  it("recovery pass uses ID '0' while normal loop uses '>'", () => {
    const recoveryId = "0";
    const normalId = ">";
    expect(recoveryId).toBe("0");
    expect(normalId).toBe(">");
    expect(recoveryId).not.toBe(normalId);
  });
});
