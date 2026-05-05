import type { ChannelMessage } from "../shared";

export type DriverKind = "claude" | "codex" | "cursor";

export interface DriverStatus {
  kind: DriverKind;
  state: "starting" | "ready" | "turn_active" | "stopping" | "stopped" | "failed";
  pid?: number;
  threadId?: string;
  lastError?: string;
}

export interface SessionDriver {
  start(): Promise<void>;
  send(messages: ChannelMessage[]): Promise<void>;
  interrupt(): Promise<void>;
  status(): Promise<DriverStatus>;
  stop(): Promise<void>;
}

