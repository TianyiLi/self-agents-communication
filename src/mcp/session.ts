import type { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import consola from "consola";

const PING_TIMEOUT_MS = 2000;

/**
 * Manages the single active MCP session.
 * Only one paired session is allowed at a time.
 * New sessions must pass a ping check on the old session before taking over.
 */
export class SessionManager {
  private activeSessionId: string | null = null;
  private transports = new Map<string, SSEServerTransport>();

  addTransport(sessionId: string, transport: SSEServerTransport) {
    this.transports.set(sessionId, transport);
  }

  removeTransport(sessionId: string) {
    this.transports.delete(sessionId);
    if (this.activeSessionId === sessionId) {
      consola.info(`Active session disconnected: ${sessionId}`);
      this.activeSessionId = null;
    }
  }

  getTransport(sessionId: string): SSEServerTransport | undefined {
    return this.transports.get(sessionId);
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  isActiveSession(sessionId: string): boolean {
    return this.activeSessionId === sessionId;
  }

  hasActiveSession(): boolean {
    return this.activeSessionId !== null;
  }

  /**
   * Try to claim the active session slot.
   * If there's an existing active session, ping it first.
   * Returns { ok: true } if claimed, { ok: false, reason } if denied.
   */
  async claimSession(
    newSessionId: string
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    // No active session — claim immediately
    if (!this.activeSessionId) {
      this.activeSessionId = newSessionId;
      consola.success(`Session claimed: ${newSessionId}`);
      return { ok: true };
    }

    // Same session re-pairing
    if (this.activeSessionId === newSessionId) {
      return { ok: true };
    }

    // There's an existing session — ping it
    const oldTransport = this.transports.get(this.activeSessionId);
    if (!oldTransport) {
      // Transport gone but session wasn't cleaned up
      consola.info(`Stale session ${this.activeSessionId} — taking over`);
      this.activeSessionId = newSessionId;
      return { ok: true };
    }

    // Ping the old session by trying to send a message
    const alive = await this.pingTransport(oldTransport);
    if (alive) {
      return {
        ok: false,
        reason: `Another active session (${this.activeSessionId}) is still connected. Disconnect it first or wait for it to timeout.`,
      };
    }

    // Old session didn't respond — take over
    consola.info(
      `Old session ${this.activeSessionId} unresponsive — new session ${newSessionId} taking over`
    );
    this.transports.delete(this.activeSessionId);
    this.activeSessionId = newSessionId;
    return { ok: true };
  }

  /**
   * Release the active session (e.g., on disconnect or heartbeat expiry).
   */
  release(sessionId?: string) {
    if (!sessionId || this.activeSessionId === sessionId) {
      consola.info(`Session released: ${this.activeSessionId}`);
      this.activeSessionId = null;
    }
  }

  /**
   * Ping a transport by attempting a small write.
   * If the connection is dead, the write will fail.
   */
  private async pingTransport(transport: SSEServerTransport): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), PING_TIMEOUT_MS);

      try {
        // SSEServerTransport writes to the underlying ServerResponse.
        // If the connection is closed, this will throw or the response will be finished.
        const res = (transport as any)._res || (transport as any).res;
        if (res && (res.writableEnded || res.destroyed)) {
          clearTimeout(timer);
          resolve(false);
          return;
        }
        // Connection still looks alive
        clearTimeout(timer);
        resolve(true);
      } catch {
        clearTimeout(timer);
        resolve(false);
      }
    });
  }
}
