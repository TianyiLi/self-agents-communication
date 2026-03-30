import { client } from "@src/index";
import type {
  ClientAction,
  ClientCommand,
  ClientConversation,
  Context,
} from "../stuff/types";
import { handleActions, handleCommands, handleConversations } from "./handlers";
import { conversations } from "@grammyjs/conversations";

export const ClientCommands: ClientCommand[] = [];
export const ClientConversations: ClientConversation[] = [];
export const ClientActions: ClientAction[] = [];

export const loadCommands = async (path: string) => {
  const glob = new Bun.Glob(path);

  for (const file of glob.scanSync({
    cwd: ".",
    absolute: true,
  })) {
    const { default: data } = await import(file);
    if (!data?.name) {
      console.debug(`Command error found in ${file}`);
      continue;
    }
    ClientCommands.push(data as ClientCommand);
  }

  handleCommands(ClientCommands);
};

export const loadConversations = async (path: string) => {
  client.use(conversations<Context>());

  const glob = new Bun.Glob(path);
  for (const file of glob.scanSync({
    cwd: ".",
    absolute: true,
  })) {
    const { default: data } = await import(file);
    if (!data?.name) {
      console.debug(`Conversation error found in ${file}`);
      continue;
    }
    ClientConversations.push(data as ClientConversation);
  }

  handleConversations(ClientConversations);
};

export const loadActions = async (path: string) => {
  client.use(conversations<Context>());

  const glob = new Bun.Glob(path);
  for (const file of glob.scanSync({
    cwd: ".",
    absolute: true,
  })) {
    const { default: data } = await import(file);
    if (!data?.name) {
      console.debug(`Action error found in ${file}`);
      continue;
    }
    ClientActions.push(data as ClientAction);
  }

  handleActions(ClientActions);
};
