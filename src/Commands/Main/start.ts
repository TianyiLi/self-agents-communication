import { Env } from "@config/index";
import type { ClientCommand } from "@utils/stuff/types";
import { InlineKeyboard, Keyboard } from "grammy";

export default {
  name: "start",
  description: "Lets get started",
  async execute({ ctx }) {
    const menu = new InlineKeyboard().text(
      "⭐ Start Here! ⭐",
      "conversations:example"
    );

    ctx.reply("Please, Click below", {
      reply_markup: menu,
    });
  },
} satisfies ClientCommand;
