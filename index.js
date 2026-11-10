import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

import { config } from "./src/config.js";
import { ChatMemory } from "./src/memory.js";
import { JsonStore } from "./src/store.js";
import { loadCommands, buildLookup } from "./src/loader.js";
import { DamzDBot } from "./src/runtime.js";
import { startHealthServer } from "./src/health.js";

const directory = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  if (!config.ownerNumbers.length) {
    console.log("[" + config.name + "] No OWNER_NUMBER set — the number that pairs first becomes the owner automatically.");
  }

  for (const folder of [config.sessionDirectory, config.dataDirectory]) {
    fs.mkdirSync(path.resolve(folder), { recursive: true });
  }

  const commands = await loadCommands(path.join(directory, "commands"));
  const lookup = buildLookup(commands);
  const memory = new ChatMemory(path.resolve(config.dataDirectory));
  const store = new JsonStore(path.resolve(config.dataDirectory), "settings.json");

  const bot = new DamzDBot({ commands, lookup, memory, store });
  startHealthServer(bot, config.port);

  console.log("[" + config.name + "] starting with " + commands.length + " commands, access mode: " + config.accessMode);
  await bot.start();
}

main().catch(error => {
  console.error("Fatal:", error?.message || error);
  process.exit(1);
});
