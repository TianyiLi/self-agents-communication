import { createConversation } from "@grammyjs/conversations";
import { client } from "@src/index";
import type {
  ClientAction,
  ClientCommand,
  ClientConversation,
  Context,
} from "@utils/stuff/types";
import consola from "consola";

export const handleCommands = (commands: ClientCommand[]) => {
  for (const cmd of commands) {
    client.command(cmd.name, (ctx) => {
      cmd.execute({ ctx });
      consola.log(`${ctx.from?.username ?? ctx.from?.id} Used ${cmd.name}`);
    });
  }

  consola.ready(`Loaded ${commands.length} Commands`);
};

export const handleConversations = async (cons: ClientConversation[]) => {
  for (const con of cons) {
    client.use(
      createConversation<Context>(
        async (conversation, ctx) => {
          await con.execute({
            conversation,
            ctx,
          });
          return;
        },
        {
          id: con.name,
          // maxMillisecondsToWait: 60 * 1000,
        }
      )
    );
  }

  consola.ready(`Loaded ${cons.length} Conversations`);
};

export const handleActions = (actions: ClientAction[]) => {
  client.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;

    const action = actions.find((c) => {
      return data.startsWith(c.name.startswith);
    });

    consola.log(`${ctx.from?.username || ctx.from.id} used action: ${data}`);

    if (action) {
      action.execute({
        ctx,
        actionId: data,
      });
    }
  });
};
