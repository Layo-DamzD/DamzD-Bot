import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs";

export async function loadCommands(commandsDirectory) {
  const commands = [];
  const entries = fs.readdirSync(commandsDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const filePath = path.join(commandsDirectory, entry.name);
    try {
      const module = await import(pathToFileURL(filePath).href);
      const exported = module.default;
      const list = Array.isArray(exported) ? exported : [exported];
      for (const command of list) {
        if (command && typeof command.name === "string" && typeof command.run === "function") {
          commands.push({ category: "General", aliases: [], ...command });
        }
      }
    } catch (error) {
      console.error("[loader] failed to load " + entry.name + ":", error?.message);
    }
  }
  return commands;
}

export function buildLookup(commands) {
  const lookup = new Map();
  for (const command of commands) {
    lookup.set(command.name.toLowerCase(), command);
    for (const alias of command.aliases || []) {
      lookup.set(String(alias).toLowerCase(), command);
    }
  }
  return lookup;
}

export function resolveCommandInput(text, prefix) {
  const value = String(text || "").trim();
  if (!value.startsWith(prefix)) return null;
  const body = value.slice(prefix.length).trim();
  if (!body) return null;
  const [name, ...rest] = body.split(/\s+/);
  return {
    name: name.toLowerCase(),
    args: rest.join(" ").trim()
  };
}
