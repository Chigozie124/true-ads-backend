import { autoReleaseEscrow } from "./escrow.routes.js";

setInterval(async () => {
  console.log("Running escrow cron...");
  await autoReleaseEscrow();
}, 5 * 60 * 1000);
