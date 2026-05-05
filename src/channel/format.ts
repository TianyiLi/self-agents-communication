import type { ChannelMessage } from "./shared";

export function buildChannelNotification(messages: ChannelMessage[]) {
  if (messages.length === 1) {
    const message = messages[0];
    const { stream, ...meta } = message.meta;
    return {
      content: message.content,
      meta,
    };
  }

  return {
    content: JSON.stringify({
      messages: messages.map((message) => ({
        id: message.id,
        source: message.source,
        stream: message.stream,
        content: message.content,
        meta: message.meta,
      })),
    }, null, 2),
    meta: {
      source: "batch",
      type: "batch",
      count: String(messages.length),
      must_reply: messages.some((message) => message.meta.must_reply === "true") ? "true" : "false",
      sources: [...new Set(messages.map((message) => message.source))].join(","),
    },
  };
}

export function formatChannelBatchForTurn(messages: ChannelMessage[]) {
  const requiresReply = messages.some((message) => message.meta.must_reply === "true");
  const lines = [
    `You received a batch of ${messages.length} agent-channel message${messages.length === 1 ? "" : "s"}.`,
    requiresReply
      ? `At least one message has must_reply=true. You must respond using agent-comm tools.`
      : `All messages have must_reply=false. Respond only if relevant to your role.`,
    "",
  ];

  messages.forEach((message, index) => {
    lines.push(
      `Message ${index + 1}`,
      `- id: ${message.id}`,
      `- source: ${message.source}`,
      `- stream: ${message.stream}`,
      `- from: ${message.meta.from || ""}`,
      `- from_name: ${message.meta.from_name || ""}`,
      `- type: ${message.meta.type || ""}`,
      `- must_reply: ${message.meta.must_reply || "false"}`,
      `- chat_id: ${message.meta.chat_id || ""}`,
      `- message_id: ${message.meta.message_id || ""}`,
      `- is_bot: ${message.meta.is_bot || "false"}`,
      `- media_paths: ${message.meta.media_paths || ""}`,
      "",
      "Content:",
      message.content,
      ""
    );
  });

  return lines.join("\n").trimEnd();
}

