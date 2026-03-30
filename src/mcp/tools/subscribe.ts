import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RedisService } from "../../services/redis";
import type { AgentRegistry } from "../../services/agent-registry";
import type { PushLoop } from "../push";
import type { SessionManager } from "../session";
import { guardSession } from "./guard";

export function registerSubscribeTool(
  server: McpServer,
  redis: RedisService,
  registry: AgentRegistry,
  pushLoop: PushLoop,
  sessionManager: SessionManager
) {
  server.tool(
    "subscribe",
    "Subscribe to a channel to start receiving messages from other agents in real time. " +
      "Once subscribed, new messages published to this channel will be automatically pushed " +
      "to you as notifications. Also returns the most recent message history so you can " +
      "catch up on prior context. Your subscription persists across reconnections. " +
      "Use descriptive channel names like 'api-updates', 'deploy-status', 'code-review'. " +
      "Call list_agents first to discover what channels other agents are using.",
    {
      channel: z.string().describe(
        "Channel name to subscribe to (e.g. 'api-updates', 'deploy-status'). " +
          "Creates the channel if it doesn't exist yet."
      ),
    },
    async ({ channel }, extra) => {
      const denied = guardSession(extra.sessionId ?? "", sessionManager);
      if (denied) return denied;
      await registry.addSubscription(channel);
      pushLoop.addChannel(channel);

      // Return recent history for context
      const streamKey = `stream:channel:${channel}`;
      await redis.ensureConsumerGroup(streamKey, `agent:${registry.agentId}`);
      const history = await redis.xrange(streamKey, "-", "+", 10);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "subscribed",
            channel,
            recent_messages: history.map((h) => h.message),
          }),
        }],
      };
    }
  );
}
