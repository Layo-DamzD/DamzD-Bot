// The Privacy section: chat management tools built on the Baileys chat
// APIs (chatModify, updateBlockStatus, disappearing messages), message
// actions (delete, edit, forward) and small lookups. Everything runs only
// when the user explicitly invokes the command.
import {
  getContextInfo,
  normalizeJid,
  numberFromJid,
  unwrapMessage
} from "../lib/message-utils.js";
import {
  getAntiEditSettings,
  setAntiEditEnabled
} from "../lib/anti-delete.js";

const MUTE_MINUTES = Object.freeze({
  "8h": 8 * 60,
  "24h": 24 * 60,
  "7d": 7 * 24 * 60,
  forever: 525600 * 100 // fifty years is WhatsApp's practical "always"
});
const DISAPPEAR_SECONDS = Object.freeze({
  off: 0,
  "24h": 86400,
  "7d": 604800,
  "90d": 7776000
});

function quoted(ctx) {
  const info = getContextInfo(ctx.msg?.message);
  if (!info?.stanzaId || !info?.quotedMessage) return null;
  const selfIds = [ctx.sock?.user?.id, ctx.sock?.user?.lid]
    .map(normalizeJid)
    .filter(Boolean);
  const participant = normalizeJid(info.participant || "");
  const key = {
    remoteJid: String(ctx.msg?.key?.remoteJid || ctx.jid || ""),
    id: String(info.stanzaId),
    fromMe: Boolean(participant && selfIds.includes(participant))
  };
  if (participant) key.participant = participant;
  return { key, message: info.quotedMessage, participant };
}

function requireQuoted(ctx, hint) {
  const target = quoted(ctx);
  if (!target) {
    throw new Error("Reply to the message you want to " + hint + " with " +
      ctx.config.prefix + ctx.commandName + ".");
  }
  return target;
}

// A target contact: a replied-to participant, or a number typed after the
// command. Groups never become block targets.
function targetJid(ctx) {
  const raw = String(ctx.args || "").trim().split(/\s+/)[0] || "";
  const replied = normalizeJid(quoted(ctx)?.participant || "");
  let candidate = "";
  if (raw) {
    const digits = raw.replace(/[^\d]/g, "");
    if (!/^\d{8,15}$/.test(digits)) throw new Error("Enter a valid WhatsApp number with country code, digits only.");
    candidate = digits + "@s.whatsapp.net";
  } else if (replied && replied.endsWith("@s.whatsapp.net")) {
    candidate = replied;
  } else if (replied && replied.endsWith("@lid")) {
    throw new Error("WhatsApp did not expose this member's plain number. Send their number: " +
      ctx.config.prefix + ctx.commandName + " 2348012345678");
  }
  if (!candidate) throw new Error("Reply to the contact's message or send their number: " +
    ctx.config.prefix + ctx.commandName + " 2348012345678");
  return candidate;
}

// chatModify archive/markRead calls need a slice of the recent chat history
// to anchor the sync action; the invoking message itself works.
function lastMessages(ctx) {
  return [{
    key: ctx.msg.key,
    messageTimestamp: ctx.msg.messageTimestamp,
    message: ctx.msg.message
  }];
}

function ownMessageKey(ctx) {
  const target = requireQuoted(ctx, "manage");
  const selfIds = [ctx.sock?.user?.id, ctx.sock?.user?.lid].map(normalizeJid).filter(Boolean);
  if (!target.key.fromMe && !selfIds.includes(target.participant)) {
    throw new Error("That message was not sent by DamzD. I can only manage my own messages.");
  }
  return target.key;
}

const commands = [
  {
    name: "unsend",
    category: "Privacy",
    description: "Delete a message I sent (reply to it).",
    run: async ctx => {
      const key = ownMessageKey(ctx);
      await ctx.sock.sendMessage(ctx.jid, { delete: key });
      await ctx.reply("🗑️ The message was deleted for everyone.");
    }
  },
  {
    name: "edit",
    category: "Privacy",
    description: "Edit a message I sent (reply to it).",
    run: async ctx => {
      const key = ownMessageKey(ctx);
      const text = String(ctx.args || "").trim();
      if (!text) throw new Error("Reply to my message and add the new text: " +
        ctx.config.prefix + "edit the corrected sentence");
      if (text.length > 3000) throw new Error("Keep the edited text under 3000 characters.");
      await ctx.sock.sendMessage(ctx.jid, { text, edit: key });
      await ctx.reply("✏️ The message was edited.");
    }
  },
  {
    name: "forward",
    category: "Privacy",
    description: "Forward a replied-to message here.",
    run: async ctx => {
      const target = requireQuoted(ctx, "forward");
      await ctx.sock.sendMessage(ctx.jid, {
        forward: { key: target.key, message: target.message },
        force: true
      });
    }
  },
  {
    name: "pin",
    category: "Privacy",
    description: "Pin this chat.",
    run: async ctx => {
      await ctx.sock.chatModify({ pin: true }, ctx.jid);
      await ctx.reply("📌 This chat is pinned.");
    }
  },
  {
    name: "unpin",
    category: "Privacy",
    description: "Unpin this chat.",
    run: async ctx => {
      await ctx.sock.chatModify({ pin: false }, ctx.jid);
      await ctx.reply("📍 This chat was unpinned.");
    }
  },
  {
    name: "archive",
    category: "Privacy",
    description: "Archive this chat.",
    run: async ctx => {
      await ctx.sock.chatModify({ archive: true, lastMessages: lastMessages(ctx) }, ctx.jid);
      await ctx.reply("🗄️ This chat was archived.");
    }
  },
  {
    name: "unarchive",
    category: "Privacy",
    description: "Unarchive this chat.",
    run: async ctx => {
      await ctx.sock.chatModify({ archive: false, lastMessages: lastMessages(ctx) }, ctx.jid);
      await ctx.reply("📂 This chat was unarchived.");
    }
  },
  {
    name: "mutechat",
    category: "Privacy",
    description: "Mute this chat: 8h, 24h, 7d or forever.",
    run: async ctx => {
      const choice = String(ctx.args || "").trim().toLowerCase() || "8h";
      const minutes = MUTE_MINUTES[choice];
      if (!minutes) {
        throw new Error("Choose a duration: " + ctx.config.prefix + "mutechat 8h | 24h | 7d | forever");
      }
      await ctx.sock.chatModify({ mute: minutes * 60 * 1000 }, ctx.jid);
      await ctx.reply("🔇 This chat is muted for " + choice +
        ". Bring it back with " + ctx.config.prefix + "unmutechat.");
    }
  },
  {
    name: "unmutechat",
    category: "Privacy",
    description: "Unmute this chat.",
    run: async ctx => {
      await ctx.sock.chatModify({ mute: null }, ctx.jid);
      await ctx.reply("🔔 This chat was unmuted.");
    }
  },
  {
    name: "readchat",
    category: "Privacy",
    description: "Mark this chat as read.",
    run: async ctx => {
      await ctx.sock.chatModify({ markRead: true, lastMessages: lastMessages(ctx) }, ctx.jid);
      await ctx.reply("✅ This chat is marked as read.");
    }
  },
  {
    name: "unreadchat",
    category: "Privacy",
    description: "Mark this chat as unread.",
    run: async ctx => {
      await ctx.sock.chatModify({ markRead: false, lastMessages: lastMessages(ctx) }, ctx.jid);
      await ctx.reply("🔵 This chat is marked as unread.");
    }
  },
  {
    name: "star",
    category: "Privacy",
    description: "Star a replied-to message.",
    run: async ctx => {
      const target = requireQuoted(ctx, "star");
      await ctx.sock.chatModify({
        star: { messages: [{ id: target.key.id, fromMe: target.key.fromMe }], star: true }
      }, ctx.jid);
      await ctx.reply("⭐ The message was starred.");
    }
  },
  {
    name: "unstar",
    category: "Privacy",
    description: "Unstar a replied-to message.",
    run: async ctx => {
      const target = requireQuoted(ctx, "unstar");
      await ctx.sock.chatModify({
        star: { messages: [{ id: target.key.id, fromMe: target.key.fromMe }], star: false }
      }, ctx.jid);
      await ctx.reply("☆ The message was unstarred.");
    }
  },
  {
    name: "disappear",
    category: "Privacy",
    description: "Disappearing messages: off, 24h, 7d or 90d.",
    run: async ctx => {
      const choice = String(ctx.args || "").trim().toLowerCase() || "off";
      if (!(choice in DISAPPEAR_SECONDS)) {
        throw new Error("Choose: " + ctx.config.prefix + "disappear off | 24h | 7d | 90d");
      }
      await ctx.sock.sendMessage(ctx.jid, {
        disappearingMessagesInChat: DISAPPEAR_SECONDS[choice]
      });
      await ctx.reply(choice === "off"
        ? "⏳ Disappearing messages are off in this chat."
        : "⏳ Disappearing messages set to " + choice + " in this chat.");
    }
  },
  {
    name: "block",
    category: "Privacy",
    description: "Block a contact (reply or send number).",
    run: async ctx => {
      const target = targetJid(ctx);
      await ctx.sock.updateBlockStatus(target, "block");
      await ctx.reply("🚫 Blocked " + numberFromJid(target) + ".");
    }
  },
  {
    name: "unblock",
    category: "Privacy",
    description: "Unblock a contact.",
    run: async ctx => {
      const target = targetJid(ctx);
      await ctx.sock.updateBlockStatus(target, "unblock");
      await ctx.reply("✅ Unblocked " + numberFromJid(target) + ".");
    }
  },
  {
    name: "banchecker",
    aliases: ["wacheck"],
    category: "Privacy",
    description: "Check if a number is on WhatsApp.",
    run: async ctx => {
      const digits = String(ctx.args || "").replace(/[^\d]/g, "");
      if (!/^\d{8,15}$/.test(digits)) {
        throw new Error("Send the number with country code, digits only: " +
          ctx.config.prefix + "banchecker 2348012345678");
      }
      const results = await ctx.sock.onWhatsApp(digits);
      const hit = Array.isArray(results) ? results[0] : null;
      await ctx.reply(hit?.exists
        ? "📱 *" + numberFromJid(hit.jid) + "* is on WhatsApp."
        : "❌ *" + digits + "* is not registered on WhatsApp.");
    }
  },
  {
    name: "pollres",
    aliases: ["pollresult"],
    category: "Privacy",
    description: "Show what I can see about a replied-to poll.",
    run: async ctx => {
      const target = requireQuoted(ctx, "inspect");
      const body = unwrapMessage(target.message);
      const poll = body.pollCreationMessage || body.pollCreationMessageV2 ||
        body.pollCreationMessageV3;
      if (!poll) throw new Error("The replied-to message is not a poll.");
      const options = (poll.options || [])
        .map(option => "• " + String(option.optionName || option.optionText || "option"))
        .join("\n");
      const snapshot = body.pollResultSnapshotMessage;
      const votes = snapshot?.votes?.length
        ? "\n\n*Votes I can see:*\n" + snapshot.votes
          .map(vote => "• " + String(vote.optionName || "?") + ": " +
            (vote.optionVoteCount || 0) + " vote(s)")
          .join("\n")
        : "\n\n_Vote counts are not shared with me — WhatsApp only sends a snapshot to the poll creator._";
      await ctx.reply(
        "📊 *POLL INFO*\n" +
        "Question: " + String(poll.name || "(untitled)").slice(0, 200) + "\n" +
        "Selectable: " + (poll.selectableOptionsCount || 1) + "\n" +
        (options ? "\n*Options:*\n" + options : ""),
        );
      await ctx.reply(votes.trim());
    }
  },
  {
    name: "antiedit",
    aliases: ["editalert"],
    category: "Privacy",
    description: "Alert me when a message is edited.",
    run: async ctx => {
      const raw = String(ctx.args || "").trim().toLowerCase();
      const current = await getAntiEditSettings(ctx.jid);
      if (!["on", "off"].includes(raw)) {
        await ctx.reply("✏️ Edit alerts in this chat: " + (current.enabled ? "ON ✅" : "OFF 🔕") +
          "\nUsage: " + ctx.config.prefix + "antiedit on/off");
        return;
      }
      const updated = await setAntiEditEnabled(ctx.jid, raw === "on");
      await ctx.reply("✏️ Edit alerts " + (updated.enabled ? "enabled" : "disabled") +
        " for this chat. When someone edits a message, I show what it became.");
    }
  }
];

export default commands;
