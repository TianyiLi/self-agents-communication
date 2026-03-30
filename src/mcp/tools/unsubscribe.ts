import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentRegistry } from "../../services/agent-registry";
import type { PushLoop } from "../push";

export function registerUnsubscribeTool(
  server: McpServer,
  registry: AgentRegistry,
  pushLoop: PushLoop
) {
  server.tool(
    "unsubscribe",
    "Unsubscribe from a channel to stop receiving its messages. " +
      "Use this when a channel is no longer relevant to your current work, " +
      "or to reduce notification noise. You can always re-subscribe later.",
    {
      channel: z.string().describe("Channel name to unsubscribe from"),
    },
    async ({ channel }) => {
      await registry.removeSubscription(channel);
      pushLoop.removeChannel(channel);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ status: "unsubscribed", channel }),
        }],
      };
    }
  );
}
