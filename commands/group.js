import { numberFromJid } from "../lib/message-utils.js";
import { getGroupGreetingSettings, setGroupGreetingSetting } from "../lib/group-greetings.js";

function normalizeJid(value) {
  return String(value || "").trim().toLowerCase().replace(/^(\d+):\d+@/, "$1@");
}

function participantJids(participant) {
  return [...new Set([
    participant?.id,
    participant?.jid,
    participant?.phoneNumber,
    participant?.pn,
    participant?.lid
  ].map(normalizeJid).filter(Boolean))];
}

function participantJid(participant) {
  return participantJids(participant)[0] || "";
}

function isAdmin(participant) {
  return Boolean(participant && (
    participant.admin === "admin" ||
    participant.admin === "superadmin" ||
    participant.isAdmin
  ));
}

async function groupMetadata(ctx) {
  if (!String(ctx.jid || "").endsWith("@g.us")) {
    throw new Error("This command only works inside a WhatsApp group.");
  }
  return ctx.sock.groupMetadata(ctx.jid);
}

async function requireGroupAdmin(ctx, requireBotAdmin = false) {
  const metadata = await groupMetadata(ctx);
  const participants = Array.isArray(metadata.participants) ? metadata.participants : [];
  const sender = normalizeJid(ctx.senderJid);
  const senderIsAdmin = Boolean(ctx.owner) || participants.some(item =>
    isAdmin(item) && participantJids(item).includes(sender)
  );

  if (!senderIsAdmin) {
    await ctx.reply("Only group admins or the bot owner can use this command.");
    return null;
  }

  const selfIds = [
    normalizeJid(ctx.sock.user?.id),
    normalizeJid(ctx.sock.user?.lid)
  ].filter(Boolean);
  const botIsAdmin = participants.some(item =>
    isAdmin(item) && participantJids(item).some(jid => selfIds.includes(jid))
  );

  if (requireBotAdmin && !botIsAdmin) {
    await ctx.reply("Please make FEI XMD a group admin before using this command.");
    return null;
  }

  return { metadata, participants, botIsAdmin };
}

function safeText(value, limit) {
  return String(value || "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function getMentions(message) {
  let current = message;
  for (let depth = 0; current && depth < 8; depth += 1) {
    for (const key of ["extendedTextMessage", "imageMessage", "videoMessage", "documentMessage"]) {
      const mentions = current[key]?.contextInfo?.mentionedJid;
      if (Array.isArray(mentions)) return mentions.map(normalizeJid).filter(Boolean);
    }
    current = current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message;
  }
  return [];
}


function greetingCommand(name, settingType) {
  return {
    name,
    category: "Group",
    description: "View, enable, disable or customize group " + name + " messages.",
    run: async ctx => {
      if (!String(ctx.jid || "").endsWith("@g.us")) {
        await ctx.reply("Use " + ctx.config.prefix + name + " inside a WhatsApp group.");
        return;
      }

      const raw = String(ctx.args || "").trim();
      const current = (await getGroupGreetingSettings(ctx.jid))[settingType];
      if (!raw) {
        await ctx.reply([
          "💬 *" + name.toUpperCase() + " MESSAGE*",
          "Status: " + (current.enabled ? "ON ✅" : "OFF 🔕"),
          "Current message:",
          current.message,
          "",
          "Set message: " + ctx.config.prefix + name + " your message",
          "Enable/disable: " + ctx.config.prefix + name + " on/off",
          "Placeholders: {user}, {group}, {number}",
          "Restore default: " + ctx.config.prefix + name + " reset"
        ].join("\n"));
        return;
      }

      const group = await requireGroupAdmin(ctx);
      if (!group) return;

      const action = raw.toLowerCase();
      if (action === "on" || action === "off") {
        await setGroupGreetingSetting(ctx.jid, settingType, { enabled: action === "on" });
        await ctx.reply("✅ " + name + " messages are now " + action.toUpperCase() + ".");
        return;
      }
      if (action === "reset" || action === "default") {
        const defaultMessage = settingType === "welcome"
          ? "🎉 Welcome {user} to *{group}*! Make yourself at home. ✨"
          : "👋 {user} has left *{group}*. Wishing them all the best.";
        await setGroupGreetingSetting(ctx.jid, settingType, {
          enabled: false,
          message: defaultMessage
        });
        await ctx.reply("✅ Default " + name + " message restored and left disabled.");
        return;
      }

      const message = raw.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 700);
      if (!message) throw new Error("Enter a non-empty greeting message.");
      await setGroupGreetingSetting(ctx.jid, settingType, {
        enabled: true,
        message
      });
      await ctx.reply("✅ Custom " + name + " message saved and enabled.");
    }
  };
}

function makeGroupCommand(name, description, run, aliases = []) {
  return { name, aliases, category: "Group", description, run };
}

export default [
  greetingCommand("welcome", "welcome"),
  greetingCommand("goodbye", "goodbye"),
  makeGroupCommand("groupinfo", "Show group name, member count, admins and description.", async ctx => {
    const metadata = await groupMetadata(ctx);
    const participants = Array.isArray(metadata.participants) ? metadata.participants : [];
    await ctx.reply([
      "👥 *GROUP INFORMATION*",
      "📌 Name: " + String(metadata.subject || "Unnamed group"),
      "🆔 ID: " + ctx.jid,
      "👤 Members: " + participants.length,
      "🛡️ Admins: " + participants.filter(isAdmin).length,
      "📝 Description: " + String(metadata.desc || "No description")
    ].join("\n"));
  }),
  makeGroupCommand("groupjid", "Show the current WhatsApp group JID.", async ctx => {
    await groupMetadata(ctx);
    await ctx.reply("🆔 *GROUP JID*\n" + ctx.jid);
  }),
  makeGroupCommand("getgcpp", "Fetch the current group's profile picture.", async ctx => {
    await groupMetadata(ctx);
    if (typeof ctx.sock.profilePictureUrl !== "function") {
      await ctx.reply("This Baileys version does not expose profile-picture lookup.");
      return;
    }
    try {
      const url = await ctx.sock.profilePictureUrl(ctx.jid, "image");
      if (!url) throw new Error("No profile picture is available.");
      await ctx.reply({ image: { url }, caption: "📷 *GROUP PROFILE PICTURE*" });
    } catch {
      await ctx.reply("I couldn't fetch the group picture. It may be hidden by WhatsApp privacy settings.");
    }
  }),
  makeGroupCommand("groupcount", "Show the number of members and admins in this group.", async ctx => {
    const metadata = await groupMetadata(ctx);
    const participants = Array.isArray(metadata.participants) ? metadata.participants : [];
    await ctx.reply(
      "👥 *GROUP COUNT*\nMembers: " + participants.length +
      "\nAdmins: " + participants.filter(isAdmin).length
    );
  }),
  makeGroupCommand("groupstats", "Show a compact, read-only group overview.", async ctx => {
    const metadata = await groupMetadata(ctx);
    const participants = Array.isArray(metadata.participants) ? metadata.participants : [];
    await ctx.reply([
      "📊 *GROUP OVERVIEW*",
      "Name: " + String(metadata.subject || "Unnamed group"),
      "Members: " + participants.length,
      "Admins: " + participants.filter(isAdmin).length,
      "Announcement mode: " + (metadata.announce ? "On" : "Off"),
      "Member edit restrictions: " + (metadata.restrict ? "On" : "Off")
    ].join("\n"));
  }),
  makeGroupCommand("admins", "Mention the current group admins.", async ctx => {
    const metadata = await groupMetadata(ctx);
    const admins = (metadata.participants || []).filter(isAdmin);
    const mentions = admins.map(participantJid).filter(Boolean);
    if (!mentions.length) {
      await ctx.reply("No group admins were found.");
      return;
    }
    await ctx.sock.sendMessage(ctx.jid, {
      text: "🛡️ *Admins in " + String(metadata.subject || "this group") + "*\n\n" +
        admins.map((item, index) =>
          (index + 1) + ". @" + numberFromJid(participantJid(item))
        ).join("\n"),
      mentions
    });
  }),
  makeGroupCommand("tagall", "Mention group members (group-admin only).", async ctx => {
    const group = await requireGroupAdmin(ctx);
    if (!group) return;
    const members = group.participants.map(participantJid).filter(Boolean);
    if (!members.length) {
      await ctx.reply("No group participants were found.");
      return;
    }
    if (members.length > 150) {
      await ctx.reply("This group has more than 150 members. Tagging is capped to protect the chat from excessive mentions.");
      return;
    }
    const message = safeText(ctx.args, 240) || "📢 Attention everyone!";
    const mentionsText = members.map(jid => "@" + numberFromJid(jid)).join(" ");
    await ctx.sock.sendMessage(ctx.jid, {
      text: message + "\n\n" + mentionsText,
      mentions: members
    });
  }),
  makeGroupCommand("link", "Get the group's invite link (group-admin only).", async ctx => {
    const group = await requireGroupAdmin(ctx, true);
    if (!group) return;
    const code = await ctx.sock.groupInviteCode(ctx.jid);
    await ctx.reply("🔗 Group invite link:\nhttps://chat.whatsapp.com/" + code);
  }),
  makeGroupCommand("groupname", "Change the group name (group-admin only).", async ctx => {
    const name = safeText(ctx.args, 100);
    if (!name) throw new Error("Usage: " + ctx.config.prefix + "groupname New group name");
    const group = await requireGroupAdmin(ctx, true);
    if (!group) return;
    await ctx.sock.groupUpdateSubject(ctx.jid, name);
    await ctx.reply("✅ Group name updated.");
  }, ["setname"]),
  makeGroupCommand("groupdesc", "Change the group description (group-admin only).", async ctx => {
    const description = safeText(ctx.args, 500);
    if (!description) throw new Error("Usage: " + ctx.config.prefix + "groupdesc New group description");
    const group = await requireGroupAdmin(ctx, true);
    if (!group) return;
    await ctx.sock.groupUpdateDescription(ctx.jid, description);
    await ctx.reply("✅ Group description updated.");
  }, ["setdesc"]),
  makeGroupCommand("close", "Allow only admins to send messages (group-admin only).", async ctx => {
    const group = await requireGroupAdmin(ctx, true);
    if (!group) return;
    await ctx.sock.groupSettingUpdate(ctx.jid, "announcement");
    await ctx.reply("🔒 Group closed. Only admins can send messages now.");
  }),
  makeGroupCommand("open", "Allow all members to send messages (group-admin only).", async ctx => {
    const group = await requireGroupAdmin(ctx, true);
    if (!group) return;
    await ctx.sock.groupSettingUpdate(ctx.jid, "not_announcement");
    await ctx.reply("🔓 Group opened. All members can send messages now.");
  })
];
