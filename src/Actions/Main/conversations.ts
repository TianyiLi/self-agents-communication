import type { ClientAction } from "@utils/stuff/types";

export default {
  name: {
    startswith: "conversations:", //? user conversations:[conversationId] in buttons to trigger conversation on click
  },
  execute({ actionId, ctx }) {
    const conId = actionId.split(":").slice(1).join(":");
    ctx.answerCallbackQuery();
    ctx.conversation.enter(conId);
  },
} satisfies ClientAction;
