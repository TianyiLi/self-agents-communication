export const Config = {
  agentId: Bun.env.AGENT_ID || "default-agent",
  agentName: Bun.env.AGENT_NAME || "default-agent",
  agentRole: Bun.env.AGENT_ROLE || "general",
  agentDesc: Bun.env.AGENT_DESC || "",
  agentCaps: (Bun.env.AGENT_CAPS || "").split(",").filter(Boolean),
  agentProject: Bun.env.AGENT_PROJECT || "",
  botToken: Bun.env.BOT_TOKEN || "",
  redisUri: Bun.env.REDIS_URI || "redis://localhost:6379",
  mcpPort: parseInt(Bun.env.MCP_PORT || "3100"),
  allowedChatIds: (Bun.env.ALLOWED_CHAT_IDS || "").split(",").filter(Boolean),
};
