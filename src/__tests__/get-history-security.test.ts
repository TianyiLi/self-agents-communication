import { describe, it, expect } from "bun:test";

/**
 * Tests for get_history stream access validation.
 * The validateStreamAccess logic is inlined in the tool, so we test the pattern matching directly.
 */

const AGENT_ID = "test-agent";

/** Mirrors the validation logic in src/mcp/tools/get-history.ts */
function validateStreamPattern(stream: string, subscribedChannels: Set<string>): string | null {
  // Own inbox
  if (stream === `stream:agent:${AGENT_ID}:inbox`) return null;

  // System introductions
  if (stream === "stream:system:introductions") return null;

  // Group streams
  if (/^stream:group:-?\d+$/.test(stream)) return null;

  // Subscribed channels only
  if (stream.startsWith("stream:channel:")) {
    const channelName = stream.replace("stream:channel:", "");
    if (subscribedChannels.has(channelName)) return null;
    return `Access denied: not subscribed to channel '${channelName}'.`;
  }

  return `Access denied: cannot read stream '${stream}'.`;
}

describe("get_history stream access", () => {
  const subscribed = new Set(["api-updates", "deploy-log"]);

  it("allows own inbox", () => {
    expect(validateStreamPattern(`stream:agent:${AGENT_ID}:inbox`, subscribed)).toBeNull();
  });

  it("allows system introductions", () => {
    expect(validateStreamPattern("stream:system:introductions", subscribed)).toBeNull();
  });

  it("allows group streams", () => {
    expect(validateStreamPattern("stream:group:-100123456", subscribed)).toBeNull();
    expect(validateStreamPattern("stream:group:999", subscribed)).toBeNull();
  });

  it("allows subscribed channels", () => {
    expect(validateStreamPattern("stream:channel:api-updates", subscribed)).toBeNull();
    expect(validateStreamPattern("stream:channel:deploy-log", subscribed)).toBeNull();
  });

  it("rejects other agent inboxes", () => {
    const result = validateStreamPattern("stream:agent:other-agent:inbox", subscribed);
    expect(result).not.toBeNull();
    expect(result).toContain("Access denied");
  });

  it("rejects unsubscribed channels", () => {
    const result = validateStreamPattern("stream:channel:secret-ops", subscribed);
    expect(result).not.toBeNull();
    expect(result).toContain("not subscribed");
  });

  it("rejects arbitrary keys", () => {
    expect(validateStreamPattern("anything:else", subscribed)).not.toBeNull();
    expect(validateStreamPattern("stream:agent:other:inbox", subscribed)).not.toBeNull();
  });
});
