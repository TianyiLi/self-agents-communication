import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PairingService } from "../../services/pairing";

export function registerAgentPairTool(server: McpServer, pairing: PairingService) {
  server.tool(
    "agent_pair",
    "Complete the pairing handshake by entering the 6-digit code from Telegram. " +
      "This should be the FIRST tool you call after connecting. Without pairing, " +
      "you cannot receive messages or interact with users. " +
      "Ask the user to send /start to the Telegram bot first, then enter the code they receive here.",
    { code: z.string().describe("The 6-digit numeric pairing code displayed in the Telegram /start message") },
    async ({ code }) => {
      const userId = await pairing.verifyCode(code);
      if (!userId) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "error",
              message: "Invalid or expired pairing code. Ask the user to send /start again in Telegram to get a fresh code.",
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
