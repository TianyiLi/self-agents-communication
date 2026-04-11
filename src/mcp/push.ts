import type { RedisService } from "../services/redis";
import { Config } from "@config/index";
import type { SessionManager } from "./session";
import type { Notifier } from "./notifier";
import consola from "consola";

/**
 * PushLoop continuously reads from Redis Streams using XREADGROUP BLOCK
 * and pushes incoming messages via the Notifier abstraction.
 * Only pushes when there is an active paired session.
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
  private createdGroups = new Set<string>();
  private redis: RedisService;
  private notifier: Notifier;
  private sessionManager: SessionManager;
  private agentId: string;

  constructor(redis: RedisService, notifier: Notifier, sessionManager: SessionManager) {
    this.redis = redis;
    this.notifier = notifier;
    this.sessionManager = sessionManager;
    this.agentId = Config.agentId;
  }

  private async ensureGroup(stream: string) {
    if (this.createdGroups.has(stream)) return;
    await this.redis.ensureConsumerGroup(stream, `agent:${this.agentId}`);
    this.createdGroups.add(stream);
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

    const fixedStreams = [
      `stream:agent:${this.agentId}:inbox`,
      "stream:system:introductions",
    ];
    for (const stream of fixedStreams) {
      await this.ensureGroup(stream);
    }

    // Recover pending messages from prior crash
    try {
      const pending = await this.redis.xreadgroup(
        `agent:${this.agentId}`, this.agentId, fixedStreams, 100, undefined, "0"
      );
      for (const result of pending) {
        for (const msg of result.messages) {
          await this.redis.xack(result.streamKey, `agent:${this.agentId}`, [msg.id]);
        }
      }
    } catch {
      // First run — no pending messages
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

        for (const key of streamKeys) {
          await this.ensureGroup(key);
        }

        const results = await this.redis.xreadgroup(
          `agent:${this.agentId}`,
          this.agentId,
          streamKeys,
          10,
          5000
        );

        for (const result of results) {
          for (const msg of result.messages) {
            // Skip own messages to prevent echo loops
            if (msg.message.from === this.agentId) {
              await this.redis.xack(
                result.streamKey,
                `agent:${this.agentId}`,
                [msg.id]
              );
              continue;
            }
            if (this.sessionManager.hasActiveSession()) {
              try {
                await this.notifier.send({
                  stream: result.streamKey,
                  content: msg.message.content || JSON.stringify(msg.message),
                  meta: {
                    from: msg.message.from || "",
                    from_name: msg.message.from_name || "",
                    type: msg.message.type || "",
                    must_reply: msg.message.must_reply || "false",
                    chat_id: msg.message.chat_id || "",
                    message_id: msg.message.message_id || "",
                    is_bot: msg.message.is_bot || "false",
                    media: msg.message.media || "",
                  },
                });
              } catch (err) {
                consola.warn("Notification send failed:", err);
              }
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
        await Bun.sleep(1000);
      }
    }
  }
}
