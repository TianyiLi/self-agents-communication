import type { Context, NextFunction } from "grammy";
import type { PairingService } from "../../services/pairing";

export function createPairingMiddleware(pairing: PairingService) {
  return async (ctx: Context, next: NextFunction) => {
    // Always allow /start (triggers pairing flow)
    if (ctx.message?.text?.startsWith("/start")) return next();

    // Check if paired
    const pairedUser = await pairing.getPairedUser();
    if (!pairedUser) return; // Not paired yet, ignore all
    if (ctx.from?.id.toString() !== pairedUser) return; // Wrong user, ignore

    await next();
  };
}
