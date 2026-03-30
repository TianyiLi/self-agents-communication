import type { SessionManager } from "../session";

/**
 * Check that the calling session is the active paired session.
 * Returns null if OK, or a rejection response if not.
 */
export function guardSession(sessionId: string, sessionManager: SessionManager) {
  if (!sessionManager.isActiveSession(sessionId)) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          status: "error",
          message: "Not the active paired session. Call agent_pair first.",
        }),
      }],
    };
  }
  return null;
}
