import {
  getAntiDeleteSettings,
  setAntiDeleteDelivery,
  setAntiDeleteEnabled
} from "../../lib/anti-delete.js";
import { normalizeJid } from "../../lib/message-utils.js";

async function canManage(ctx, label) {
  if (!String(ctx.jid || "").endsWith("@g.us")) {
    if (ctx.owner) return true;
    await ctx.reply("⛔ Only the bot owner can manage " + label + " in a private chat.");
    return false;
  }

  let metadata;
  try {
    metadata = await ctx.sock.groupMetadata(ctx.jid);
  } catch {
    await ctx.reply("Could not load this group. Try again when the connection is stable.");
    return false;
  }

  const sender = normalizeJid(ctx.senderJid || "");
  const isAdmin = Boolean(ctx.owner) || (metadata.participants || []).some(participant => {
    const ids = [
      participant?.id,
      participant?.jid,
      participant?.lid,
      participant?.phoneNumber,
      participant?.pn
    ].map(normalizeJid);
    const admin = participant?.admin === "admin" ||
      participant?.admin === "superadmin" ||
      participant?.isAdmin === true;
    return admin && ids.includes(sender);
  });

  if (!isAdmin) {
    await ctx.reply("⛔ Only a group admin or the configured bot owner can manage anti-delete here.");
    return false;
  }
  return true;
}

function targetLabel(target) {
  if (target === "dm") return "your DM";
  if (target === "both") return "your DM and the original chat";
  return "the original chat";
}

function statusText(prefix, enabled, target) {
  return "🗑️ *ANTIDELETE*\n" +
    "• Status here: " + (enabled ? "ON ✅" : "OFF 🔕") + "\n" +
    "• Delivery: " + targetLabel(target) + "\n\n" +
    "*Usage*\n" +
    "• " + prefix + "antidelete on/off — toggle in this chat\n" +
    "• " + prefix + "antidelete dm — send alerts to your DM\n" +
    "• " + prefix + "antidelete group — send alerts to the original chat\n" +
    "• " + prefix + "antidelete both — send to both\n" +
    "• " + prefix + "antidelete on dm — enable here and set DM delivery\n\n" +
    "_Settings are saved. Message content is kept in a short-lived memory cache only._";
}

export default {
  name: "antidelete",
  aliases: ["antidel"],
  category: "Chat & Privacy",
  description: "Temporarily cache enabled-chat messages and report when one is deleted for everyone.",
  run: async ctx => {
    if (!await canManage(ctx, "anti-delete")) return;

    const args = String(ctx.args || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!args.length) {
      const current = await getAntiDeleteSettings(ctx.jid);
      await ctx.reply(statusText(ctx.config.prefix, current.enabled, current.delivery));
      return;
    }

    for (const word of args) {
      if (word === "on" || word === "off") {
        await setAntiDeleteEnabled(ctx.jid, word === "on");
        continue;
      }
      if (word === "dm" || word === "group" || word === "chat" || word === "both") {
        await setAntiDeleteDelivery(word === "group" ? "chat" : word);
        continue;
      }

      const current = await getAntiDeleteSettings(ctx.jid);
      await ctx.reply("❓ Unknown option: *" + word + "*\n\n" +
        statusText(ctx.config.prefix, current.enabled, current.delivery));
      return;
    }

    const current = await getAntiDeleteSettings(ctx.jid);
    await ctx.reply("✅ Anti-delete settings updated.\n\n" +
      statusText(ctx.config.prefix, current.enabled, current.delivery));
  }
};
