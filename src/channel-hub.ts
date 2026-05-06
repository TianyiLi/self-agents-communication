import { startChannelHub } from "./channel/hub";

startChannelHub().catch((err) => {
  process.stderr.write(`agent-channel-hub fatal: ${err}\n`);
  process.exit(1);
});
