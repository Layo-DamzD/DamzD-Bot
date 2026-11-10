function buildMenuText(commands, prefix) {
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
    Downloads: "📥",
    Games: "🎲",
    Group: "👥",
    Owner: "👑"
  };
  const lines = ["Here is everything I can do. Send any command with the prefix \"" + prefix + "\".", ""];
  for (const [category, list] of categories.entries()) {
    lines.push((icons[category] || "•") + " *" + category + "*");
    for (const command of list) {
      const aliases = (command.aliases || []).length ? " (or " + command.aliases.map(a => prefix + a).join(", ") + ")" : "";
      lines.push("  " + prefix + command.name + " — " + command.description + aliases);
    }
    lines.push("");
  }
  lines.push("Beyond commands: just talk to me in a normal message and I will reply like a person would.");
  lines.push("Send me a TikTok, YouTube, Instagram or Facebook link and I will fetch the media for you.");
  return lines.join("\n");
}

export default [
  {
    name: "menu",
    aliases: ["help", "commands"],
    category: "General",
    description: "show everything I can do",
    run: async ctx => {
      await ctx.reply(buildMenuText(ctx.commands, ctx.config.prefix));
    }
  },
  {
    name: "ping",
    category: "General",
    description: "check that I am online",
    run: async ctx => {
      const seconds = Math.floor(process.uptime());
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      await ctx.reply(
        "I am here and running. Uptime so far: " + hours + "h " + minutes + "m. 🟢"
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
  }
];
