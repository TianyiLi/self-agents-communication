import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Config } from "@config/index";
import type { RedisService } from "../services/redis";
import type { AgentRegistry } from "../services/agent-registry";
import type { PairingService } from "../services/pairing";
import type { Bot } from "grammy";
import { PushLoop } from "./push";
import { registerAgentPairTool } from "./tools/agent-pair";
import { registerReplyTool } from "./tools/reply";
import { registerPublishTool } from "./tools/publish";
import { registerSubscribeTool } from "./tools/subscribe";
import { registerUnsubscribeTool } from "./tools/unsubscribe";
import { registerListAgentsTool } from "./tools/list-agents";
import { registerGetHistoryTool } from "./tools/get-history";
import { registerSendDirectTool } from "./tools/send-direct";
import consola from "consola";

export async function createMcpServer(
  redis: RedisService,
  registry: AgentRegistry,
  pairing: PairingService,
  bot: Bot
) {
  const mcpServer = new McpServer({
    name: `agent-comm-${Config.agentId}`,
    version: "1.0.0",
  });

  // PushLoop uses the low-level Server for sending notifications
  const pushLoop = new PushLoop(redis, mcpServer.server);

  // Restore subscriptions from Redis (persisted across restarts)
  const subs = await registry.getSubscriptions();
  for (const channel of subs) {
    pushLoop.addChannel(channel);
  }

  // Register all 8 tools
  registerAgentPairTool(mcpServer, pairing);
  registerReplyTool(mcpServer, bot);
  registerPublishTool(mcpServer, redis);
  registerSubscribeTool(mcpServer, redis, registry, pushLoop);
  registerUnsubscribeTool(mcpServer, registry, pushLoop);
  registerListAgentsTool(mcpServer, registry);
  registerGetHistoryTool(mcpServer, redis);
  registerSendDirectTool(mcpServer, redis);

  // Start the push loop (begins listening to Redis Streams)
  await pushLoop.start();

  // --- SSE HTTP Server ---
  // Uses node:http because SSEServerTransport requires Node.js
  // http.ServerResponse (not Bun's Web API Response)
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${Config.mcpPort}`);

    // SSE endpoint — clients connect here to establish the event stream
    if (url.pathname === "/sse") {
      consola.info("MCP client connected via SSE");
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);

      transport.onclose = () => {
        consola.info(`MCP client disconnected: ${transport.sessionId}`);
        transports.delete(transport.sessionId);
      };

      await mcpServer.connect(transport);
      return;
    }

    // Message endpoint — clients POST JSON-RPC messages here
    if (url.pathname === "/messages" && req.method === "POST") {
      const sessionId = url.searchParams.get("sessionId");
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (transport) {
        await transport.handlePostMessage(req, res);
        return;
      }
      res.writeHead(404);
      res.end("Session not found");
      return;
    }

    // Health check / info endpoint
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`Agent Communication MCP Server: ${Config.agentId}`);
  });

  httpServer.listen(Config.mcpPort);

  return { mcpServer, pushLoop, httpServer };
}
