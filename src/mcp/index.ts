import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Config } from "@config/index";
import type { RedisService } from "../services/redis";
import type { AgentRegistry } from "../services/agent-registry";
import type { PairingService } from "../services/pairing";
import type { Bot } from "grammy";
import { PushLoop } from "./push";
import { SessionManager } from "./session";
import { createNotifier } from "./notifier";
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

  const sessionManager = new SessionManager();

  // Create notifier — NOTIFIER_MODE env: "logging" (all clients), "channel" (Claude), "auto" (try both)
  // Notifier writes directly to SSE transport via sessionManager (bypasses Server internal transport)
  const notifier = createNotifier(sessionManager);
  const pushLoop = new PushLoop(redis, notifier, sessionManager);

  // Restore subscriptions from Redis (persisted across restarts)
  const subs = await registry.getSubscriptions();
  for (const channel of subs) {
    pushLoop.addChannel(channel);
  }

  // Register all 8 tools — pass sessionManager for access control
  registerAgentPairTool(mcpServer, pairing, sessionManager);
  registerReplyTool(mcpServer, bot, sessionManager);
  registerPublishTool(mcpServer, redis, sessionManager);
  registerSubscribeTool(mcpServer, redis, registry, pushLoop, sessionManager);
  registerUnsubscribeTool(mcpServer, registry, pushLoop, sessionManager);
  registerListAgentsTool(mcpServer, registry, sessionManager);
  registerGetHistoryTool(mcpServer, redis, sessionManager);
  registerSendDirectTool(mcpServer, redis, sessionManager);

  // Start the push loop (begins listening to Redis Streams)
  await pushLoop.start();

  // --- SSE HTTP Server (single session) ---
  // McpServer can only connect() to one transport at a time.
  // New connections close the previous transport before connecting.
  let activeTransport: SSEServerTransport | null = null;

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url!, `http://localhost:${Config.mcpPort}`);

    // SSE endpoint — single session only
    if (url.pathname === "/sse") {
      consola.info("MCP client connecting via SSE");

      // Close previous transport if exists
      if (activeTransport) {
        consola.info("Closing previous SSE connection");
        const oldId = activeTransport.sessionId;
        try {
          await activeTransport.close();
        } catch {
          // Already closed
        }
        sessionManager.removeTransport(oldId);
        // HACK: SDK lacks resetTransport(). Pin @modelcontextprotocol/sdk to exact version.
        // Reset McpServer's internal transport so connect() works again.
        // Don't call server.close() — that kills the Server and breaks push loop.
        try {
          (mcpServer as any)._transport = undefined;
          (mcpServer.server as any)._transport = undefined;
        } catch (err) {
          consola.warn("Failed to reset MCP transport (SDK internals may have changed):", err);
        }
        activeTransport = null;
      }

      const transport = new SSEServerTransport("/messages", res);
      activeTransport = transport;
      sessionManager.addTransport(transport.sessionId, transport);

      transport.onclose = () => {
        consola.info(`MCP client disconnected: ${transport.sessionId}`);
        sessionManager.removeTransport(transport.sessionId);
        if (activeTransport === transport) {
          activeTransport = null;
        }
      };

      await mcpServer.connect(transport);
      return;
    }

    // Message endpoint — clients POST JSON-RPC messages here
    if (url.pathname === "/messages" && req.method === "POST") {
      const sessionId = url.searchParams.get("sessionId");
      const transport = sessionId
        ? sessionManager.getTransport(sessionId)
        : undefined;
      if (transport) {
        await transport.handlePostMessage(req, res);
        return;
      }
      res.writeHead(404);
      res.end("Session not found");
      return;
    }

    // Health check
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        agent: Config.agentId,
        activeSession: sessionManager.hasActiveSession(),
      })
    );
  });

  httpServer.listen(Config.mcpPort);

  return { mcpServer, pushLoop, httpServer, sessionManager };
}
