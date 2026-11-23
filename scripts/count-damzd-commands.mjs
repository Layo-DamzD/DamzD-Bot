import { loadCommands, buildLookup } from "/home/z/my-project/download/damzd-bot/src/loader.js";

const commands = await loadCommands("/home/z/my-project/download/damzd-bot/commands");
const lookup = buildLookup(commands);

console.log("standalone commands:", commands.length);
console.log("reachable names (commands + aliases):", lookup.size);

const byCat = {};
for (const c of commands) {
  byCat[c.category] = byCat[c.category] || { count: 0, names: [] };
  byCat[c.category].count += 1;
  byCat[c.category].names.push(c.name + (c.aliases?.length ? " [" + c.aliases.join(", ") + "]" : ""));
}
for (const [cat, info] of Object.entries(byCat)) {
  console.log("\n== " + cat + " (" + info.count + ") ==");
  console.log(info.names.join(", "));
}
