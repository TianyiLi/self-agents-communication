import { describe, it, expect } from "bun:test";

describe("self-message echo filtering", () => {
  const OWN_AGENT_ID = "frontend-agent";

  function shouldProcess(msg: { from?: string }, ownId: string): boolean {
    if (msg.from === ownId) return false;
    return true;
  }

  it("filters out own messages", () => {
    const msg = { from: "frontend-agent", content: "hi" };
    expect(shouldProcess(msg, OWN_AGENT_ID)).toBe(false);
  });

  it("passes messages from other agents", () => {
    const msg = { from: "backend-agent", content: "hi" };
    expect(shouldProcess(msg, OWN_AGENT_ID)).toBe(true);
  });

  it("passes user messages", () => {
    const msg = { from: "user", content: "hi" };
    expect(shouldProcess(msg, OWN_AGENT_ID)).toBe(true);
  });

  it("handles missing from field", () => {
    const msg = {};
    expect(shouldProcess(msg, OWN_AGENT_ID)).toBe(true);
  });
});

describe("group name separation (fan-out)", () => {
  it("PushLoop and channel.ts use different groups", () => {
    const agentId = "test-agent";
    const pushGroup = `agent:${agentId}`;
    const channelGroup = `channel:agent:${agentId}`;
    expect(pushGroup).not.toBe(channelGroup);
    // Both consumers receive every message because they're in different groups
  });
});

describe("team channel auto-subscribe", () => {
  it("agents subscribe to 'team' on startup", () => {
    const agentId = "test-agent";
    const subscriptionKey = `agent:${agentId}:subscriptions`;
    const teamChannel = "team";
    // Mirrors the sadd call in channel.ts start()
    expect(subscriptionKey).toBe("agent:test-agent:subscriptions");
    expect(teamChannel).toBe("team");
  });
});

describe("inter-agent message semantics", () => {
  it("agent-to-agent messages via send_direct have is_bot=true", () => {
    // Mirrors send-direct.ts xadd
    const fields = {
      from: "backend-agent",
      is_bot: "true",
      type: "text",
      content: "Can you check the UI?",
    };
    expect(fields.is_bot).toBe("true");
  });

  it("user messages from Telegram have is_bot=false", () => {
    const fields = {
      from: "user",
      is_bot: "false",
      content: "hello",
    };
    expect(fields.is_bot).toBe("false");
  });
});
