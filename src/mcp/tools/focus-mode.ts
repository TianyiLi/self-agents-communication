import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FocusService } from "../../services/focus";
import type { SessionManager } from "../session";
import { guardSession } from "./guard";

export function registerFocusModeTool(
  server: McpServer,
  focus: FocusService,
  sessionManager: SessionManager
) {
  server.tool(
    "focus_mode",
    "Enable, disable, or inspect focus mode. While focus mode is enabled, " +
      "Telegram user messages and inter-agent direct/channel messages are not " +
      "delivered to this agent; Telegram users are told the agent is focusing " +
      "and can use /force to interrupt.",
    {
      action: z.enum(["on", "off", "status"]).describe("Focus mode action to perform."),
      reason: z.string().optional().describe("Short reason shown in status responses."),
      duration_minutes: z.number().positive().max(24 * 60).optional().describe(
        "Optional auto-expiry in minutes. Maximum 1440."
      ),
    },
    async ({ action, reason, duration_minutes }, extra) => {
      const denied = guardSession(extra.sessionId ?? "", sessionManager);
      if (denied) return denied;

      if (action === "on") {
        const state = await focus.enable(reason, duration_minutes);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ status: "focus_on", focus: state }),
          }],
        };
      }

      if (action === "off") {
        await focus.disable();
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ status: "focus_off" }),
          }],
        };
      }

      const state = await focus.get();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: state ? "focus_on" : "focus_off",
            focus: state,
          }),
        }],
      };
    }
  );
}
