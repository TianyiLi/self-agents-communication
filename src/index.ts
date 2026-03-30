import { Env } from "@config/index";
import {
  loadActions,
  loadCommands,
  loadConversations,
} from "@utils/client/loaders";
import type { Context } from "@utils/stuff/types";
import consola, { createConsola } from "consola";
import { Bot, session, type Middleware } from "grammy";
import { hydrate } from "@grammyjs/hydrate";
import { parseMode } from "@grammyjs/parse-mode";
import { emojiParser } from "@grammyjs/emoji";

const client = new Bot<Context>(Env.BotToken);

client.api.config.use(parseMode("Markdown"));

client.use(hydrate());
client.use(emojiParser());

client.use(
  session({
    type: "single",
    initial() {
      return { conversation: {} };
    },
  }) as Middleware<Context>
);

await loadConversations("./src/Conversations/**/*.ts");
await loadActions("./src/Actions/**/*.ts");
await loadCommands("./src/Commands/**/*.ts");

process.on("uncaughtException", consola.error);
process.on("unhandledRejection", consola.error);

export { client };

client.start({
  onStart(botInfo) {
    consola.ready(`Logged as https://t.me/${botInfo.username}`);
  },
  drop_pending_updates: true,
});

client.errorHandler = ({ message, error, ctx }) => {
  consola.error(error);
  ctx.reply(`Got an error try again later\\!\n\`\`\`\n${message}\`\`\``, {
    parse_mode: "MarkdownV2",
  });
};

/**
 * follow me on youtube/patreon/discord: @uoaio - github: @uo1428 - fiverr: @aryanali945
 */
