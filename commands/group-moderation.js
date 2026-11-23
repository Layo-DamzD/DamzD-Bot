import { getContextInfo, normalizeJid, numberFromJid } from "../lib/message-utils.js";
import { groupModeration } from "../lib/group-moderation.js";

function isAdmin(participant) {
  return Boolean(participant && (
    participant.admin === "admin" ||
    participant.admin === "superadmin" ||
    participant.isAdmin
  ));
}

function participantIds(participant) {
  return [
    participant?.id,
    participant?.jid,
    participant?.lid,
    participant?.phoneNumber,
    participant?.pn
  ].map(normalizeJid).filter(Boolean);
}

async function requireGroupAdmin(ctx, requireBotAdmin = false) {
  if (!String(ctx.jid || "").endsWith("@g.us")) {
    await ctx.reply("Use this command inside a WhatsApp group.");
    return null;
  }

  let metadata;
  try {
    metadata = await ctx.sock.groupMetadata(ctx.jid);
  } catch {
    await ctx.reply("Could not load this group. Try again when the connection is stable.");
    return null;
  }

  const participants = Array.isArray(metadata?.participants) ? metadata.participants : [];
  const sender = normalizeJid(ctx.senderJid || "");
  const senderIsAdmin = Boolean(ctx.owner) || participants.some(participant =>
    isAdmin(participant) && participantIds(participant).includes(sender)
  );
  if (!senderIsAdmin) {
    await ctx.reply("⛔ Only a group admin or the configured bot owner can use this command.");
    return null;
  }

  if (requireBotAdmin) {
    const selfIds = [ctx.sock?.user?.id, ctx.sock?.user?.lid].map(normalizeJid).filter(Boolean);
    const botIsAdmin = participants.some(participant =>
      isAdmin(participant) && participantIds(participant).some(id => selfIds.includes(id))
    );
    if (!botIsAdmin) {
      await ctx.reply("⛔ FEI XMD must be a group admin to enforce link moderation.");
      return null;
    }
  }
  return metadata;
}

function getTargets(ctx) {
  const info = getContextInfo(ctx.msg?.message) || {};
  const targets = new Set();

  for (const value of info.mentionedJid || []) {
    const jid = normalizeJid(value);
    if (jid) targets.add(jid);
  }
  if (info.participant) {
    const jid = normalizeJid(info.participant);
    if (jid) targets.add(jid);
  }
  for (const value of String(ctx.args || "").match(/\+?\d[\d\s().-]{6,}\d/g) || []) {
    const phone = value.replace(/\D/g, "");
    if (phone.length >= 8 && phone.length <= 15) targets.add(phone + "@s.whatsapp.net");
  }
  return [...targets];
}

function safeReason(value) {
  return String(value || "")
    .replace(/[\r\n\u0000-\u001f]+/g, " ")
    .replace(/\+?\d{8,15}/g, "")
    .trim()
    .slice(0, 180);
}

export default [
  {
    name: "antilink",
    category: "Group",
    description: "Enable or disable automatic deletion of links from non-admin members.",
    run: async ctx => {
      if (!String(ctx.jid || "").endsWith("@g.us")) {
        await ctx.reply("Use " + ctx.config.prefix + "antilink on/off inside a group.");
        return;
      }
      const value = String(ctx.args || "").trim().toLowerCase();
      const metadata = await requireGroupAdmin(ctx, value === "on");
      if (!metadata) return;

      const settings = await groupModeration.getSettings(ctx.jid);
      if (value !== "on" && value !== "off") {
        await ctx.reply("🔗 *ANTILINK*\nStatus: " + (settings.antilink ? "ON ✅" : "OFF 🔕") +
          "\nUsage: " + ctx.config.prefix + "antilink on/off\nOnly non-admin members are affected.");
        return;
      }

      await groupModeration.setSetting(ctx.jid, "antilink", value === "on");
      await ctx.reply(value === "on"
        ? "✅ Antilink enabled. Links from non-admin members will be deleted when FEI XMD has admin permission."
        : "🔕 Antilink disabled for this group.");
    }
  },
  {
    name: "warn",
    category: "Group",
    description: "Toggle automatic link warnings or give a manual warning to a member.",
    run: async ctx => {
      if (!String(ctx.jid || "").endsWith("@g.us")) {
        await ctx.reply("Use " + ctx.config.prefix + "warn inside a group.");
        return;
      }

      const value = String(ctx.args || "").trim();
      const action = value.toLowerCase();
      if (action === "on" || action === "off") {
        if (!ctx.owner) {
          await ctx.reply("⛔ Only the configured bot owner can toggle automatic link warnings.");
          return;
        }
        if (!await requireGroupAdmin(ctx, action === "on")) return;
        await groupModeration.setSetting(ctx.jid, "warnlinks", action === "on");
        await ctx.reply(action === "on"
          ? "✅ Automatic link warnings enabled. Non-admin link posts are deleted and recorded. The third warning triggers a removal request."
          : "🔕 Automatic link warnings disabled for this group.");
        return;
      }

      if (!await requireGroupAdmin(ctx, false)) return;
      const targets = getTargets(ctx);
      if (!targets.length) {
        const settings = await groupModeration.getSettings(ctx.jid);
        await ctx.reply("Automatic link warnings: " + (settings.warnlinks ? "ON" : "OFF") +
          "\nUsage: " + ctx.config.prefix + "warn @member (manual warning), or owner: " +
          ctx.config.prefix + "warn on/off");
        return;
      }

      const selected = targets.slice(0, 5);
      const reason = safeReason(value);
      const lines = [];
      for (const target of selected) {
        const count = await groupModeration.addWarning(ctx.jid, target);
        lines.push("@" + numberFromJid(target) + ": warning " + count + "/3" +
          (reason ? " — " + reason : ""));
      }
      await ctx.send({ text: "⚠️ *WARNING RECORDED*\n" + lines.join("\n"), mentions: selected });
    }
  },
  {
    name: "warnlist",
    category: "Group",
    description: "List members with recorded warnings in this group.",
    run: async ctx => {
      if (!await requireGroupAdmin(ctx, false)) return;
      const warnings = await groupModeration.listWarnings(ctx.jid);
      const text = warnings.length
        ? warnings.map(item => "@" + numberFromJid(item.jid) + ": " + item.count + "/3").join("\n")
        : "No warnings recorded.";
      await ctx.send({
        text: "⚠️ *GROUP WARNING LIST*\n" + text,
        mentions: warnings.map(item => item.jid)
      });
    }
  }
];
