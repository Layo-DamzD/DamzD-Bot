// General commands — with the ORIGINAL DamzD v1.4.44 boxed megamenu,
// recovered from git history (commit 56d21ba) and ported onto the current
// runtime: .menu shows the section overview, .help the full list, both as
// ONE captioned message with the bot's own picture, .menu <section> and
// .help <command> open details. No FEI image, no chunked jampacked sends.
import { botImagePayload } from "../src/bot-image.js";

function messageTimestampMs(message) {
  const raw = message && message.messageTimestamp;
  const value = raw && typeof raw.toNumber === "function" ? raw.toNumber() : Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value > 1000000000000 ? value : value * 1000;
}

function ownerNumber(config) {
  const owners = Array.isArray(config.ownerNumbers) ? config.ownerNumbers : [];
  return String(owners[0] || "").replace(/\D/g, "");
}

// The menu boxes. DamzD's own look, drawn the same way the classic megabots
// draw theirs: a header block with the live version, mode, uptime and loaded
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
  Canvas: "🖼",
  Tools: "🛠",
  "Media & Tools": "🛠",
  Privacy: "🔒",
  "Chat & Privacy": "🔒",
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
  for (const command of commands || []) {
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
  return (commands || []).reduce((total, command) => total + 1 + (command.aliases?.length || 0), 0);
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

function menuHeader(commands, config) {
  return [
    BOX_TOP + "⚡ " + config.name + " 〕",
    BOX_LINE + "◇ " + mbold("VERSION") + ": " + (config.version || "1.0.0"),
    BOX_LINE + "◇ " + mbold("OWNER") + ": " + (config.ownerName || "the owner"),
    BOX_LINE + "◇ " + mbold("MODE") + ": " + String(config.defaultMode || "public").toUpperCase(),
    BOX_LINE + "◇ " + mbold("UPTIME") + ": " + uptimeText(),
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

function buildSection(commands, config, wanted) {
  const lower = String(wanted || "").trim().toLowerCase();
  const matches = new Map();
  for (const command of commands || []) {
    if (command.hidden) continue;
    if (String(command.category).toLowerCase() === lower) {
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

function buildCommandDetail(commands, config, wanted) {
  const lower = String(wanted || "").toLowerCase().replace(/^\./, "").trim();
  for (const command of commands || []) {
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

// The bot's picture and the menu text go out as ONE message — the picture
// with the text as its caption, the way the big menus deliver. A missing or
// broken picture never blocks the text: it degrades to a plain reply.
async function sendMenuWithImage(ctx, text) {
  const payload = botImagePayload(ctx.config);
  if (payload) {
    try {
      await ctx.send({ ...payload, caption: text });
      return;
    } catch { /* fall through to a plain reply */ }
  }
  await ctx.reply(text);
}

const commands = [
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
      await sendMenuWithImage(ctx, section || buildCategoryOverview(ctx.commands, ctx.config));
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
        await sendMenuWithImage(ctx, buildFullList(ctx.commands, ctx.config));
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
      const timestamp = messageTimestampMs(ctx.msg);
      const responseMs = timestamp === null ? null : Math.max(0, Date.now() - timestamp);
      await ctx.reply(
        BOX_TOP + "⚡ " + mbold("PING") + " 〕\n" +
        BOX_LINE + "› " + mbold("STATUS") + ": " + (ctx.connectionOpen ? "alive and answering 🟢" : "connecting 🟡") + "\n" +
        BOX_LINE + "› " + mbold("RESPONSE") + ": " + (responseMs === null ? "unavailable" : responseMs + " ms") + "\n" +
        BOX_LINE + "› " + mbold("UPTIME") + ": " + uptimeText() + "\n" +
        BOX_LINE + "› " + mbold("VERSION") + ": " + (ctx.config.version || "1.0.0") + "\n" +
        BOX_BOTTOM + "\n" + MENU_ENDING
      );
    }
  },
  {
    name: "alive",
    aliases: ["uptime"],
    category: "General",
    description: "show my status, mode and uptime",
    run: async ctx => {
      await ctx.reply(
        BOX_TOP + "✅ " + mbold("ALIVE") + " 〕\n" +
        BOX_LINE + "› " + mbold("STATUS") + ": " + (ctx.connectionOpen ? "online 🟢" : "connecting 🟡") + "\n" +
        BOX_LINE + "› " + mbold("MODE") + ": " + String(ctx.mode || "public").toUpperCase() + "\n" +
        BOX_LINE + "› " + mbold("UPTIME") + ": " + uptimeText() + "\n" +
        BOX_LINE + "› " + mbold("OWNER") + ": " + (ctx.config.ownerName || "the owner") + "\n" +
        BOX_BOTTOM + "\n" + MENU_ENDING
      );
    }
  },
  {
    name: "owner",
    category: "General",
    description: "Show DamzD owner details.",
    run: async ctx => {
      const number = ownerNumber(ctx.config);
      await ctx.reply(
        "👑 Owner: " + ctx.config.ownerName +
        (number ? "\n📱 Owner number: +" + number : "")
      );
    }
  },
  {
    name: "support",
    category: "General",
    description: "Show support guidance for DamzD.",
    run: async ctx => {
      await ctx.reply(
        "🛟 " + ctx.config.name + " Support\nFor setup help or bug reports, contact " +
        ctx.config.ownerName + ".\n\nGitHub: https://github.com/Layo-DamzD/DamzD-Bot"
      );
    }
  },
  {
    name: "time",
    category: "General",
    description: "Show the current server time in Nigeria.",
    run: async ctx => {
      const value = new Intl.DateTimeFormat("en-NG", {
        timeZone: "Africa/Lagos",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
      }).format(new Date());
      await ctx.reply("🕒 Nigeria time: " + value);
    }
  },
  {
    name: "date",
    category: "General",
    description: "Show the current date in Nigeria.",
    run: async ctx => {
      const value = new Intl.DateTimeFormat("en-NG", {
        timeZone: "Africa/Lagos",
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric"
      }).format(new Date());
      await ctx.reply("📅 Date in Nigeria: " + value);
    }
  },
  {
    name: "version",
    category: "General",
    description: "Show DamzD version and connection status.",
    run: async ctx => {
      await ctx.reply(
        "🤖 " + ctx.config.name + " v" + ctx.config.version +
        "\n🟢 Status: " + (ctx.connectionOpen ? "Online" : "Connecting") +
        "\n🔐 Mode: " + String(ctx.mode || "public").toUpperCase() +
        "\n📦 Baileys: official WhiskeySockets npm package"
      );
    }
  },
  {
    name: "jid",
    aliases: ["id"],
    category: "General",
    description: "Show the current chat and message sender IDs.",
    run: async ctx => {
      await ctx.reply(
        "💬 Chat ID: " + ctx.jid +
        "\n👤 Sender ID: " + (ctx.senderJid || "Unavailable")
      );
    }
  },
  {
    name: "whoami",
    category: "General",
    description: "Show your WhatsApp sender information.",
    run: async ctx => {
      await ctx.reply(
        "👤 Name: " + (ctx.msg?.pushName || "Unknown") +
        "\n🆔 Your ID: " + (ctx.senderJid || "Unavailable") +
        "\n👑 Owner: " + (ctx.owner ? "Yes" : "No")
      );
    }
  }
];

export default commands;
