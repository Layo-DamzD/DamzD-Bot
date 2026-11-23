// Map every registered command name + alias to its file, category, description.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = "/home/z/my-project/damzd/commands";
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(d + "/" + e.name);
    else if (e.name.endsWith(".js")) files.push(d + "/" + e.name);
  }
})(dir);
files.sort();

const entries = [];
for (const f of files) {
  const mod = await import(pathToFileURL(f).href);
  const commands = mod.default;
  if (!Array.isArray(commands)) continue;
  for (const cmd of commands) {
    if (!cmd?.name) continue;
    entries.push({
      name: String(cmd.name).toLowerCase(),
      aliases: (cmd.aliases || []).map(a => String(a).toLowerCase()),
      category: cmd.category || "?",
      description: String(cmd.description || "").slice(0, 80),
      file: f.replace(dir + "/", ""),
      hidden: !!cmd.hidden
    });
  }
}

const lookupName = new Map();
for (const e of entries) {
  lookupName.set(e.name, e);
  for (const a of e.aliases) if (!lookupName.has(a)) lookupName.set(a, { ...e, viaAlias: true, name: e.name });
}

console.log("files:", files.length, "| command objects:", entries.length,
  "| names+aliases:", lookupName.size);

const user = process.argv.slice(2).map(s => s.toLowerCase().replace(/^\./, "").trim()).filter(Boolean);
for (const u of user) {
  const hit = lookupName.get(u);
  console.log(hit ? `✔ .${u} -> ${hit.name} (${hit.category}, ${hit.file}${hit.viaAlias ? ", alias" : ""}) — ${hit.description}`
                  : `✘ .${u} — NOT FOUND in registry`);
}
