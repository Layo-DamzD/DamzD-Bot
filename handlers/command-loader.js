import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function findCommandFiles(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findCommandFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(fullPath);
  }
  return files.sort();
}

export function resolveCommandInput(body, lookup) {
  const source = String(body || "").trim();
  if (!source || !(lookup instanceof Map) || lookup.size === 0) return null;

  const tokens = [...source.matchAll(/\S+/g)];
  const maxWords = Math.min(
    tokens.length,
    Math.max(1, ...Array.from(lookup.keys(), value => String(value).trim().split(/\s+/).length))
  );

  for (let wordCount = maxWords; wordCount > 0; wordCount -= 1) {
    const candidate = tokens
      .slice(0, wordCount)
      .map(token => token[0])
      .join(" ")
      .toLowerCase()
      .replace(/\.$/, "");
    const definition = lookup.get(candidate);
    if (!definition) continue;

    const args = wordCount < tokens.length
      ? source.slice(tokens[wordCount].index).trim()
      : "";
    return { commandName: candidate, args, definition };
  }

  return null;
}

export async function loadCommands(directory = path.resolve(process.cwd(), "commands")) {
  const files = await findCommandFiles(directory);
  const commands = [];
  const lookup = new Map();

  for (const file of files) {
    const module = await import(pathToFileURL(file).href);
    const exported = module.default;
    const entries = Array.isArray(exported) ? exported : [exported];

    for (const command of entries) {
      if (!command || typeof command.name !== "string" || typeof command.run !== "function") {
        throw new Error("Invalid command export in " + path.relative(process.cwd(), file));
      }

      const normalized = {
        ...command,
        name: command.name.toLowerCase().trim(),
        category: String(command.category || "").trim(),
        aliases: (command.aliases || []).map(alias =>
          String(alias).toLowerCase().trim().replace(/\s+/g, " ")
        )
      };

      if (!normalized.name || !normalized.category) {
        throw new Error("Every command needs a name and category: " + file);
      }

      for (const name of [normalized.name, ...normalized.aliases]) {
        if (!name || /[\r\n\t]/.test(name) || (name === normalized.name && /\s/.test(name))) {
          throw new Error("Invalid command name in " + file);
        }
        if (lookup.has(name)) throw new Error("Duplicate command or alias: " + name);
        lookup.set(name, normalized);
      }
      commands.push(normalized);
    }
  }

  return { commands, lookup };
}
