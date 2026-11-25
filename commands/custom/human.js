// DamzD human mode toggle — owner-only. Flips the .human engine
// (src/damzd/human.js): plain DMs then get short, natural, human-style
// answers with a real typing pause and zero bot branding, so people
// cannot tell a bot is behind the number.
import { isHumanModeEnabled, setHumanMode } from "../../src/damzd/human.js";

export default [
  {
    name: "human",
    aliases: ["humanmode"],
    category: "Owner",
    description: "human mode on/off — the bot answers plain DMs like a real person",
    run: async ctx => {
      if (!ctx.owner) throw new Error("only the owner can flip human mode");
      const arg = String(ctx.args || "").trim().toLowerCase();
      const enabled = await isHumanModeEnabled();
      if (!arg || arg === "status") {
        await ctx.reply(
          "*HUMAN MODE* " + (enabled ? "ON ✅" : "OFF") + "\n" +
          (enabled
            ? "Plain DMs get short, natural, human-style replies — no branding, no bot smell. Groups are untouched."
            : "The bot answers like a bot again. Turn it on with " + ctx.config.prefix + "human on."));
        return;
      }
      if (arg === "on" || arg === "enable") {
        await setHumanMode(true);
        await ctx.reply("✅ Human mode ON.\nPlain DMs now get human-style replies: short, lowercase, a real typing pause, zero bot branding. Groups are never touched.");
        return;
      }
      if (arg === "off" || arg === "disable") {
        await setHumanMode(false);
        await ctx.reply("Human mode OFF. The bot is a bot again.");
        return;
      }
      throw new Error("Usage: " + ctx.config.prefix + "human on|off");
    }
  }
];
