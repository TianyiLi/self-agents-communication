import type { ClientConversation } from "@utils/stuff/types";

export default {
  name: "example",
  async execute({ conversation, ctx }) {
    ctx.reply("What is your name?");
    const { message } = await conversation.waitFor("message:text");
    ctx.reply(`Hello, ${message.text}!`);
  },
} satisfies ClientConversation;
