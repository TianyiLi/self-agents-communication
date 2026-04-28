import type { Context, NextFunction } from "grammy";
import type { PairingService } from "../../services/pairing";
import type { AllowedChatsService } from "../../services/allowed-chats";
import type { BlockedUsersService } from "../../services/blocked-users";

// Access policy:
//   - /start always passes (bootstraps pairing).
//   - Pairing must exist; otherwise nothing else gets through.
//   - Blocked users are dropped everywhere.
//   - DM (private chat): paired-user-only — protects the bot from random DMs.
//   - Group / supergroup: must be in allowlist; any non-blocked member can
//     talk to the bot. Paired user is responsible for /allow_here'ing the
//     group, which is the act of consent that opens it up to everyone.
export function createPairingMiddleware(
  pairing: PairingService,
  allowedChats: AllowedChatsService,
  blockedUsers: BlockedUsersService,
) {
  return async (ctx: Context, next: NextFunction) => {
    if (ctx.message?.text?.startsWith("/start")) return next();

    const pairedUser = await pairing.getPairedUser();
    if (!pairedUser) return;

    const fromId = ctx.from?.id.toString();
    if (!fromId) return;

    if (await blockedUsers.isBlocked(fromId)) return;

    const chatType = ctx.chat?.type;
    if (chatType === "private") {
      if (fromId !== pairedUser) return;
      return next();
    }

    if (chatType === "group" || chatType === "supergroup") {
      if (!(await allowedChats.isAllowed(ctx.chat!.id.toString()))) return;
      return next();
    }
  };
}
