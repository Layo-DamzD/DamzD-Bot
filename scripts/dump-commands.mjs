// Dump every registered command with its category, aliases and description, for any repo.
// Usage: node dump-commands.mjs <repoDir>
import { pathToFileURL } from "node:url";
import path from "node:path";

const repoDir = path.resolve(process.argv[2] || "/home/z/my-project/damzd");
const { loadCommands } = await import(
  pathToFileURL(path.join(repoDir, "handlers", "command-loader.js")).href
);

const { commands, lookup } = await loadCommands(path.join(repoDir, "commands"));
const byCat = new Map();
for (const c of commands) {
  if (!byCat.has(c.category)) byCat.set(c.category, []);
  byCat.get(c.category).push(c);
}
let n = 0;
for (const [cat, list] of [...byCat.entries()].sort()) {
  console.log("\n== " + cat.toUpperCase() + " (" + list.length + ") ==");
  for (const c of list.sort((a, b) => a.name.localeCompare(b.name))) {
    n++;
    const alias = (c.aliases || []).length ? " [" + c.aliases.join(", ") + "]" : "";
    console.log(c.name + alias + " — " + (c.description || "(no description)"));
  }
}
console.log("\nTOTAL command objects:", n);
console.log("TOTAL invokable names (incl. aliases):", lookup.size);
