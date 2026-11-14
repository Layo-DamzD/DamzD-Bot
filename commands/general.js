import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_VERSION = (() => {
  try { return String(JSON.parse(fs.readFileSync(path.join(here, "../package.json"), "utf8")).version); }
  catch { return "dev"; }
})();

// The menu boxes. DamzD's own look, drawn the same way the classic megabots
// draw theirs: a header block with the live version, prefix and loaded
// command count, then one box per section, then the brand line.
const BOX_TOP = "╭──〔 ";
const BOX_LINE = "│  ";
const BOX_BOTTOM = "╰────────────────";
const MENU_ENDING = "✦ " + mbold("POWERED BY GREAT DAMZD");

const ICONS = {
  General: "🤖",
  "AI & Chat": "💬",
  "AI Media": "🎨",
  News: "📰",
  Downloads: "📥",
  Games: "🎮",
  Fun: "🎉",
  Group: "👥",
  Canvas: "🖼",
  Tools: "🛠",
  Privacy: "🔒",
  Status: "📱",
  Channel: "📢",
  Owner: "👑"
};

// Mathematical Sans-Serif Bold — 𝗹𝗶𝗸𝗲 𝘁𝗵𝗶𝘀. Plain punctuation (spaces,
// dots, dashes, &) passes through untouched.
function mbold(text) {
  return String(text).split("").map(ch => {
    const code = ch.codePointAt(0);
    if (code >= 65 && code <= 90) return String.fromCodePoint(0x1d5d4 + code - 65);
    if (code >= 97 && code <= 122) return String.fromCodePoint(0x1d5ee + code - 97);
    if (code >= 48 && code <= 57) return String.fromCodePoint(0x1d7ec + code - 48);
    return ch;
  }).join("");
}

function capitalize(text) {
  return String(text || "").charAt(0).toUpperCase() + String(text || "").slice(1);
}

function groupedCategories(commands) {
  const categories = new Map();
  for (const command of commands) {
    if (command.hidden) continue;
    const list = categories.get(command.category) || [];
    list.push(command);
    categories.set(command.category, list);
  }
  return categories;
}

function sectionTitle(category) {
  return BOX_TOP + (ICONS[category] || "•") + " " + mbold(String(category).toUpperCase()) + " 〕";
}

// Everything registered, aliases included — that is what "loaded" means here.
function loadedCount(commands) {
  return commands.reduce((total, command) => total + 1 + (command.aliases?.length || 0), 0);
}

function menuHeader(commands, config) {
  return [
    BOX_TOP + config.name + " 〕",
    BOX_LINE + "◇ " + mbold("VERSION") + ": " + APP_VERSION,
    BOX_LINE + "◇ " + mbold("COMMANDS LOADED") + ": " + loadedCount(commands),
    "│"
  ].join("\n");
}

function buildCategoryOverview(commands, config) {
  const categories = groupedCategories(commands);
  const lines = [menuHeader(commands, config)];
  lines.push(BOX_TOP + "⌂ " + mbold("SECTIONS") + " 〕");
  for (const [category, list] of categories.entries()) {
    lines.push(BOX_LINE + "› " + (ICONS[category] || "•") + " " +
      mbold(String(category).toUpperCase()) + " — " + list.length +
      (list.length === 1 ? " command" : " commands"));
  }
  lines.push(
    BOX_BOTTOM,
    "",
    "Send " + config.prefix + "menu <section> to open one — e.g. " + config.prefix + "menu news.",
    "Beyond commands: just talk to me in a normal message and I will reply like a person would.",
    "Send me a TikTok, YouTube, Instagram or Facebook link and I will fetch the media for you."
  );
  return lines.join("\n") + "\n\n" + MENU_ENDING;
}

function buildFullList(commands, config) {
  const boxes = [menuHeader(commands, config)];
  for (const [category, list] of groupedCategories(commands).entries()) {
    boxes.push(sectionTitle(category));
    for (const command of list) {
      boxes.push(BOX_LINE + "› " + config.prefix + command.name + " — " + capitalize(command.description));
    }
    boxes.push(BOX_BOTTOM);
  }
  boxes.push("", "And you can always just talk to me normally.", "", MENU_ENDING);
  return boxes.join("\n");
}

function buildCommandDetail(commands, config, wanted) {
  const lower = String(wanted || "").toLowerCase().replace(/^\./, "").trim();
  for (const command of commands) {
    if (command.hidden) continue;
    const names = [command.name, ...(command.aliases || [])];
    if (!names.includes(lower)) continue;
    const lines = [
      BOX_TOP + (ICONS[command.category] || "•") + " " + config.prefix + mbold(command.name.toUpperCase()) + " 〕",
      BOX_LINE + "› " + capitalize(command.description),
      BOX_LINE + "› " + mbold("CATEGORY") + ": " + command.category
    ];
    if ((command.aliases || []).length) {
      lines.push(BOX_LINE + "› " + mbold("ALSO") + ": " + command.aliases.map(a => config.prefix + a).join(", "));
    }
    lines.push(BOX_BOTTOM);
    return lines.join("\n");
  }
  return null;
}

function buildSection(commands, config, wanted) {
  const lower = String(wanted || "").trim().toLowerCase();
  const matches = new Map();
  for (const command of commands) {
    if (command.hidden) continue;
    if (command.category.toLowerCase() === lower) {
      matches.set(command.category, [...(matches.get(command.category) || []), command]);
    }
  }
  if (!matches.size) return null;
  const boxes = [];
  for (const [category, list] of matches.entries()) {
    boxes.push(sectionTitle(category));
    for (const command of list) {
      boxes.push(BOX_LINE + "› " + config.prefix + command.name + " — " + capitalize(command.description));
    }
    boxes.push(BOX_BOTTOM);
  }
  return boxes.join("\n") + "\n\n" + MENU_ENDING;
}

function lagosTime() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(new Date());
}

function lagosDate() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(new Date());
}

function ownerVCard(config) {
  const number = String(config.ownerNumbers[0] || "");
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:" + config.ownerName,
    "TEL;type=CELL;type=VOICE;waid=" + number + ":+" + number,
    "NOTE:Owner of the " + config.name + " assistant",
    "END:VCARD"
  ].join("\n");
}

function uptimeText() {
  const seconds = Math.floor(process.uptime());
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(days + "d");
  if (hours) parts.push(hours + "h");
  parts.push(minutes + "m");
  return parts.join(" ");
}

export default [
  {
    name: "menu",
    aliases: ["sections"],
    category: "General",
    description: "show my sections at a glance",
    run: async ctx => {
      const wanted = String(ctx.args || "").trim();
      const section = wanted ? buildSection(ctx.commands, ctx.config, wanted) : null;
      if (wanted && !section) {
        await ctx.reply(
          "I do not have a section called *" + wanted + "*. Send " + ctx.config.prefix + "menu to see the list of sections."
        );
        return;
      }
      await ctx.reply(section || buildCategoryOverview(ctx.commands, ctx.config));
    }
  },
  {
    name: "help",
    aliases: ["commands", "allcommands", "cmds"],
    category: "General",
    description: "the full list of every command and what it does",
    run: async ctx => {
      const wanted = String(ctx.args || "").trim();
      if (!wanted) {
        await ctx.reply(buildFullList(ctx.commands, ctx.config));
        return;
      }
      const detail = buildCommandDetail(ctx.commands, ctx.config, wanted);
      if (detail) {
        await ctx.reply(detail);
        return;
      }
      const section = buildSection(ctx.commands, ctx.config, wanted);
      if (section) {
        await ctx.reply(section);
        return;
      }
      await ctx.reply(
        "I do not know *" + wanted + "*. Send " + ctx.config.prefix + "help for everything I understand."
      );
    }
  },
  {
    name: "ping",
    category: "General",
    description: "check that I am online",
    run: async ctx => {
      await ctx.reply(
        BOX_TOP + "⚡ " + mbold("PING") + " 〕\n" +
        BOX_LINE + "› " + mbold("STATUS") + ": alive and answering 🟢\n" +
        BOX_LINE + "› " + mbold("UPTIME") + ": " + uptimeText() + "\n" +
        BOX_LINE + "› " + mbold("VERSION") + ": " + APP_VERSION + "\n" +
        BOX_BOTTOM + "\n" + MENU_ENDING
      );
    }
  },
  {
    name: "alive",
    aliases: ["uptime"],
    category: "General",
    description: "my status card",
    run: async ctx => {
      await ctx.reply(
        "🤖 *" + ctx.config.name + "* is online\n" +
        "⏱ Uptime: " + uptimeText() + "\n" +
        "📚 Commands: " + (ctx.commands?.length || 0) + "\n" +
        "🔐 Mode: " + ctx.config.accessMode + "\n" +
        "⏰ My time: " + lagosTime() + " (WAT)"
      );
    }
  },
  {
    name: "about",
    category: "General",
    description: "who I am",
    run: async ctx => {
      await ctx.reply(
        "I am " + ctx.config.name + ", " + ctx.config.ownerName + "'s personal assistant on WhatsApp. " +
        "Ask me things, send me links, or just talk — I keep up."
      );
    }
  },
  {
    name: "owner",
    category: "General",
    description: "show my owner's details",
    run: async ctx => {
      await ctx.reply(
        "👑 *" + ctx.config.ownerName + "* is my owner.\n" +
        "I was set up for personal use, so I keep things quiet and clean."
      );
    }
  },
  {
    name: "support",
    category: "General",
    description: "how to get help with me",
    run: async ctx => {
      await ctx.reply(
        "If something misbehaves, tell " + ctx.config.ownerName + " directly — I belong to them. " +
        "You can also send " + ctx.config.prefix + "menu to see what I understand."
      );
    }
  },
  {
    name: "channel",
    category: "General",
    description: "info about this assistant",
    run: async ctx => {
      await ctx.reply(
        ctx.config.name + " is a private assistant — there is no public channel to follow. " +
        "Everything I do happens right here in your chats."
      );
    }
  },
  {
    name: "channeljid",
    category: "General",
    description: "get the JID of this chat or a channel link",
    run: async ctx => {
      const arg = String(ctx.args || "").trim();
      if (arg) {
        const code = arg.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/)?.[1]
          || arg.match(/@newsletter/ ? arg : "")
          || arg;
        await ctx.reply(
          "Channel invite code: *" + code + "*\n" +
          "Tip: open the channel here and send " + ctx.config.prefix + "channeljid again without a link — I will read the JID from the chat itself."
        );
        return;
      }
      await ctx.reply("This chat's JID: `" + ctx.jid + "`");
    }
  },
  {
    name: "vcf",
    aliases: ["contactgain"],
    category: "General",
    description: "save my owner's contact card",
    run: async ctx => {
      await ctx.send({
        contacts: {
          displayName: ctx.config.ownerName,
          contacts: [{ vcard: ownerVCard(ctx.config) }]
        }
      });
    }
  },
  {
    name: "gitclone",
    category: "General",
    description: "where my source code lives",
    run: async ctx => {
      await ctx.reply("My code lives here: https://github.com/Layo-DamzD/DamzD-Bot");
    }
  },
  {
    name: "time",
    category: "General",
    description: "my owner's local time",
    run: async ctx => {
      await ctx.reply("It is *" + lagosTime() + "* right now (WAT).");
    }
  },
  {
    name: "date",
    category: "General",
    description: "today's date",
    run: async ctx => {
      await ctx.reply("Today is *" + lagosDate() + "*.");
    }
  },
  {
    name: "version",
    category: "General",
    description: "my version and status",
    run: async ctx => {
      await ctx.reply(
        "📦 " + ctx.config.name + " v1.1.0\n" +
        "Status: online, " + (ctx.commands?.length || 0) + " commands loaded\n" +
        "Uptime: " + uptimeText()
      );
    }
  },
  {
    name: "jid",
    aliases: ["id"],
    category: "General",
    description: "show chat and sender IDs",
    run: async ctx => {
      await ctx.reply(
        "Chat JID: `" + ctx.jid + "`\n" +
        "Sender: `" + ctx.sender + "`"
      );
    }
  },
  {
    name: "whoami",
    category: "General",
    description: "your sender information",
    run: async ctx => {
      await ctx.reply(
        "You are @" + ctx.senderNumber + (ctx.pushName ? " (" + ctx.pushName + ")" : "") + ".\n" +
        "Chat: " + (ctx.isGroup ? "a group" : "a private chat"),
        { mentions: [ctx.sender] }
      );
    }
  }
];
