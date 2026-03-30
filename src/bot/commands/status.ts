import type { Context } from "grammy";
import type { AgentRegistry } from "../../services/agent-registry";
import { Config } from "../../../config/index";

export function createStatusCommand(registry: AgentRegistry) {
  return async (ctx: Context) => {
    const subs = await registry.getSubscriptions();
    const agents = await registry.listAgents(true);
    const otherAgents = agents.filter((a) => a.agent_id !== Config.agentId);

    let text = `<b>${Config.agentName}</b>\n`;
    text += `Role: ${Config.agentRole}\n`;
    text += `Status: Online\n\n`;

    if (subs.length > 0) {
      text += `Subscribed channels:\n`;
      text += subs.map((s) => `  - #${s}`).join("\n") + "\n\n";
    }

    if (otherAgents.length > 0) {
      text += `Other online agents:\n`;
      text += otherAgents
        .map(
          (a) => `  - ${a.name} (${a.role}) ${a.online ? "[online]" : "[offline]"}`
        )
        .join("\n");
    }

    await ctx.reply(text, { parse_mode: "HTML" });
  };
}
