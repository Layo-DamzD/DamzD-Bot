import "dotenv/config";
import { runLocalTerminal } from "./local.js";

runLocalTerminal().catch(error => {
  console.error("DamzD startup failed:", error && (error.stack || error.message) || error);
  process.exitCode = 1;
});
