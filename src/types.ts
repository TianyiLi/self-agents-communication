export interface StreamMessage {
  id: string;
  from: string;
  from_name: string;
  type: "command" | "text" | "code" | "result" | "status" | "system";
  content: string;
  channel?: string;
  chat_id?: string;
  chat_type?: string;
  message_id?: string;
  must_reply?: "true" | "false";
  reply_to?: string;
  reply_to_content?: string;
  reply_to_from?: string;
  user_id?: string;
  username?: string;
  is_bot?: string;  // "true" | "false"
  media?: string;   // JSON array of media descriptors (for Phase 2 later)
  timestamp: string;
}

export interface AgentProfile {
  agent_id: string;
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  project: string;
  bot_username: string;
  mcp_port?: string;
}
