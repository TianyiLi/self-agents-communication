import type { Conversation, ConversationFlavor } from "@grammyjs/conversations";
import type { EmojiFlavor } from "@grammyjs/emoji";
import type { HydrateFlavor } from "@grammyjs/hydrate";
import type { Context as GrammyContext, SessionFlavor } from "grammy";

type Context = HydrateFlavor<GrammyContext> & ConversationFlavor & EmojiFlavor; //& SessionFlavor;

type ClientCommand = {
  name: string;
  description: string;
  execute: ({ ctx }: { ctx: Context }) => void;
};

type ClientConversation = {
  name: string;
  execute: ({
    conversation,
    ctx,
  }: {
    conversation: Conversation<Context>;
    ctx: Context;
  }) => unknown;
};

type ClientAction = {
  name: {
    startswith: string;
  };
  execute: ({}: { ctx: Context; actionId: string }) => unknown;
};
