import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

import { config } from "./src/config.js";
import { ChatMemory } from "./src/memory.js";
import { JsonStore } from "./src/store.js";
import { loadCommands, buildLookup } from "./src/loader.js";
import { DamzDBot } from "./src/runtime.js";
import { startHealthServer } from "./src/health.js";
import { initActivityStore } from "./src/cache.js";
import { SessionManager } from "./src/sessions.js";

const directory = path.dirname(fileURLToPath(import.meta.url));

// Child mode: this process IS one extra connected WhatsApp (spawned by the
// session manager). It runs the exact same bot with its own env — own auth,
// own data, own owner — and reports state through a status file instead of a
// second dashboard server.
const childMode = process.env.DAMZD_CHILD === "1";

async function main() {
  if (!config.ownerNumbers.length) {
    console.log("[" + config.name + "] No OWNER_NUMBER set — the number that pairs first becomes the owner automatically.");
  }

  for (const folder of [config.sessionDirectory, config.dataDirectory]) {
    fs.mkdirSync(path.resolve(folder), { recursive: true });
  }

  // Persistent group-activity store — .ghost/.top/.onlineusers survive restarts.
  initActivityStore(path.resolve(config.dataDirectory));

  const commands = await loadCommands(path.join(directory, "commands"));
  const lookup = buildLookup(commands);
  const memory = new ChatMemory(path.resolve(config.dataDirectory));
  const store = new JsonStore(path.resolve(config.dataDirectory), "settings.json");

  const bot = new DamzDBot({ commands, lookup, memory, store });

  if (childMode) {
    const statusFile = process.env.DAMZD_STATUS_FILE;
    const writeStatus = () => {
      try {
        fs.writeFileSync(statusFile, JSON.stringify({
          ...bot.status(),
          sessionNumber: config.ownerNumbers[0] || "",
          writtenAt: Date.now()
        }));
      } catch { /* the parent treats a missing file as "starting" */ }
    };
    writeStatus();
    setInterval(writeStatus, 3000);
    console.log("[" + config.name + "] child session for +" + (config.ownerNumbers[0] || "?") + " starting with " + commands.length + " commands, access mode: " + config.accessMode);
  } else {
    const sessions = new SessionManager({
      dataDirectory: path.resolve(config.dataDirectory),
      entryPath: path.join(directory, "index.js"),
      maxSessions: Number(process.env.MAX_SESSIONS || 5) || 5
    });
    sessions.load();
    bot.sessions = sessions; // .ban/.unban can stop or revive a connected friend's bot from chat
    startHealthServer(bot, config.port, sessions);
    // Render stops deploys with SIGTERM — take the children down cleanly too.
    process.on("SIGTERM", () => {
      sessions.stopAll();
      process.exit(0);
    });
    console.log("[" + config.name + "] starting with " + commands.length + " commands, access mode: " + config.accessMode);
  }

  await bot.start();
}

main().catch(error => {
  console.error("Fatal:", error?.message || error);
  process.exit(1);
});
