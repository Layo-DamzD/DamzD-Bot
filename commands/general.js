function buildCategoryOverview(commands, prefix) {
  const categories = new Map();
  for (const command of commands) {
    if (command.hidden) continue;
    const list = categories.get(command.category) || [];
    list.push(command);
    categories.set(command.category, list);
  }
  const icons = {
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
  const lines = [
    "Here is everything I can do — " + commands.filter(command => !command.hidden).length +
    " commands in " + categories.size + " sections.",
    "",
    "Send " + prefix + "menu <section name> to open one, e.g. " + prefix + "menu news.",
    ""
  ];
  for (const [category, list] of categories.entries()) {
    lines.push((icons[category] || "•") + " *" + category + "* — " + list.length + " commands");
  }
  lines.push("");
  lines.push("Beyond commands: just talk to me in a normal message and I will reply like a person would.");
  lines.push("Send me a TikTok, YouTube, Instagram or Facebook link and I will fetch the media for you.");
  return lines.join("\n");
}

function buildFullList(commands, prefix) {
  const categories = new Map();
  for (const command of commands) {
    if (command.hidden) continue;
    const list = categories.get(command.category) || [];
    list.push(command);
    categories.set(command.category, list);
  }
  const icons = {
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
  const lines = [
    "*Everything I can do — " + commands.filter(command => !command.hidden).length + " commands*",
    ""
  ];
  for (const [category, list] of categories.entries()) {
    lines.push((icons[category] || "•") + " *" + category + "*");
    for (const command of list) {
      const aliases = (command.aliases || []).length
        ? " (or " + command.aliases.map(a => prefix + a).join(", ") + ")"
        : "";
      lines.push("  " + prefix + command.name + " — " + command.description + aliases);
    }
    lines.push("");
  }
  lines.push("And you can always just talk to me normally.");
  return lines.join("\n").trim();
}

function buildCommandDetail(commands, prefix, wanted) {
  const lower = String(wanted || "").toLowerCase().replace(/^\./, "").trim();
  const icons = {
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
  for (const command of commands) {
    if (command.hidden) continue;
    const names = [command.name, ...(command.aliases || [])];
    if (!names.includes(lower)) continue;
    const aliases = (command.aliases || []).length
      ? "\nAlso answers to: " + command.aliases.map(a => prefix + a).join(", ")
      : "";
    return (
      (icons[command.category] || "•") + " *" + prefix + command.name + "* — " + command.category + "\n" +
      command.description + aliases
    );
  }
  return null;
}

function buildSection(commands, prefix, wanted) {
  const lower = String(wanted || "").trim().toLowerCase();
  const icons = {
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
  const matches = new Map();
  for (const command of commands) {
    if (command.hidden) continue;
    if (command.category.toLowerCase() === lower) {
      matches.set(command.category, [...(matches.get(command.category) || []), command]);
    }
  }
  if (!matches.size) return null;
  const lines = [];
  for (const [category, list] of matches.entries()) {
    lines.push((icons[category] || "•") + " *" + category + "*");
    for (const command of list) {
      const aliases = (command.aliases || []).length ? " (or " + command.aliases.map(a => prefix + a).join(", ") + ")" : "";
      lines.push("  " + prefix + command.name + " — " + command.description + aliases);
    }
  }
  return lines.join("\n");
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
      const section = wanted ? buildSection(ctx.commands, ctx.config.prefix, wanted) : null;
      if (wanted && !section) {
        await ctx.reply(
          "I do not have a section called *" + wanted + "*. Send " + ctx.config.prefix + "menu to see the list of sections."
        );
        return;
      }
      await ctx.reply(section || buildCategoryOverview(ctx.commands, ctx.config.prefix));
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
        await ctx.reply(buildFullList(ctx.commands, ctx.config.prefix));
        return;
      }
      const detail = buildCommandDetail(ctx.commands, ctx.config.prefix, wanted);
      if (detail) {
        await ctx.reply(detail);
        return;
      }
      const section = buildSection(ctx.commands, ctx.config.prefix, wanted);
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
      await ctx.reply("I am here and running. Uptime so far: " + uptimeText() + ". 🟢");
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
