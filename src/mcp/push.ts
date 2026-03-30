import type { RedisService } from "../services/redis";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Config } from "@config/index";
import consola from "consola";

/**
 * PushLoop continuously reads from Redis Streams using XREADGROUP BLOCK
 * and pushes incoming messages to the MCP client via server.sendLoggingMessage().
 *
 * Fixed streams (always monitored):
 *   - stream:agent:{id}:inbox   (direct messages + Telegram user messages)
 *   - stream:system:introductions (agent online/offline events)
 *
 * Dynamic streams (added/removed via subscribe/unsubscribe tools):
 *   - stream:channel:{name}
 */
export class PushLoop {
  private running = false;
  private subscribedChannels = new Set<string>();
  private redis: RedisService;
  private server: Server;
  private agentId: string;

  constructor(redis: RedisService, server: Server) {
    this.redis = redis;
    this.server = server;
    this.agentId = Config.agentId;
  }

  addChannel(channel: string) {
    this.subscribedChannels.add(channel);
  }

  removeChannel(channel: string) {
    this.subscribedChannels.delete(channel);
  }

  getChannels(): string[] {
    return [...this.subscribedChannels];
  }

  async start() {
    this.running = true;

    // Ensure consumer groups for fixed streams
    const fixedStreams = [
      `stream:agent:${this.agentId}:inbox`,
      "stream:system:introductions",
    ];
    for (const stream of fixedStreams) {
      await this.redis.ensureConsumerGroup(stream, `agent:${this.agentId}`);
    }

    this.listen();
  }

  stop() {
    this.running = false;
  }

  private async listen() {
    while (this.running) {
      try {
        const streamKeys = [
          `stream:agent:${this.agentId}:inbox`,
          "stream:system:introductions",
          ...[...this.subscribedChannels].map((c) => `stream:channel:${c}`),
        ];

        // Ensure consumer groups exist for dynamic channels
        for (const key of streamKeys) {
          await this.redis.ensureConsumerGroup(key, `agent:${this.agentId}`);
        }

        const results = await this.redis.xreadgroup(
          `agent:${this.agentId}`,
          this.agentId,
          streamKeys,
          10,
          5000 // BLOCK 5 seconds
        );

        for (const result of results) {
          for (const msg of result.messages) {
            try {
              // Push message to MCP client via logging notification
              await this.server.sendLoggingMessage({
                level: "info",
                data: {
                  stream: result.streamKey,
                  ...msg.message,
                },
              });
            } catch {
              // SSE connection might not be established yet — silently ignore
            }
            await this.redis.xack(
              result.streamKey,
              `agent:${this.agentId}`,
              [msg.id]
            );
          }
        }
      } catch (err) {
        consola.error("Push loop error:", err);
        await Bun.sleep(1000); // Back off on error
      }
    }
  }
}
