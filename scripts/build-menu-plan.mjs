#!/usr/bin/env node
// Builds the DamzD menu plan: walks the OLD v1.4.45 command files for their
// name/category pairs, intersects them with the commands that actually exist
// in the new FEI base, and emits src/damzd/menu-plan.js with the DamzD
// section order. Commands that exist but are not on the plan stay functional
// but are hidden from the menu (the files are never touched).
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadCommands } from "/home/z/my-project/damzd/handlers/command-loader.js";

const OLD_FILES = [
  "general", "ai", "ai-media" /* AI Media lived in media.js pre-split? see list */, "news", "downloads",
  "fun", "games", "group", "media", "owner", "privacy", "status", "tools", "channel"
].filter(f => f !== "ai-media");

// Old command files build entries three ways: direct objects ({ name: "x",
// category: "Y" }), objects where category precedes name, and factory
// functions (modelCommand("chatgpt", [...], ...) whose body carries the
// category). Parse all three.
function parseCommands(out) {
  const lines = out.split("\n");
  const found = [];

  // Factories: function NAME(param1, param2, ...) { ... category: "C" ... }
  const factories = {};
  for (let i = 0; i < lines.length; i += 1) {
    const def = lines[i].match(/function\s+(\w+)\s*\(\s*(\w+)\s*,\s*(\w+)/);
    if (!def) continue;
    for (let j = i; j < Math.min(i + 20, lines.length); j += 1) {
      const cat = lines[j].match(/category:\s*"([^"]+)"/);
      if (cat) { factories[def[1]] = cat[1]; break; }
      if (lines[j].includes("run:")) break;
    }
  }

  // Direct object entries, pairing name/category in either order and
  // resetting at object boundaries.
  let pendingName = null;
  let pendingCat = null;
  const flush = () => {
    if (pendingName && pendingCat) found.push({ name: pendingName, category: pendingCat });
    pendingName = null;
    pendingCat = null;
  };
  for (const line of lines) {
    if (/^\s*\},?\s*$/.test(line)) { flush(); continue; }
    const nm = line.match(/name:\s*"([^"]+)"/);
    if (nm) { if (pendingName) flush(); pendingName = nm[1].toLowerCase().trim(); }
    const cm = line.match(/category:\s*"([^"]+)"/);
    if (cm) {
      if (pendingName) { found.push({ name: pendingName, category: cm[1].trim() }); pendingName = null; }
      else pendingCat = cm[1].trim();
    }
  }
  flush();

  // Factory call sites: modelCommand("chatgpt", ...).
  for (const [factory, category] of Object.entries(factories)) {
    const re = new RegExp(factory + '\\(\\s*"([^"]+)"', "g");
    for (const m of out.matchAll(re)) {
      found.push({ name: m[1].toLowerCase().trim(), category });
    }
  }
  return found;
}

const pairs = [];
for (const file of OLD_FILES) {
  let out = "";
  try {
    out = execSync(`git show 5fe22fc:damzd/commands/${file}.js`, { encoding: "utf8", cwd: "/home/z/my-project" });
  } catch {
    continue;
  }
  const lines = out.split("\n");
  for (const entry of parseCommands(out)) {
    pairs.push(entry);
  }
}

const { commands, lookup } = await loadCommands(path.resolve("/home/z/my-project/damzd", "commands"));
// The menu displays command NAMES only — aliases (.song, .yt, .gg…) keep
// working but never appear as menu items, so the plan lists real names.
const realNames = new Set(commands.map(command => String(command.name).toLowerCase()));
const aliasNames = new Set([...lookup.keys()].filter(name => !realNames.has(name)));

// The five DamzD commands added on the FEI engine this release.
const DAMZD_ADDED = [
  { name: "ggs", category: "Tools" },
  { name: "vvinfo", category: "Tools" },
  { name: "onlineusers", category: "Group" },
  { name: "top", category: "Group" },
  { name: "ghost", category: "Group" }
];

const all = [...pairs, ...DAMZD_ADDED];
const SECTIONS = [
  { key: "General", title: "⚡ ɢᴇɴᴇʀᴀʟ" },
  { key: "AI & Chat", title: "🧠 ᴀɪ ᴄʜᴀᴛ" },
  { key: "AI Media", title: "🎨 ᴀɪ ᴍᴇᴅɪᴀ" },
  { key: "News", title: "📰 ɴᴇᴡs" },
  { key: "Downloads", title: "📥 ᴅᴏᴡɴʟᴏᴀᴅs" },
  { key: "Tools", title: "🛠️ ᴛᴏᴏʟs" },
  { key: "Fun", title: "🎉 ғᴜɴ" },
  { key: "Games", title: "🎮 ɢᴀᴍᴇs" },
  { key: "Group", title: "👥 ɢʀᴏᴜᴘ" },
  { key: "Privacy", title: "🔒 ᴘʀɪᴠᴀᴄʏ" },
  { key: "Status", title: "📱 sᴛᴀᴛᴜs" },
  { key: "Owner", title: "👑 ᴏᴡɴᴇʀ" }
];

const plan = [];
const seen = new Set();
const missing = [];
for (const section of SECTIONS) {
  const names = [];
  for (const entry of all) {
    if (entry.category !== section.key) continue;
    if (seen.has(entry.name)) continue;
    if (!realNames.has(entry.name)) {
      if (!aliasNames.has(entry.name) && !missing.some(m => m.name === entry.name)) {
        missing.push({ ...entry });
      }
      continue;
    }
    seen.add(entry.name);
    names.push(entry.name);
  }
  if (names.length) plan.push({ title: section.title, commandNames: names });
}

const listed = new Set(plan.flatMap(s => s.commandNames));
const hidden = [...lookup.keys()].filter(name => !listed.has(name));

const file = `// GENERATED by scripts/build-menu-plan.mjs — the DamzD command list.
// Sections follow the old DamzD menu layout; every command listed here
// exists and answers in the FEI base. Everything else in commands/ stays
// functional but is hidden from .menu by applyMenuPlan().
export const MENU_SECTIONS = ${JSON.stringify(plan, null, 2)};

// Apply the plan: commands outside the DamzD list are hidden from the menu
// (they keep working — their files are the base and are never deleted).
export function applyMenuPlan(commands) {
  const listed = new Set(MENU_SECTIONS.flatMap(section => section.commandNames));
  let hiddenCount = 0;
  for (const command of commands) {
    if (!listed.has(String(command.name).toLowerCase())) {
      command.hidden = true;
      hiddenCount += 1;
    }
  }
  return hiddenCount;
}
`;

fs.writeFileSync("/home/z/my-project/damzd/src/damzd/menu-plan.js", file);
console.log("sections:", plan.length);
console.log("listed commands:", listed.size);
console.log("hidden from menu:", hidden.length);
console.log("old commands with no engine here:", missing.length);
console.log("missing sample:", missing.slice(0, 14).map(m => m.name + "(" + m.category + ")").join(", "));
fs.writeFileSync("/tmp/menu-plan-missing.json", JSON.stringify(missing, null, 2));
