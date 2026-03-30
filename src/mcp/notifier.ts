import type { SessionManager } from "./session";

/**
 * Abstract notifier interface.
 * Decouples push delivery from the specific MCP notification mechanism.
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
 * Universal MCP notifier — writes JSON-RPC notification directly to the active SSE transport.
 * Bypasses McpServer/Server internal transport management which breaks on reconnect.
 *
 * Uses sendLoggingMessage format (notifications/message) which all MCP clients support.
 */
export class TransportNotifier implements Notifier {
  constructor(private sessionManager: SessionManager) {}

  async send(payload: NotifierPayload): Promise<void> {
    const sessionId = this.sessionManager.getActiveSessionId();
    if (!sessionId) return;

    const transport = this.sessionManager.getTransport(sessionId);
    if (!transport) return;

    // Write JSON-RPC notification directly to the SSE transport
    const notification = {
      jsonrpc: "2.0" as const,
      method: "notifications/message",
      params: {
        level: "info",
        data: {
          stream: payload.stream,
          content: payload.content,
          ...payload.meta,
        },
      },
    };

    await transport.send(notification);
  }
}

/**
 * Claude Code channel notifier — writes channel notification directly to SSE transport.
 * Delivers as <channel> XML tags in Claude's context.
 * Only works with Claude Code (--channels flag required).
 */
export class ChannelNotifier implements Notifier {
  constructor(private sessionManager: SessionManager) {}

  async send(payload: NotifierPayload): Promise<void> {
    const sessionId = this.sessionManager.getActiveSessionId();
    if (!sessionId) return;

    const transport = this.sessionManager.getTransport(sessionId);
    if (!transport) return;

    const notification = {
      jsonrpc: "2.0" as const,
      method: "notifications/claude/channel",
      params: {
        content: payload.content,
        meta: {
          stream: payload.stream,
          ...payload.meta,
        },
      },
    };

    await transport.send(notification);
  }
}

/**
 * Composite notifier — tries multiple notifiers in order.
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
        return;
      } catch {
        continue;
      }
    }
  }
}

/**
 * Factory: create the right notifier based on config.
 *
 * NOTIFIER_MODE env var:
 *   "channel" — Claude Code channel only
 *   "logging" — Universal transport notifier (default)
 *   "auto"    — Try channel first, fallback to logging
 */
export function createNotifier(sessionManager: SessionManager, mode?: string): Notifier {
  const notifierMode = mode || Bun.env.NOTIFIER_MODE || "logging";

  switch (notifierMode) {
    case "channel":
      return new ChannelNotifier(sessionManager);
    case "auto":
      return new CompositeNotifier(
        new ChannelNotifier(sessionManager),
        new TransportNotifier(sessionManager)
      );
    case "logging":
    default:
      return new TransportNotifier(sessionManager);
  }
}
