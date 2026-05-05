import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RedisService } from "../../services/redis";
import { getMedia } from "../../services/media";
import type { SessionManager } from "../session";
import { guardSession } from "./guard";

const MAX_INLINE_BYTES = 2 * 1024 * 1024;

export function registerReadMediaTool(
  server: McpServer,
  redis: RedisService,
  sessionManager: SessionManager
) {
  server.tool(
    "read_media",
    "Read an inbound Telegram media attachment by media id from incoming message meta.media. Returns metadata and either UTF-8 text or base64 bytes, capped at 2MB inline.",
    {
      media_id: z.string().describe("Media id from the JSON array in incoming meta.media."),
      encoding: z.enum(["text", "base64"]).default("base64").describe(
        "Return file bytes as UTF-8 text or base64. Use text for text-like files, base64 for binary files."
      ),
    },
    async ({ media_id, encoding }, extra) => {
      const denied = guardSession(extra.sessionId ?? "", sessionManager);
      if (denied) return denied;

      const media = await getMedia(redis, media_id);
      if (!media) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ status: "error", message: "media not found or expired" }),
          }],
        };
      }

      const bytes = await readFile(media.path);
      if (bytes.byteLength > MAX_INLINE_BYTES) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "too_large",
              filename: media.filename,
              mime: media.mime,
              bytes: bytes.byteLength,
              path: media.path,
              message: "file exceeds 2MB inline cap; use the media HTTP endpoint or local path from this result",
            }),
          }],
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "ok",
            filename: media.filename,
            mime: media.mime,
            bytes: bytes.byteLength,
            path: media.path,
            encoding,
            data: encoding === "text" ? bytes.toString("utf8") : bytes.toString("base64"),
          }),
        }],
      };
    }
  );
}
