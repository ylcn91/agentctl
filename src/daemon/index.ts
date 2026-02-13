import { startDaemon, stopDaemon } from "./server";

const { server } = startDaemon();

process.on("SIGINT", () => { stopDaemon(server); process.exit(0); });
process.on("SIGTERM", () => { stopDaemon(server); process.exit(0); });

console.log("Claude Hub daemon started");
