// Dump every DamzD command into a readable text reference, with the API-key
// guide, saved to the project's download folder for the owner.
import { loadCommands } from "/home/z/my-project/damzd/handlers/command-loader.js";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";

const { commands } = await loadCommands("/home/z/my-project/damzd/commands");
const version = "v" + JSON.parse(readFileSync("/home/z/my-project/damzd/package.json", "utf8")).version;
const prefix = ".";

const categories = new Map();
for (const command of commands) {
  if (command.hidden) continue;
  const list = categories.get(command.category) || [];
  list.push(command);
  categories.set(command.category, list);
}

const lines = [];
lines.push("=".repeat(64));
lines.push("  DamzD — complete command list (" + version + ")");
lines.push("  Generated " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC");
lines.push("=".repeat(64));
lines.push("");
lines.push(commands.filter(c => !c.hidden).length + " commands in " + categories.size + " sections.");
lines.push("Every command starts with the prefix " + prefix + " — e.g. " + prefix + "ping");
lines.push("In chat you can also just talk to me normally — no command needed.");
lines.push("");

for (const [category, list] of categories.entries()) {
  lines.push("-".repeat(64));
  lines.push(category.toUpperCase() + "  (" + list.length + " commands)");
  lines.push("-".repeat(64));
  for (const command of list) {
    let entry = prefix + command.name;
    if ((command.aliases || []).length) entry += "  (also: " + command.aliases.map(a => prefix + a).join(", ") + ")";
    lines.push(entry);
    lines.push("    " + command.description);
  }
  lines.push("");
}

lines.push("=".repeat(64));
lines.push("  API KEYS — what you need and what is free");
lines.push("=".repeat(64));
lines.push(`
Most commands work with NO keys at all. Two free keys unlock everything:

1) GROQ_API_KEY  — free — https://console.groq.com/keys
   Powers: the AI brain (.ai/.gpt/... and natural chat) + voice-note
   transcription (.vv). Highest free limits, takes 2 minutes to get.
   Optional extras: GROQ_MODEL (default llama-3.3-70b-versatile).

2) NABEES_API_KEY  — free — https://apis.nabeestech.com  (key: nabeestech,
   about 100 requests/day)
   Powers: rescue route for .song/.play (real YouTube copies when the music
   library only has covers), .yt/.aio video downloads, backup AI models
   (GPT-5 Luna / DeepSeek when other AI services are quiet).

3) OPENROUTER_API_KEY  — optional free backup — https://openrouter.ai/keys
   Second AI fallback if Groq is ever down. Not required.

4) PHOTOROOM_API_KEY  — optional — https://photoroom.com/api
   Only for .removebg (background removal). Every other command works
   without it. Get the free key from PhotoRoom's dashboard.

Everything else (image generation, TTS, dictionary, weather, news, games,
stickers, canvas tools, YouTube search) uses free public services — no keys.
`);
lines.push("=".repeat(64));

const out = "/home/z/my-project/download/DamzD-Commands.txt";
mkdirSync("/home/z/my-project/download", { recursive: true });
writeFileSync(out, lines.join("\n") + "\n");
console.log("written: " + out + " (" + lines.join("\n").split("\n").length + " lines)");
