// Compare the pasted v1.4.45 menu with the repo's registered commands.
// Usage: node merge-diff.mjs <repoDir>
import { pathToFileURL } from "node:url";
import path from "node:path";
import { PASTED_MENU } from "./pasted-menu.mjs";

const repoDir = path.resolve(process.argv[2] || "/home/z/my-project/damzd");
const { loadCommands } = await import(
  pathToFileURL(path.join(repoDir, "handlers", "command-loader.js")).href
);
const { commands, lookup } = await loadCommands(path.join(repoDir, "commands"));

const names = new Set(commands.map(c => c.name.toLowerCase()));
const aliases = new Set();
for (const c of commands) for (const a of c.aliases) aliases.add(a.toLowerCase());
const everything = new Set([...names, ...aliases]);

const missing = [];      // in pasted menu, not in repo at all
const aliasOnly = [];    // invokable but only as an alias (menu shows another name)
const covered = [];      // exact primary-name match
for (const [section, list] of Object.entries(PASTED_MENU)) {
  for (const raw of list) {
    const name = raw.toLowerCase();
    if (names.has(name)) covered.push(`${section}:${raw}`);
    else if (aliases.has(name)) aliasOnly.push(`${section}:${raw} (alias of ${lookup.get(name)?.name})`);
    else missing.push(`${section}:${raw}`);
  }
}

// repo primaries not shown in the pasted menu (ours + the hidden base)
const pastedNames = new Set(Object.values(PASTED_MENU).flat().map(v => v.toLowerCase()));
const oursExtra = commands
  .filter(c => !pastedNames.has(c.name.toLowerCase()))
  .map(c => `${c.category}:${c.name}`);

console.log("== MISSING from repo (must implement):", missing.length, "==");
console.log(missing.join("\n"));
console.log("\n== Alias-only in repo (menu shows another name):", aliasOnly.length, "==");
console.log(aliasOnly.join("\n"));
console.log("\n== Exact primary-name match:", covered.length, "==");
console.log("\n== Repo primaries NOT in pasted menu (ours, keep + show):", oursExtra.length, "==");
console.log(oursExtra.join("\n"));
console.log("\nRepo: " + commands.length + " objects / " + lookup.size + " invokable names. Pasted menu: " +
  [...pastedNames].length + " names.");
