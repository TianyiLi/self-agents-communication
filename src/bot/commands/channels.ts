import type { Context } from "grammy";
import type { AgentRegistry } from "../../services/agent-registry";

export function createChannelsCommand(registry: AgentRegistry) {
  return async (ctx: Context) => {
    const subs = await registry.getSubscriptions();
    if (subs.length === 0) {
      await ctx.reply("No channel subscriptions.");
      return;
    }
    const text =
      `Subscribed channels:\n` + subs.map((s) => `  - #${s}`).join("\n");
    await ctx.reply(text);
  };
}
