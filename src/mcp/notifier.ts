import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

/**
 * Abstract notifier interface.
 * Decouples push delivery from the specific MCP notification mechanism.
 *
 * Implementations:
 * - LoggingNotifier: uses sendLoggingMessage (works with ALL MCP clients)
 * - ChannelNotifier: uses notifications/claude/channel (Claude Code only, richer context)
 */
export interface Notifier {
  send(payload: NotifierPayload): Promise<void>;
}

export interface NotifierPayload {
  stream: string;
  content: string;
  meta: Record<string, string>;
}

/**
 * Universal MCP notifier via sendLoggingMessage.
 * Supported by all MCP clients (Claude Code, Gemini CLI, Cursor, etc.)
 */
export class LoggingNotifier implements Notifier {
  constructor(private server: Server) {}

  async send(payload: NotifierPayload): Promise<void> {
    await this.server.sendLoggingMessage({
      level: "info",
      data: {
        stream: payload.stream,
        content: payload.content,
        ...payload.meta,
      },
    });
  }
}

/**
 * Claude Code channel notifier via notifications/claude/channel.
 * Delivers as <channel> XML tags in Claude's context.
 * Only works with Claude Code (--channels flag required).
 */
export class ChannelNotifier implements Notifier {
  constructor(private server: Server) {}

  async send(payload: NotifierPayload): Promise<void> {
    await this.server.notification({
      method: "notifications/claude/channel",
      params: {
        content: payload.content,
        meta: {
          stream: payload.stream,
          ...payload.meta,
        },
      },
    });
  }
}

/**
 * Composite notifier — tries channel first, falls back to logging.
 * Use this when you don't know the client type.
 */
export class CompositeNotifier implements Notifier {
  private notifiers: Notifier[];

  constructor(...notifiers: Notifier[]) {
    this.notifiers = notifiers;
  }

  async send(payload: NotifierPayload): Promise<void> {
    for (const notifier of this.notifiers) {
      try {
        await notifier.send(payload);
        return; // First success wins
      } catch {
        continue; // Try next
      }
    }
  }
}

/**
 * Factory: create the right notifier based on config.
 *
 * NOTIFIER_MODE env var:
 *   "channel" — Claude Code channel only
 *   "logging" — Universal logging only (default)
 *   "auto"    — Try channel first, fallback to logging
 */
export function createNotifier(server: Server, mode?: string): Notifier {
  const notifierMode = mode || Bun.env.NOTIFIER_MODE || "logging";

  switch (notifierMode) {
    case "channel":
      return new ChannelNotifier(server);
    case "auto":
      return new CompositeNotifier(
        new ChannelNotifier(server),
        new LoggingNotifier(server)
      );
    case "logging":
    default:
      return new LoggingNotifier(server);
  }
}
