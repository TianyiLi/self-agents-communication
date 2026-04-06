import { z } from "zod";

const ConfigSchema = z.object({
  agentId: z.string().min(1, "AGENT_ID is required"),
  agentName: z.string().min(1),
  agentRole: z.string().default("general"),
  agentDesc: z.string().default(""),
  agentCaps: z.array(z.string()),
  agentProject: z.string().default(""),
  botToken: z.string().min(1, "BOT_TOKEN is required"),
  redisUri: z.string().url().default("redis://localhost:6379"),
  mcpPort: z.number().int().positive(),
  allowedChatIds: z.array(z.string()),
});

function loadConfig() {
  const raw = {
    agentId: Bun.env.AGENT_ID || "",
    agentName: Bun.env.AGENT_NAME || Bun.env.AGENT_ID || "default-agent",
    agentRole: Bun.env.AGENT_ROLE || "general",
    agentDesc: Bun.env.AGENT_DESC || "",
    agentCaps: (Bun.env.AGENT_CAPS || "").split(",").filter(Boolean),
    agentProject: Bun.env.AGENT_PROJECT || "",
    botToken: Bun.env.BOT_TOKEN || "",
    redisUri: Bun.env.REDIS_URI || "redis://localhost:6379",
    mcpPort: parseInt(Bun.env.MCP_PORT || "3100"),
    allowedChatIds: (Bun.env.ALLOWED_CHAT_IDS || "").split(",").filter(Boolean),
  };

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return result.data;
}

export const Config = loadConfig();
