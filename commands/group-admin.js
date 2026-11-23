import { getContextInfo, normalizeJid, numberFromJid } from "../lib/message-utils.js";

function isGroup(ctx) {
  return String(ctx.jid || "").endsWith("@g.us");
}

function participantIds(participant) {
  return [...new Set([
    participant?.id,
    participant?.jid,
    participant?.phoneNumber,
    participant?.pn,
    participant?.lid
  ].map(normalizeJid).filter(Boolean))];
}

function isAdmin(participant) {
  return Boolean(participant && (
    participant.admin === "admin" ||
    participant.admin === "superadmin" ||
    participant.isAdmin
  ));
}

async function requireGroupAdmin(ctx, requireBotAdmin = true) {
  if (!isGroup(ctx)) {
    await ctx.reply("Use this command inside a WhatsApp group.");
    return null;
  }

  let metadata;
  try {
    metadata = await ctx.sock.groupMetadata(ctx.jid);
  } catch {
    await ctx.reply("Could not load this group. Check the connection and try again.");
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

  const selfIds = [ctx.sock?.user?.id, ctx.sock?.user?.lid].map(normalizeJid).filter(Boolean);
  const botIsAdmin = participants.some(participant =>
    isAdmin(participant) && participantIds(participant).some(id => selfIds.includes(id))
  );

  if (requireBotAdmin && !botIsAdmin) {
    await ctx.reply("⛔ Please make FEI XMD a group admin before using this command.");
    return null;
  }

  return { metadata, participants, botIsAdmin };
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

  const raw = String(ctx.args || "");
  for (const value of raw.match(/\+?\d[\d\s().-]{6,}\d/g) || []) {
    const phone = value.replace(/\D/g, "");
    if (phone.length >= 8 && phone.length <= 15) {
      targets.add(phone + "@s.whatsapp.net");
    }
  }

  for (const value of raw.match(/[0-9-]+@(?:s\.whatsapp\.net|lid)/gi) || []) {
    const jid = normalizeJid(value);
    if (jid) targets.add(jid);
  }

  return [...targets].filter(jid => jid.includes("@"));
}

async function updateParticipants(ctx, action) {
  const group = await requireGroupAdmin(ctx, true);
  if (!group) return;

  const targets = getTargets(ctx);
  if (action === "add" && !targets.length) {
    await ctx.reply("Usage: " + ctx.config.prefix + "add 2348012345678 (include country code).");
    return;
  }
  if (!targets.length) {
    await ctx.reply("Mention the member, reply to their message, or provide an international phone number.");
    return;
  }

  if (targets.length > 10) {
    await ctx.reply("For safety, process no more than 10 members per command.");
    return;
  }

  const result = await ctx.sock.groupParticipantsUpdate(ctx.jid, targets, action);
  const lines = Array.isArray(result)
    ? result.map(item =>
      String(item.jid || "participant") + ": " + String(item.status || "requested")
    ).join("\n")
    : "WhatsApp accepted the group action request.";

  await ctx.reply("✅ " + action.charAt(0).toUpperCase() + action.slice(1) +
    " request processed.\n" + lines);
}

export default [
  {
    name: "revoke",
    aliases: ["resetlink"],
    category: "Group",
    description: "Reset the group's invite link (group-admin only).",
    run: async ctx => {
      if (!await requireGroupAdmin(ctx, true)) return;
      const code = await ctx.sock.groupRevokeInvite(ctx.jid);
      await ctx.reply("✅ Group invite link reset.\nNew link: https://chat.whatsapp.com/" + code);
    }
  },
  {
    name: "kick",
    aliases: ["remove"],
    category: "Group",
    description: "Remove mentioned or replied-to members (group-admin only).",
    run: async ctx => updateParticipants(ctx, "remove")
  },
  {
    name: "add",
    category: "Group",
    description: "Add a member using an international WhatsApp number (group-admin only).",
    run: async ctx => updateParticipants(ctx, "add")
  },
  {
    name: "promote",
    category: "Group",
    description: "Promote mentioned or replied-to members to group admin.",
    run: async ctx => updateParticipants(ctx, "promote")
  },
  {
    name: "demote",
    category: "Group",
    description: "Remove admin privileges from mentioned or replied-to members.",
    run: async ctx => updateParticipants(ctx, "demote")
  },
  {
    name: "leave",
    category: "Group",
    description: "Make FEI XMD leave the current group (group-admin only).",
    run: async ctx => {
      if (!await requireGroupAdmin(ctx, false)) return;
      await ctx.reply("👋 FEI XMD is leaving this group.");
      await ctx.sock.groupLeave(ctx.jid);
    }
  }
];
