import { parseGroupStatusColor, postQuotedGroupStatus } from "../lib/group-status.js";

export default {
  name: "gcstatus",
  aliases: ["groupstatus"],
  category: "Status",
  description: "Post text or quoted regular media as a status for the current group.",
  run: async ctx => {
    if (!String(ctx.jid || "").endsWith("@g.us")) {
      await ctx.reply("Use " + ctx.config.prefix + "gcstatus inside the WhatsApp group you want to post to.");
      return;
    }
    if (!ctx.owner && ctx.msg?.key?.fromMe !== true) {
      await ctx.reply("⛔ Only the configured owner or the connected account can post group statuses.");
      return;
    }

    const parsed = parseGroupStatusColor(ctx.args || "");
    if (parsed.error) {
      await ctx.reply("⚠️ " + parsed.error);
      return;
    }

    try {
      const posted = await postQuotedGroupStatus(ctx, ctx.jid, parsed.text, parsed);
      const background = posted.color
        ? "\nBackground: " + posted.color.name + " (" + posted.color.hex + ")"
        : "";
      await ctx.reply("✅ Group status posted successfully." + background +
        "\n\n⚡ *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ʙᴇɴꜰᴇɪ ᴛᴇᴄʜ*");
    } catch (error) {
      await ctx.reply("⚠️ Could not post the group status: " +
        String(error?.message || error).slice(0, 220));
    }
  }
};
