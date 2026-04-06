import { describe, it, expect } from "bun:test";
import type { StreamMessage, AgentProfile } from "../types";

describe("StreamMessage metadata fields", () => {
  it("accepts all new optional fields", () => {
    const msg: StreamMessage = {
      id: "1",
      from: "user",
      from_name: "Alice",
      type: "text",
      content: "hello",
      timestamp: "1000",
      // new metadata fields
      reply_to_content: "original text",
      reply_to_from: "Bob",
      user_id: "12345",
      username: "alice_dev",
      is_bot: "false",
      media: JSON.stringify([{ type: "photo", file_id: "abc" }]),
    };
    expect(msg.reply_to_content).toBe("original text");
    expect(msg.reply_to_from).toBe("Bob");
    expect(msg.user_id).toBe("12345");
    expect(msg.username).toBe("alice_dev");
    expect(msg.is_bot).toBe("false");
    expect(JSON.parse(msg.media!)).toHaveLength(1);
  });

  it("works without new fields (backward compat)", () => {
    const msg: StreamMessage = {
      id: "2",
      from: "agent",
      from_name: "Bot",
      type: "command",
      content: "do something",
      timestamp: "2000",
    };
    expect(msg.reply_to_content).toBeUndefined();
    expect(msg.user_id).toBeUndefined();
    expect(msg.is_bot).toBeUndefined();
  });
});

describe("is_bot field values", () => {
  it("is 'true' for bot senders", () => {
    const msg: StreamMessage = {
      id: "3",
      from: "agent-1",
      from_name: "Agent",
      type: "text",
      content: "hi",
      is_bot: "true",
      timestamp: "3000",
    };
    expect(msg.is_bot).toBe("true");
  });

  it("is 'false' for human senders", () => {
    const msg: StreamMessage = {
      id: "4",
      from: "user",
      from_name: "Human",
      type: "text",
      content: "hi",
      is_bot: "false",
      timestamp: "4000",
    };
    expect(msg.is_bot).toBe("false");
  });
});

describe("reply context extraction pattern", () => {
  // Simulates the logic used in message handlers
  function extractReplyContext(message: {
    reply_to_message?: { text?: string; from?: { first_name?: string } };
  }): { reply_to_content?: string; reply_to_from?: string } {
    if (!message.reply_to_message) return {};
    return {
      reply_to_content: message.reply_to_message.text || "",
      reply_to_from: message.reply_to_message.from?.first_name || "",
    };
  }

  it("extracts reply context when reply_to_message exists", () => {
    const ctx = {
      reply_to_message: {
        text: "What do you think?",
        from: { first_name: "Carol" },
      },
    };
    const result = extractReplyContext(ctx);
    expect(result.reply_to_content).toBe("What do you think?");
    expect(result.reply_to_from).toBe("Carol");
  });

  it("returns empty strings for missing text/from", () => {
    const ctx = {
      reply_to_message: {},
    };
    const result = extractReplyContext(ctx);
    expect(result.reply_to_content).toBe("");
    expect(result.reply_to_from).toBe("");
  });

  it("returns empty object when no reply", () => {
    const result = extractReplyContext({});
    expect(result.reply_to_content).toBeUndefined();
    expect(result.reply_to_from).toBeUndefined();
  });
});

describe("AgentProfile mcp_port field", () => {
  it("accepts optional mcp_port", () => {
    const profile: AgentProfile = {
      agent_id: "test-agent",
      name: "Test",
      role: "tester",
      description: "A test agent",
      capabilities: ["test"],
      project: "test-project",
      bot_username: "test_bot",
      mcp_port: "3100",
    };
    expect(profile.mcp_port).toBe("3100");
  });

  it("works without mcp_port", () => {
    const profile: AgentProfile = {
      agent_id: "test-agent",
      name: "Test",
      role: "tester",
      description: "A test agent",
      capabilities: ["test"],
      project: "test-project",
      bot_username: "test_bot",
    };
    expect(profile.mcp_port).toBeUndefined();
  });
});
