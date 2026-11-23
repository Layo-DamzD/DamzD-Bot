import {
  DEFAULT_EMOJIS,
  getStatusAutomationSettings,
  setStatusAutomationSetting
} from "../lib/status-automation.js";

async function ownerOnly(ctx, feature) {
  if (ctx.owner) return true;
  await ctx.reply("⛔ Only the configured bot owner can manage " + feature + ".");
  return false;
}

function statusSummary(settings, prefix) {
  const mode = settings.statusreactmode === "random"
    ? "random emoji pool"
    : (Array.isArray(settings.statusreactmode) ? settings.statusreactmode.join(" ") : settings.statusreactmode);
  return [
    "📱 *STATUS AUTOMATION*",
    "Auto-view: " + (settings.autoview ? "ON ✅" : "OFF 🔕"),
    "Auto-react: " + (settings.statusreact ? "ON ✅" : "OFF 🔕"),
    "Reaction emojis: " + mode,
    "Keyword filter: " + (settings.statusreactkeys.length ? settings.statusreactkeys.join(", ") : "all statuses"),
    "",
    "Toggle viewing: " + prefix + "autostatus on/off",
    "Toggle reactions: " + prefix + "statusreact on/off",
    "Set emoji pool: " + prefix + "statusreactmode ❤️,🔥,💯",
    "Use built-in random pool: " + prefix + "statusreactmode random",
    "Filter reactions: " + prefix + "statusreactkeys word1, word2",
    "Clear filter: " + prefix + "statusreactkeys clear"
  ].join("\n");
}

export default [
  {
    name: "autostatus",
    aliases: ["autoview"],
    category: "Status",
    description: "Toggle automatic viewing of new WhatsApp statuses.",
    run: async ctx => {
      if (!await ownerOnly(ctx, "automatic status viewing")) return;
      const raw = String(ctx.args || "").trim().toLowerCase();
      const settings = await getStatusAutomationSettings();
      if (!raw || raw === "help") {
        await ctx.reply(statusSummary(settings, ctx.config.prefix));
        return;
      }

      const parts = raw.split(/\s+/);
      let enabled;
      if (parts.length === 1 && ["on", "off"].includes(parts[0])) {
        enabled = parts[0] === "on";
      } else if (parts.length === 2 && parts[0] === "view" && ["on", "off"].includes(parts[1])) {
        enabled = parts[1] === "on";
      } else if (parts.length === 2 && parts[0] === "react" && ["on", "off"].includes(parts[1])) {
        await setStatusAutomationSetting("statusreact", parts[1] === "on");
        const updated = await getStatusAutomationSettings();
        await ctx.reply(statusSummary(updated, ctx.config.prefix));
        return;
      } else {
        await ctx.reply("Usage: " + ctx.config.prefix + "autostatus on/off\nOr: " +
          ctx.config.prefix + "autostatus react on/off");
        return;
      }

      await setStatusAutomationSetting("autoview", enabled);
      const updated = await getStatusAutomationSettings();
      await ctx.reply("✅ Automatic status viewing " + (enabled ? "enabled." : "disabled.") +
        "\n\n" + statusSummary(updated, ctx.config.prefix));
    }
  },
  {
    name: "statusreact",
    category: "Status",
    description: "Toggle automatic reactions to new WhatsApp statuses.",
    run: async ctx => {
      if (!await ownerOnly(ctx, "automatic status reactions")) return;
      const raw = String(ctx.args || "").trim().toLowerCase();
      if (!["on", "off"].includes(raw)) {
        const settings = await getStatusAutomationSettings();
        await ctx.reply("Automatic status reactions: " + (settings.statusreact ? "ON ✅" : "OFF 🔕") +
          "\nUsage: " + ctx.config.prefix + "statusreact on/off");
        return;
      }
      await setStatusAutomationSetting("statusreact", raw === "on");
      await ctx.reply("✅ Automatic status reactions " + (raw === "on" ? "enabled." : "disabled."));
    }
  },
  {
    name: "statusreactmode",
    category: "Status",
    description: "Choose a random pool of distinct emojis for status reactions.",
    run: async ctx => {
      if (!await ownerOnly(ctx, "status reaction emojis")) return;
      const raw = String(ctx.args || "").trim();
      if (!raw) {
        const settings = await getStatusAutomationSettings();
        const value = settings.statusreactmode === "random"
          ? "random (built-in pool)"
          : (Array.isArray(settings.statusreactmode) ? settings.statusreactmode.join(", ") : settings.statusreactmode);
        await ctx.reply("Current status reaction emoji pool: " + value +
          "\nUsage: " + ctx.config.prefix + "statusreactmode ❤️,🔥,💯\nOr: " +
          ctx.config.prefix + "statusreactmode random");
        return;
      }

      if (raw.toLowerCase() === "random") {
        await setStatusAutomationSetting("statusreactmode", "random");
        await ctx.reply("✅ Status reactions will use a varied built-in emoji pool.");
        return;
      }

      const emojis = [...new Set(raw.split(",").map(value => value.trim()).filter(Boolean))];
      if (!emojis.length || emojis.length > 12 ||
          emojis.some(emoji => [...emoji].length > 8 || !/\p{Extended_Pictographic}/u.test(emoji))) {
        await ctx.reply("Use 1–12 emojis separated by commas. Example: ❤️, 🔥, 💯, 💙");
        return;
      }
      await setStatusAutomationSetting("statusreactmode", emojis);
      await ctx.reply("✅ Status reaction emoji pool saved: " + emojis.join(" "));
    }
  },
  {
    name: "statusreactkeys",
    category: "Status",
    description: "Limit automatic status reactions to statuses containing selected words.",
    run: async ctx => {
      if (!await ownerOnly(ctx, "status reaction keyword filters")) return;
      const raw = String(ctx.args || "").trim();
      const settings = await getStatusAutomationSettings();
      if (!raw) {
        await ctx.reply("Current status reaction keywords: " +
          (settings.statusreactkeys.length ? settings.statusreactkeys.join(", ") : "all statuses") +
          "\nUsage: " + ctx.config.prefix + "statusreactkeys word1, word2\nClear: " +
          ctx.config.prefix + "statusreactkeys clear");
        return;
      }
      const values = raw.toLowerCase() === "clear" ? [] :
        [...new Set(raw.split(",").map(value => value.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
      if (values.some(value => value.length > 60)) {
        await ctx.reply("Each keyword must be 60 characters or fewer.");
        return;
      }
      await setStatusAutomationSetting("statusreactkeys", values);
      await ctx.reply(values.length
        ? "✅ Status reaction filter saved: " + values.join(", ")
        : "✅ Status reaction keyword filter cleared; all statuses are eligible.");
    }
  }
];
