import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PairingService } from "../../services/pairing";
import type { SessionManager } from "../session";

export function registerAgentPairTool(
  server: McpServer,
  pairing: PairingService,
  sessionManager: SessionManager
) {
  server.tool(
    "agent_pair",
    "Establish this MCP session as the active controller. " +
      "If already paired on Telegram, pass an empty string to resume the session. " +
      "If not yet paired, ask the user to send /start to the Telegram bot, then enter the 6-digit code here. " +
      "This should be the FIRST tool you call after connecting.",
    {
      code: z.string().describe(
        "The 6-digit pairing code from Telegram /start, or empty string to resume an existing pairing"
      ),
    },
    async ({ code }, extra) => {
      const sessionId = extra.sessionId ?? "";

      // Try to claim the active session slot
      const claim = await sessionManager.claimSession(sessionId);
      if (!claim.ok) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ status: "error", message: claim.reason }),
          }],
        };
      }

      // If code is empty, check if already paired on Telegram side
      if (!code) {
        const existingUser = await pairing.getPairedUser();
        if (existingUser) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                status: "paired",
                user_id: existingUser,
                message: "Session resumed. Already paired on Telegram.",
              }),
            }],
          };
        }
        // Not paired at all
        sessionManager.release(sessionId);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "error",
              message: "Not paired yet. Ask the user to send /start to the Telegram bot first.",
            }),
          }],
        };
      }

      // Verify the pairing code
      const userId = await pairing.verifyCode(code);
      if (!userId) {
        sessionManager.release(sessionId);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "error",
              message: "Invalid or expired pairing code. Ask the user to send /start again in Telegram.",
            }),
          }],
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "paired",
            user_id: userId,
            message: "Pairing successful. You can now receive Telegram messages and use all tools.",
          }),
        }],
      };
    }
  );
}
